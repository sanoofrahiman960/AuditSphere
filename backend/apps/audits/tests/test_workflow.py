import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from apps.accounts.roles import Role
from apps.audits.models import Audit, AuditAssignment
from apps.core.tests.factories import World, client_for, make_user
from apps.notifications.models import Notification

MEDIA = tempfile.mkdtemp()


def full_answers(q, q2="PASS", q3="YES"):
    return {"responses": [
        {"question_id": q["Q1"].id, "choice_value": "YES"},
        {"question_id": q["Q2"].id, "choice_value": q2},
        {"question_id": q["Q3"].id, "choice_value": q3},
    ]}


@override_settings(MEDIA_ROOT=MEDIA)
class AuditCreationTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.w = World()

    def payload(self, **overrides):
        data = {
            "title": "Q3 Finance", "department": self.w.department.id,
            "template_version": self.w.template.current_approved_version.id, "audit_type": "FINANCIAL",
            "planned_start_date": "2026-11-01", "due_date": "2026-11-20", "lead_auditor": self.w.auditor.id,
            "reviewer": self.w.reviewer.id, "team_member_ids": [self.w.other_auditor.id], "priority": "HIGH",
        }
        data.update(overrides)
        return data

    def test_audit_admin_creates_audit_with_reference_and_assignments(self):
        response = client_for(self.w.audit_admin).post("/api/audits/", self.payload(), format="json")
        self.assertEqual(response.status_code, 201, response.json())
        body = response.json()
        self.assertTrue(body["reference"].startswith("AUD-"))
        self.assertEqual(body["status"], "DRAFT")
        roles = set(AuditAssignment.objects.filter(audit_id=body["id"], is_active=True)
                    .values_list("assignment_role", flat=True))
        self.assertEqual(roles, {"LEAD_AUDITOR", "REVIEWER", "AUDITOR"})

    def test_auditor_cannot_plan_audits(self):
        self.assertEqual(client_for(self.w.auditor).post("/api/audits/", self.payload(), format="json").status_code, 403)

    def test_validation_rules(self):
        client = client_for(self.w.audit_admin)
        same = client.post("/api/audits/", self.payload(reviewer=self.w.auditor.id), format="json")
        self.assertIn("reviewer", same.json()["errors"])
        dates = client.post("/api/audits/", self.payload(due_date="2026-10-01"), format="json")
        self.assertIn("due_date", dates.json()["errors"])
        role = client.post("/api/audits/", self.payload(lead_auditor=self.w.owner.id), format="json")
        self.assertIn("lead_auditor", role.json()["errors"])

    def test_unapproved_template_version_rejected(self):
        from apps.audit_templates import services

        draft = services.new_version(self.w.audit_admin, self.w.template)
        response = client_for(self.w.audit_admin).post("/api/audits/", self.payload(template_version=draft.id),
                                                       format="json")
        self.assertEqual(response.status_code, 400)

    def test_scheduling_notifies_assignees(self):
        audit = client_for(self.w.audit_admin).post("/api/audits/", self.payload(), format="json").json()
        Notification.objects.all().delete()
        response = client_for(self.w.audit_admin).post(f"/api/audits/{audit['id']}/schedule/")
        self.assertEqual(response.json()["status"], "SCHEDULED")
        notified = set(Notification.objects.filter(notification_type="AUDIT_ASSIGNED")
                       .values_list("recipient_id", flat=True))
        self.assertEqual(notified, {self.w.auditor.id, self.w.reviewer.id, self.w.other_auditor.id})

    def test_template_version_is_preserved_after_new_version(self):
        from apps.audit_templates import services

        original = self.w.audit.template_version_id
        new = services.new_version(self.w.audit_admin, self.w.template)
        services.approve_version(self.w.audit_admin, new)
        self.w.audit.refresh_from_db()
        self.assertEqual(self.w.audit.template_version_id, original)
        detail = client_for(self.w.audit_admin).get(f"/api/template-versions/{original}/").json()
        self.assertEqual(detail["status"], "ARCHIVED")
        self.assertFalse(detail["is_editable"])


