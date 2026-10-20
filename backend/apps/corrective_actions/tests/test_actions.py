import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.core.tests.factories import World, client_for
from apps.corrective_actions.models import ActionStatusChange, CorrectiveAction
from apps.findings import services as finding_services
from apps.notifications.models import Notification

MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA)
class CorrectiveActionWorkflowTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.w = World(start=True)
        self.finding = finding_services.create_finding(self.w.auditor, {
            "audit": self.w.audit, "title": "Gap", "description": "Missing control", "owner": self.w.manager})
        self.manager = client_for(self.w.manager)
        self.owner = client_for(self.w.owner)
        self.reviewer = client_for(self.w.reviewer)

    def create_action(self, client=None, **extra):
        payload = {"finding": self.finding.id, "title": "Implement control", "description": "Write the SOP",
                   "owner": self.w.owner.id, "due_date": str(timezone.localdate() + timedelta(days=30)),
                   "priority": "HIGH", **extra}
        return (client or self.manager).post("/api/corrective-actions/", payload, format="json")

    def test_department_manager_assigns_action_and_owner_is_notified(self):
        response = self.create_action()
        self.assertEqual(response.status_code, 201, response.json())
        self.assertTrue(response.json()["reference"].startswith("CA-"))
        self.assertTrue(Notification.objects.filter(recipient=self.w.owner,
                                                    notification_type="ACTION_ASSIGNED").exists())

    def test_other_department_manager_and_auditor_cannot_assign(self):
        self.assertIn(self.create_action(client_for(self.w.other_manager)).status_code, (400, 403))
        self.assertEqual(self.create_action(client_for(self.w.auditor)).status_code, 403)

    def test_owner_updates_progress_but_not_due_date(self):
        action_id = self.create_action().json()["id"]
        url = f"/api/corrective-actions/{action_id}/"
        self.assertEqual(self.owner.patch(url, {"progress": 50}, format="json").json()["progress"], 50)
        self.assertEqual(self.owner.patch(url, {"due_date": "2031-01-01"}, format="json").status_code, 403)
        self.assertEqual(self.manager.patch(url, {"due_date": "2031-01-01"}, format="json").status_code, 200)

    def test_full_verification_cycle_with_history(self):
        action_id = self.create_action().json()["id"]
        url = f"/api/corrective-actions/{action_id}"
        self.assertEqual(self.owner.post(f"{url}/start/").json()["status"], "IN_PROGRESS")
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, "IN_PROGRESS")
        self.assertEqual(self.owner.post(f"{url}/submit-verification/", {}).status_code, 400)  # notes needed
        upload = self.owner.post(f"{url}/evidence/", {"file": SimpleUploadedFile("sop.pdf", b"%PDF-1.4")},
                                 format="multipart")
        self.assertEqual(upload.status_code, 201)
        submitted = self.owner.post(f"{url}/submit-verification/", {"resolution_notes": "SOP published"})
        self.assertEqual(submitted.json()["status"], "PENDING_VERIFICATION")
        self.assertTrue(Notification.objects.filter(recipient=self.w.reviewer,
                                                    notification_type="ACTION_VERIFICATION_REQUESTED").exists())
        self.assertEqual(self.reviewer.post(f"{url}/verify/", {"approved": False}).status_code, 400)
        rejected = self.reviewer.post(f"{url}/verify/", {"approved": False, "notes": "Need sign-off"})
        self.assertEqual(rejected.json()["status"], "REWORK_REQUIRED")
        self.assertTrue(Notification.objects.filter(recipient=self.w.owner,
                                                    notification_type="ACTION_REJECTED").exists())
        self.owner.post(f"{url}/submit-verification/", {"resolution_notes": "Signed off by CFO"})
        closed = self.reviewer.post(f"{url}/verify/", {"approved": True, "notes": "Effective"})
        self.assertEqual(closed.json()["status"], "CLOSED")
        self.assertEqual(closed.json()["verification_result"], "EFFECTIVE")
        self.finding.refresh_from_db()
        self.assertEqual(self.finding.status, "RESOLVED")
        transitions = list(ActionStatusChange.objects.filter(action_id=action_id).values_list("to_status", flat=True))
        self.assertEqual(transitions, ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "REWORK_REQUIRED",
                                       "PENDING_VERIFICATION", "CLOSED"])
        # Closed actions are locked; reviewer can reopen with a reason
        self.assertEqual(self.owner.patch(f"{url}/", {"progress": 10}, format="json").status_code, 409)
        self.assertEqual(self.reviewer.post(f"{url}/reopen/", {"notes": "Recurred"}).json()["status"],
                         "REWORK_REQUIRED")

    def test_owner_cannot_verify_own_action_unless_policy_allows(self):
        # The reviewer owns this action: verification capability alone is not enough.
        action_id = self.create_action(owner=self.w.reviewer.id).json()["id"]
        url = f"/api/corrective-actions/{action_id}"
        self.reviewer.post(f"{url}/submit-verification/", {"resolution_notes": "Done"})
        self.assertEqual(self.reviewer.post(f"{url}/verify/", {"approved": True}).status_code, 403)
        self.w.org.settings.allow_self_verification = True
        self.w.org.settings.save()
        self.assertEqual(self.reviewer.post(f"{url}/verify/", {"approved": True}).json()["status"], "CLOSED")

    def test_action_owner_cannot_verify(self):
        action_id = self.create_action().json()["id"]
        self.owner.post(f"/api/corrective-actions/{action_id}/submit-verification/", {"resolution_notes": "Done"})
        self.assertEqual(self.owner.post(f"/api/corrective-actions/{action_id}/verify/",
                                         {"approved": True}).status_code, 403)

    def test_overdue_is_derived_and_filterable(self):
        action_id = self.create_action().json()["id"]
        CorrectiveAction.objects.filter(id=action_id).update(due_date=timezone.localdate() - timedelta(days=2))
        body = self.manager.get("/api/corrective-actions/?overdue=true").json()
        self.assertEqual(body["count"], 1)
        self.assertTrue(body["results"][0]["is_overdue"])

    def test_comments(self):
        action_id = self.create_action().json()["id"]
        url = f"/api/corrective-actions/{action_id}/comments/"
        self.assertEqual(self.owner.post(url, {"body": "Working on it"}).status_code, 201)
        self.assertEqual(client_for(self.w.executive).post(url, {"body": "Hi"}).status_code, 403)
        self.assertEqual(len(self.manager.get(url).json()), 1)
