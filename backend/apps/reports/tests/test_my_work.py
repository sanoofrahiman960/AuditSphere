from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.audits.models import Audit
from apps.core.tests.factories import World, client_for
from apps.corrective_actions import services as action_services
from apps.corrective_actions.models import CorrectiveAction
from apps.findings import services as finding_services


class MyWorkTests(TestCase):
    def setUp(self):
        self.w = World(start=True)
        finding = finding_services.create_finding(self.w.auditor, {"audit": self.w.audit, "title": "Gap",
                                                                   "description": "x"})
        self.action = action_services.create_action(self.w.manager, {
            "finding": finding, "title": "Fix", "description": "x", "owner": self.w.owner,
            "due_date": timezone.localdate() + timedelta(days=5)})

    def sections(self, user):
        body = client_for(user).get("/api/dashboard/my-work/").json()
        return {s["key"]: s for s in body["sections"]}

    def test_auditor_sees_audits_to_perform(self):
        s = self.sections(self.w.auditor)
        self.assertEqual([i["id"] for i in s["perform"]["items"]], [self.w.audit.id])
        self.assertEqual(s["review"]["count"], 0)
        self.assertNotIn("department_overdue", s)

    def test_reviewer_sees_submitted_audits_and_actions_to_verify(self):
        Audit.objects.filter(pk=self.w.audit.pk).update(status=Audit.Status.SUBMITTED)
        action_services.submit_for_verification(self.w.owner, self.action, "Done")
        s = self.sections(self.w.reviewer)
        self.assertEqual(s["review"]["items"][0]["kind"], "review")
        self.assertEqual([i["id"] for i in s["verify"]["items"]], [self.action.id])

    def test_owner_sees_own_actions_and_never_verifies_them(self):
        action_services.submit_for_verification(self.w.owner, self.action, "Done")
        s = self.sections(self.w.owner)
        self.assertEqual([i["id"] for i in s["my_actions"]["items"]], [self.action.id])
        self.assertEqual(s["verify"]["count"], 0)

    def test_manager_sees_overdue_actions_in_their_department(self):
        CorrectiveAction.objects.filter(pk=self.action.pk).update(due_date=timezone.localdate() - timedelta(days=3))
        s = self.sections(self.w.manager)
        self.assertEqual(s["department_overdue"]["items"][0]["days_left"], -3)
        self.assertNotIn("department_overdue", self.sections(self.w.other_auditor))
        self.assertEqual(self.sections(self.w.other_manager)["department_overdue"]["count"], 0)
