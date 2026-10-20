from django.test import TestCase

from apps.core.tests.factories import World, client_for
from apps.findings.models import AuditFinding, RiskAssessment
from apps.findings.services import calculate_risk
from apps.notifications.models import Notification


class RiskRuleTests(TestCase):
    def setUp(self):
        self.w = World()

    def test_default_thresholds(self):
        org = self.w.org
        self.assertEqual(calculate_risk(org, 5, 4), (20, "CRITICAL"))
        self.assertEqual(calculate_risk(org, 4, 3), (12, "HIGH"))
        self.assertEqual(calculate_risk(org, 3, 2), (6, "MEDIUM"))
        self.assertEqual(calculate_risk(org, 1, 5), (5, "LOW"))

    def test_thresholds_are_configurable(self):
        self.w.org.settings.risk_high_threshold = 5
        self.w.org.settings.save()
        self.assertEqual(calculate_risk(self.w.org, 1, 5)[1], "HIGH")

    def test_threshold_settings_validated(self):
        response = client_for(self.w.admin).patch("/api/organization/", {
            "settings": {"risk_critical_threshold": 10, "risk_high_threshold": 12}}, format="json")
        self.assertEqual(response.status_code, 400)


class FindingWorkflowTests(TestCase):
    def setUp(self):
        self.w = World(start=True)
        self.q = self.w.questions()
        self.auditor = client_for(self.w.auditor)

    def create(self, **extra):
        payload = {"audit": self.w.audit.id, "title": "Backups not tested", "description": "No restore test",
                   "owner": self.w.manager.id, **extra}
        return self.auditor.post("/api/findings/", payload, format="json")

    def test_auditor_creates_finding_with_calculated_severity(self):
        response = self.create(likelihood=4, impact=4)
        self.assertEqual(response.status_code, 201, response.json())
        body = response.json()
        self.assertTrue(body["reference"].startswith("FND-"))
        self.assertEqual((body["risk_score"], body["severity"]), (16, "HIGH"))
        self.assertEqual(body["department"]["id"], self.w.department.id)
        self.assertEqual(RiskAssessment.objects.filter(finding_id=body["id"]).count(), 1)
        self.assertTrue(Notification.objects.filter(recipient=self.w.manager,
                                                    notification_type="FINDING_ASSIGNED").exists())

    def test_finding_from_question_uses_configured_failure_severity(self):
        body = self.create(question=self.q["Q2"].id).json()  # failure_severity HIGH -> 4 x 3
        self.assertEqual((body["likelihood"], body["impact"], body["severity"]), (4, 3, "HIGH"))

    def test_unassigned_users_cannot_create(self):
        for user in (self.w.other_auditor, self.w.manager, self.w.owner):
            response = client_for(user).post("/api/findings/", {"audit": self.w.audit.id, "title": "x",
                                                                "description": "y"}, format="json")
            self.assertIn(response.status_code, (400, 403))

    def test_severity_override_needs_reviewer_and_reason(self):
        finding_id = self.create(likelihood=2, impact=2).json()["id"]
        url = f"/api/findings/{finding_id}/assess/"
        payload = {"likelihood": 2, "impact": 2, "override_severity": "CRITICAL"}
        self.assertEqual(self.auditor.post(url, {**payload, "rationale": "x"}, format="json").status_code, 403)
        reviewer = client_for(self.w.reviewer)
        self.assertEqual(reviewer.post(url, payload, format="json").status_code, 400)
        response = reviewer.post(url, {**payload, "rationale": "Regulatory exposure"}, format="json")
        self.assertEqual(response.json()["severity"], "CRITICAL")
        self.assertTrue(response.json()["severity_overridden"])
        latest = RiskAssessment.objects.filter(finding_id=finding_id).first()
        self.assertTrue(latest.is_override)
        self.assertEqual(latest.calculated_severity, "LOW")

    def test_close_requires_closed_actions_and_reviewer(self):
        finding = AuditFinding.objects.get(id=self.create().json()["id"])
        client_for(self.w.manager).post("/api/corrective-actions/", {
            "finding": finding.id, "title": "Fix", "description": "Do it", "owner": self.w.owner.id,
            "due_date": "2030-01-01"}, format="json")
        url = f"/api/findings/{finding.id}/close/"
        self.assertEqual(self.auditor.post(url, {"notes": "done"}).status_code, 403)
        self.assertEqual(client_for(self.w.reviewer).post(url, {"notes": "done"}).status_code, 409)
        accepted = client_for(self.w.audit_admin).post(url, {"notes": "Accepted by board", "accept_risk": True})
        self.assertEqual(accepted.json()["status"], "RISK_ACCEPTED")

    def test_findings_list_filters(self):
        self.create(likelihood=5, impact=5)
        self.create(likelihood=1, impact=1)
        response = client_for(self.w.audit_admin).get("/api/findings/?severity=CRITICAL")
        self.assertEqual(response.json()["count"], 1)
