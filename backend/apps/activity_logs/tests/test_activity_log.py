from django.test import TestCase

from apps.activity_logs.models import AppendOnlyError, AuditActivityLog
from apps.activity_logs.services import log_activity, verify_chain
from apps.core.tests.factories import World, client_for


class ActivityLogTests(TestCase):
    def setUp(self):
        self.w = World()

    def test_entries_are_append_only(self):
        entry = log_activity(self.w.admin, "test.event", self.w.department)
        entry.action = "changed"
        with self.assertRaises(AppendOnlyError):
            entry.save()
        with self.assertRaises(AppendOnlyError):
            entry.delete()

    def test_hash_chain_detects_tampering(self):
        log_activity(self.w.admin, "test.one", self.w.department)
        tampered = log_activity(self.w.admin, "test.two", self.w.department, changes={"x": 1})
        log_activity(self.w.admin, "test.three", self.w.department)
        self.assertEqual(verify_chain(self.w.org), [])
        AuditActivityLog.objects.filter(pk=tampered.pk).update(changes={"x": 2})  # bypasses the model guard
        self.assertEqual(verify_chain(self.w.org), [tampered.pk])

    def test_only_administrators_can_read_logs(self):
        self.assertEqual(client_for(self.w.audit_admin).get("/api/activity-logs/").status_code, 200)
        for user in (self.w.auditor, self.w.manager, self.w.executive):
            self.assertEqual(client_for(user).get("/api/activity-logs/").status_code, 403)

    def test_no_write_endpoints(self):
        entry = log_activity(self.w.admin, "test.event", self.w.department)
        client = client_for(self.w.admin)
        self.assertEqual(client.delete(f"/api/activity-logs/{entry.id}/").status_code, 405)
        self.assertEqual(client.patch(f"/api/activity-logs/{entry.id}/", {"action": "x"}).status_code, 405)
        self.assertEqual(client.post("/api/activity-logs/", {"action": "x"}).status_code, 405)

    def test_integrity_endpoint(self):
        body = client_for(self.w.admin).get("/api/activity-logs/verify-integrity/").json()
        self.assertTrue(body["intact"])