@override_settings(MEDIA_ROOT=MEDIA)
class AuditExecutionAndReviewTests(TestCase):
    def setUp(self):
        self.w = World(start=True)
        self.q = self.w.questions()
        self.auditor = client_for(self.w.auditor)
        self.url = f"/api/audits/{self.w.audit.id}"

    def upload_evidence_for(self, question_code):
        workspace = self.auditor.get(f"{self.url}/workspace/").json()
        response_id = next(q["response"]["id"] for s in workspace["sections"] for q in s["questions"]
                           if q["code"] == question_code)
        file = SimpleUploadedFile("proof.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        return self.auditor.post(f"{self.url}/evidence/", {"file": file, "response_id": response_id},
                                 format="multipart")

    def submit_ready(self):
        self.auditor.put(f"{self.url}/responses/", full_answers(self.q), format="json")
        self.assertEqual(self.upload_evidence_for("Q2").status_code, 201)

    def test_only_team_can_start_and_answer(self):
        other = client_for(self.w.other_auditor)
        self.assertEqual(other.put(f"{self.url}/responses/", full_answers(self.q), format="json").status_code, 404)
        reviewer = client_for(self.w.reviewer)
        self.assertEqual(reviewer.put(f"{self.url}/responses/", full_answers(self.q), format="json").status_code, 403)

    def test_responses_are_saved_and_preserved(self):
        response = self.auditor.put(f"{self.url}/responses/", {
            "responses": [{"question_id": self.q["Q1"].id, "choice_value": "NO", "observation": "Missing"}],
            "overall_summary": "Draft summary",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        again = self.auditor.get(f"{self.url}/workspace/").json()
        q1 = next(q for s in again["sections"] for q in s["questions"] if q["code"] == "Q1")
        self.assertEqual(q1["response"]["choice_value"], "NO")
        self.assertEqual(q1["response"]["compliance"], "NON_COMPLIANT")
        self.assertEqual(again["audit"]["overall_summary"], "Draft summary")
        self.assertEqual(again["audit"]["answered_count"], 1)

    def test_invalid_answer_for_question_type_rejected(self):
        response = self.auditor.put(f"{self.url}/responses/", {
            "responses": [{"question_id": self.q["Q1"].id, "choice_value": "PASS"}]}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submission_blocked_when_mandatory_missing(self):
        response = self.auditor.post(f"{self.url}/submit/")
        self.assertEqual(response.status_code, 400)
        codes = {i["code"] for i in response.json()["errors"]["issues"]}
        self.assertEqual(codes, {"mandatory_unanswered"})

    def test_submission_blocked_without_required_evidence(self):
        self.auditor.put(f"{self.url}/responses/", full_answers(self.q), format="json")
        response = self.auditor.post(f"{self.url}/submit/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual([i["code"] for i in response.json()["errors"]["issues"]], ["evidence_missing"])

    def test_failed_check_requiring_action_needs_finding(self):
        self.auditor.put(f"{self.url}/responses/", full_answers(self.q, q3="NO"), format="json")
        self.upload_evidence_for("Q2")
        response = self.auditor.post(f"{self.url}/submit/")
        self.assertEqual([i["code"] for i in response.json()["errors"]["issues"]], ["finding_required"])
        created = self.auditor.post("/api/findings/", {"audit": self.w.audit.id, "question": self.q["Q3"].id,
                                                       "title": "Gap", "description": "Control absent"})
        self.assertEqual(created.status_code, 201, created.json())
        self.assertEqual(self.auditor.post(f"{self.url}/submit/").status_code, 200)

    def test_full_review_cycle(self):
        self.submit_ready()
        submitted = self.auditor.post(f"{self.url}/submit/")
        self.assertEqual(submitted.status_code, 200, submitted.json())
        self.assertEqual(submitted.json()["status"], "SUBMITTED")
        self.assertEqual(float(submitted.json()["compliance_score"]), 100.0)
        self.assertTrue(Notification.objects.filter(recipient=self.w.reviewer,
                                                    notification_type="AUDIT_SUBMITTED").exists())
        # Responses are locked while under review
        self.assertEqual(self.auditor.put(f"{self.url}/responses/", full_answers(self.q), format="json").status_code, 409)
        # The auditor cannot approve their own audit, nor can another auditor
        self.assertEqual(self.auditor.post(f"{self.url}/approve/").status_code, 403)
        reviewer = client_for(self.w.reviewer)
        self.assertEqual(reviewer.post(f"{self.url}/request-rework/", {"comments": ""}).status_code, 400)
        rework = reviewer.post(f"{self.url}/request-rework/", {"comments": "Add sample list"})
        self.assertEqual(rework.json()["status"], "REWORK_REQUIRED")
        self.assertEqual(self.auditor.post(f"{self.url}/start/").json()["status"], "IN_PROGRESS")
        self.auditor.post(f"{self.url}/submit/")
        approved = reviewer.post(f"{self.url}/approve/", {"comments": "Good"})
        self.assertEqual(approved.json()["status"], "APPROVED")
        completed = reviewer.post(f"{self.url}/complete/")
        self.assertEqual(completed.json()["status"], "COMPLETED")
        self.assertEqual(len(reviewer.get(f"{self.url}/reviews/").json()), 2)
        history = [h["action"] for h in reviewer.get(f"{self.url}/history/").json()]
        self.assertIn("audit.approved", history)

    def test_review_cannot_be_bypassed(self):
        reviewer = client_for(self.w.reviewer)
        self.assertEqual(reviewer.post(f"{self.url}/approve/").status_code, 409)  # still in progress
        self.assertEqual(reviewer.post(f"{self.url}/complete/").status_code, 409)

    def test_admin_on_audit_team_cannot_review_own_work(self):
        admin_auditor = make_user(self.w.org, Role.AUDIT_ADMIN)
        from apps.core.tests.factories import make_audit

        audit = make_audit(self.w.audit_admin, self.w.department, self.w.template, admin_auditor, self.w.reviewer,
                           start=True)
        audit.status = Audit.Status.SUBMITTED
        audit.save()
        response = client_for(admin_auditor).post(f"/api/audits/{audit.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_cancel_and_reopen_require_reason(self):
        admin = client_for(self.w.audit_admin)
        self.assertEqual(admin.post(f"{self.url}/cancel/", {}).status_code, 400)
        self.assertEqual(admin.post(f"{self.url}/cancel/", {"reason": "Duplicate"}).json()["status"], "CANCELLED")
        self.assertEqual(self.auditor.post(f"{self.url}/reopen/", {"reason": "x"}).status_code, 403)
        reopened = admin.post(f"{self.url}/reopen/", {"reason": "Needed after all"})
        self.assertEqual(reopened.json()["status"], "IN_PROGRESS")
        self.assertEqual(reopened.json()["status_reason"], "Needed after all")

    def test_only_draft_audits_can_be_deleted(self):
        self.assertEqual(client_for(self.w.audit_admin).delete(self.url + "/").status_code, 409)
