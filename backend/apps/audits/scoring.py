"""
Compliance scoring.

  compliance % = sum(weight of COMPLIANT answers)
                 / sum(weight of COMPLIANT + NON_COMPLIANT answers) x 100

* NOT_APPLICABLE answers are excluded from the denominator.
* INFORMATIONAL answers (text/date/unbounded numbers with no manual judgement)
  are excluded from the score.
* UNANSWERED questions are never counted as compliant; they are reported
  separately and mandatory ones block submission.
* With the SIMPLE method every weight is 1; with WEIGHTED the question weight is used.
"""
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum

from apps.audit_templates.models import AuditQuestion, AuditTemplateVersion

from .models import AuditResponse

RT = AuditQuestion.ResponseType
C = AuditResponse.Compliance


def evaluate(question, response):
    """Return the compliance status for one question/response pair."""
    if response is None:
        return C.UNANSWERED
    if response.is_not_applicable or response.choice_value == AuditResponse.Choice.NA:
        return C.NOT_APPLICABLE

    rtype = question.response_type
    if rtype in (RT.YES_NO, RT.YES_NO_NA):
        return {"YES": C.COMPLIANT, "NO": C.NON_COMPLIANT}.get(response.choice_value, C.UNANSWERED)
    if rtype == RT.PASS_FAIL:
        return {"PASS": C.COMPLIANT, "FAIL": C.NON_COMPLIANT}.get(response.choice_value, C.UNANSWERED)
    if rtype == RT.RATING:
        if response.rating_value is None:
            return C.UNANSWERED
        return C.COMPLIANT if response.rating_value >= question.rating_pass_threshold else C.NON_COMPLIANT
    if rtype == RT.NUMBER:
        if response.number_value is None:
            return C.UNANSWERED
        if question.numeric_min is not None or question.numeric_max is not None:
            low_ok = question.numeric_min is None or response.number_value >= question.numeric_min
            high_ok = question.numeric_max is None or response.number_value <= question.numeric_max
            return C.COMPLIANT if (low_ok and high_ok) else C.NON_COMPLIANT
        return response.manual_assessment or C.INFORMATIONAL
    if rtype == RT.TEXT:
        if not response.text_value.strip():
            return C.UNANSWERED
        return response.manual_assessment or C.INFORMATIONAL
    if rtype == RT.DATE:
        if response.date_value is None:
            return C.UNANSWERED
        return response.manual_assessment or C.INFORMATIONAL
    return C.UNANSWERED


def audit_questions(audit):
    return AuditQuestion.objects.filter(section__version_id=audit.template_version_id).select_related("section")


def recalculate(audit, save=True):
    """Recompute and cache the score figures on the audit."""
    questions = list(audit_questions(audit))
    responses = {r.question_id: r for r in audit.responses.all()}
    weighted = audit.template_version.scoring_method == AuditTemplateVersion.ScoringMethod.WEIGHTED

    counts = {"answered": 0, "mandatory_unanswered": 0, "compliant": 0, "non_compliant": 0, "na": 0}
    numerator = Decimal("0")
    denominator = Decimal("0")
    for question in questions:
        response = responses.get(question.id)
        status = response.compliance if response else C.UNANSWERED
        if status == C.UNANSWERED:
            if question.is_mandatory:
                counts["mandatory_unanswered"] += 1
            continue
        counts["answered"] += 1
        weight = question.weight if weighted else Decimal("1")
        if status == C.NOT_APPLICABLE:
            counts["na"] += 1
        elif status == C.COMPLIANT:
            counts["compliant"] += 1
            numerator += weight
            denominator += weight
        elif status == C.NON_COMPLIANT:
            counts["non_compliant"] += 1
            denominator += weight

    audit.total_questions = len(questions)
    audit.answered_count = counts["answered"]
    audit.mandatory_unanswered_count = counts["mandatory_unanswered"]
    audit.compliant_count = counts["compliant"]
    audit.non_compliant_count = counts["non_compliant"]
    audit.not_applicable_count = counts["na"]
    audit.score_numerator = numerator
    audit.score_denominator = denominator
    audit.compliance_score = percentage(numerator, denominator)
    if save:
        audit.save(update_fields=[
            "total_questions", "answered_count", "mandatory_unanswered_count", "compliant_count",
            "non_compliant_count", "not_applicable_count", "score_numerator", "score_denominator",
            "compliance_score", "updated_at",
        ])
    return audit


def percentage(numerator, denominator):
    if not denominator:
        return None
    value = Decimal(numerator) * 100 / Decimal(denominator)
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def aggregate_score(audit_queryset):
    """Score across many audits (department / organisation level), same formula."""
    totals = audit_queryset.aggregate(num=Sum("score_numerator"), den=Sum("score_denominator"))
    return percentage(totals["num"] or 0, totals["den"] or 0)


SCORING_EXPLANATION = (
    "Compliance % = weight of compliant answers / weight of all scored answers (compliant + non-compliant) x 100. "
    "Not-applicable answers are excluded from the denominator; text, date and unbounded numeric questions are "
    "informational unless the auditor records an explicit judgement; unanswered questions are never counted as "
    "compliant. Simple templates weight every question as 1. Department and organisation scores apply the same "
    "formula to all approved and completed audits in the period. Scores are internal indicators, not proof of "
    "legal or certification compliance."
)
