from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.tests.factories import World, client_for
from apps.corrective_actions import services as action_services
from apps.findings import services as finding_services
from apps.notifications.models import Notification, NotificationPreference
from apps.notifications.reminders import reminder_bucket, run_reminders
from apps.notifications.services import notify


class ReminderBucketTests(TestCase):
    def test_bucket(self):
        self.assertEqual(reminder_bucket(10, [7, 3, 1]), None)
        self.assertEqual(reminder_bucket(7, [7, 3, 1]), 7)
        self.assertEqual(reminder_bucket(5, [7, 3, 1]), 7)
        self.assertEqual(reminder_bucket(2, [7, 3, 1]), 3)
        self.assertEqual(reminder_bucket(0, [7, 3, 1]), 1)


class ReminderJobTests(TestCase):
    def setUp(self):
        self.w = World(start=True)
        self.today = timezone.localdate()
        finding = finding_services.create_finding(self.w.auditor, {"audit": self.w.audit, "title": "Gap",
                                                                   "description": "x"})
        self.action = action_services.create_action(self.w.manager, {
            "finding": finding, "title": "Fix", "description": "x", "owner": self.w.owner,
            "due_date": self.today + timedelta(days=2)})
        Notification.objects.all().delete()

    def test_upcoming_deadlines_are_sent_once(self):
        self.w.audit.due_date = self.today + timedelta(days=3)
        self.w.audit.save()
        first = run_reminders(self.today)
        self.assertEqual(first["audit_due"], 1)
        self.assertEqual(first["action_due"], 1)
        second = run_reminders(self.today)
        self.assertEqual(second, {"audit_due": 0, "action_due": 0, "action_overdue": 0})
        self.assertEqual(Notification.objects.filter(notification_type="ACTION_DUE_SOON").count(), 1)

    def test_next_threshold_sends_a_new_reminder(self):
        run_reminders(self.today)                         # 2 days left -> bucket 3
        run_reminders(self.today + timedelta(days=1))     # 1 day left  -> bucket 1
        self.assertEqual(Notification.objects.filter(notification_type="ACTION_DUE_SOON").count(), 2)

    def test_overdue_notifies_owner_and_manager_and_repeats_by_interval(self):
        later = self.action.due_date + timedelta(days=1)
        totals = run_reminders(later)
        self.assertEqual(totals["action_overdue"], 2)
        recipients = set(Notification.objects.filter(notification_type="ACTION_OVERDUE")
                         .values_list("recipient_id", flat=True))
        self.assertEqual(recipients, {self.w.owner.id, self.w.manager.id})
        self.assertEqual(run_reminders(later + timedelta(days=3))["action_overdue"], 0)  # same 7-day period
        self.assertEqual(run_reminders(later + timedelta(days=7))["action_overdue"], 2)

    def test_reminder_days_configurable(self):
        self.w.org.settings.action_reminder_days = []
        self.w.org.settings.save()
        self.assertEqual(run_reminders(self.today)["action_due"], 0)


class NotificationApiTests(TestCase):
    def setUp(self):
        self.w = World()
        Notification.objects.all().delete()

    def test_dedupe_key(self):
        self.assertIsNotNone(notify(self.w.owner, "ACTION_OVERDUE", "t", dedupe_key="k1"))
        self.assertIsNone(notify(self.w.owner, "ACTION_OVERDUE", "t", dedupe_key="k1"))

    def test_preferences_disable_email_and_in_app(self):
        NotificationPreference.objects.create(user=self.w.owner, notification_type="ACTION_OVERDUE",
                                              in_app=False, email=False)
        n = notify(self.w.owner, "ACTION_OVERDUE", "t")
        self.assertTrue(n.is_read)
        self.assertEqual(n.email_status, "SKIPPED")

    def test_users_only_see_and_mark_their_own(self):
        mine = notify(self.w.owner, "ACTION_ASSIGNED", "mine")
        other = notify(self.w.manager, "ACTION_ASSIGNED", "other")
        client = client_for(self.w.owner)
        self.assertEqual(client.get("/api/notifications/").json()["count"], 1)
        self.assertEqual(client.post(f"/api/notifications/{other.id}/read/").status_code, 404)
        self.assertEqual(client.get("/api/notifications/unread-count/").json()["count"], 1)
        client.post(f"/api/notifications/{mine.id}/read/")
        self.assertEqual(client.get("/api/notifications/unread-count/").json()["count"], 0)

    def test_preferences_endpoint(self):
        client = client_for(self.w.owner)
        matrix = client.get("/api/notification-preferences/").json()
        self.assertTrue(all(row["email"] for row in matrix))
        updated = client.put("/api/notification-preferences/", [
            {"notification_type": "ACTION_OVERDUE", "in_app": True, "email": False}], format="json").json()
        self.assertFalse(next(r for r in updated if r["notification_type"] == "ACTION_OVERDUE")["email"])
