from decimal import Decimal

from django.test import TestCase

from apps.audits import scoring
from apps.audits import services as audit_services
from apps.audits.models import AuditResponse
from apps.audit_templates.models import AuditQuestion
from apps.core.tests.factories import World, make_audit, make_template

C = AuditResponse.Compliance


class EvaluateTests(TestCase):
    def q(self, **kw):
        return AuditQuestion(text="t", **kw)

    def r(self, **kw):
        return AuditResponse(**kw)

    def test_yes_no_and_na(self):
        q = self.q(response_type="YES_NO_NA")
        self.assertEqual(scoring.evaluate(q, self.r(choice_value="YES")), C.COMPLIANT)
        self.assertEqual(scoring.evaluate(q, self.r(choice_value="NO")), C.NON_COMPLIANT)
        self.assertEqual(scoring.evaluate(q, self.r(choice_value="NA")), C.NOT_APPLICABLE)
        self.assertEqual(scoring.evaluate(q, self.r(choice_value="")), C.UNANSWERED)
        self.assertEqual(scoring.evaluate(q, None), C.UNANSWERED)

    def test_rating_threshold(self):
        q = self.q(response_type="RATING", rating_max=5, rating_pass_threshold=3)
        self.assertEqual(scoring.evaluate(q, self.r(rating_value=3)), C.COMPLIANT)
        self.assertEqual(scoring.evaluate(q, self.r(rating_value=2)), C.NON_COMPLIANT)

    def test_numeric_bounds_and_informational(self):
        bounded = self.q(response_type="NUMBER", numeric_min=Decimal("90"), numeric_max=Decimal("100"))
        self.assertEqual(scoring.evaluate(bounded, self.r(number_value=Decimal("95"))), C.COMPLIANT)
        self.assertEqual(scoring.evaluate(bounded, self.r(number_value=Decimal("80"))), C.NON_COMPLIANT)
        free = self.q(response_type="NUMBER")
        self.assertEqual(scoring.evaluate(free, self.r(number_value=Decimal("5"))), C.INFORMATIONAL)
        self.assertEqual(scoring.evaluate(free, self.r(number_value=Decimal("5"), manual_assessment="NON_COMPLIANT")),
                         C.NON_COMPLIANT)

    def test_text_is_informational_unless_judged(self):
        q = self.q(response_type="TEXT")
        self.assertEqual(scoring.evaluate(q, self.r(text_value="  ")), C.UNANSWERED)
        self.assertEqual(scoring.evaluate(q, self.r(text_value="ok")), C.INFORMATIONAL)
        self.assertEqual(scoring.evaluate(q, self.r(text_value="ok", manual_assessment="COMPLIANT")), C.COMPLIANT)

    def test_not_applicable_flag_overrides_any_type(self):
        q = self.q(response_type="PASS_FAIL")
        self.assertEqual(scoring.evaluate(q, self.r(choice_value="FAIL", is_not_applicable=True)), C.NOT_APPLICABLE)


class RecalculateTests(TestCase):
    def setUp(self):
        self.w = World(start=True)
        self.q = self.w.questions()

    def answer(self, audit, items):
        return audit_services.save_responses(self.w.auditor, audit, items)

    def test_simple_score_excludes_na_and_unanswered(self):
        audit = self.answer(self.w.audit, [
            {"question_id": self.q["Q1"].id, "choice_value": "YES"},
            {"question_id": self.q["Q2"].id, "choice_value": "FAIL"},
            {"question_id": self.q["Q3"].id, "choice_value": "NA"},
            {"question_id": self.q["Q5"].id, "text_value": "notes"},  # informational
        ])
        self.assertEqual(audit.compliance_score, Decimal("50.00"))  # 1 of 2 scored
        self.assertEqual(audit.not_applicable_count, 1)
        self.assertEqual(audit.answered_count, 4)
        self.assertEqual(audit.mandatory_unanswered_count, 0)

    def test_unanswered_mandatory_is_not_compliant(self):
        audit = self.answer(self.w.audit, [{"question_id": self.q["Q1"].id, "choice_value": "YES"}])
        self.assertEqual(audit.mandatory_unanswered_count, 2)
        self.assertEqual(audit.compliance_score, Decimal("100.00"))  # only answered checks scored
        self.assertGreater(len(audit_services.validation_issues(audit)), 0)

    def test_no_scored_answers_gives_no_score(self):
        audit = self.answer(self.w.audit, [{"question_id": self.q["Q3"].id, "choice_value": "NA"}])
        self.assertIsNone(audit.compliance_score)

    def test_weighted_scoring(self):
        template = make_template(self.w.org, self.w.audit_admin, self.w.department, scoring_method="WEIGHTED",
                                 name="Weighted")
        audit = make_audit(self.w.audit_admin, self.w.department, template, self.w.auditor, self.w.reviewer,
                           start=True)
        q = {x.code: x for x in AuditQuestion.objects.filter(section__version=audit.template_version)}
        audit = self.answer(audit, [
            {"question_id": q["Q1"].id, "choice_value": "YES"},   # weight 1 compliant
            {"question_id": q["Q2"].id, "choice_value": "FAIL"},  # weight 3 non-compliant
        ])
        self.assertEqual(audit.compliance_score, Decimal("25.00"))

    def test_aggregate_score_uses_same_formula(self):
        from apps.audits.models import Audit

        audit = self.answer(self.w.audit, [
            {"question_id": self.q["Q1"].id, "choice_value": "YES"},
            {"question_id": self.q["Q2"].id, "choice_value": "PASS"},
            {"question_id": self.q["Q3"].id, "choice_value": "NO"},
        ])
        Audit.objects.filter(pk=audit.pk).update(status="COMPLETED")
        self.assertEqual(scoring.aggregate_score(Audit.objects.filter(pk=audit.pk)), Decimal("66.67"))
