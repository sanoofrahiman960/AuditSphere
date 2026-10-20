from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.activity_logs.models import AuditActivityLog
from apps.core.tests.factories import PASSWORD, client_for, make_org, make_user


class AuthenticationTests(TestCase):
    def setUp(self):
        self.org = make_org()
        self.user = make_user(self.org, Role.AUDITOR, email="auditor@acme.test")
        self.client = APIClient()

    def login(self, email="auditor@acme.test", password=PASSWORD):
        return self.client.post("/api/auth/login/", {"email": email, "password": password}, format="json")

    def test_login_returns_tokens_and_profile(self):
        response = self.login(email="Auditor@ACME.test")  # case-insensitive email
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("access", body)
        self.assertIn("refresh", body)
        self.assertEqual(body["user"]["role"], Role.AUDITOR)
        self.assertIn("perform_audits", body["user"]["capabilities"])
        self.assertTrue(AuditActivityLog.objects.filter(action="auth.login", actor=self.user).exists())

    def test_wrong_password_is_rejected_with_uniform_error(self):
        response = self.login(password="nope")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(set(response.json()), {"detail", "code", "errors"})
        self.assertTrue(AuditActivityLog.objects.filter(action="auth.login_failed").exists())

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.login().status_code, 401)

    def test_user_without_organisation_cannot_login(self):
        User.objects.create_user(email="loose@x.test", password=PASSWORD, role=Role.AUDITOR)
        self.assertEqual(self.login(email="loose@x.test").status_code, 400)

    def test_protected_endpoint_requires_token(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_refresh_and_logout_blacklists_refresh_token(self):
        tokens = self.login().json()
        refreshed = self.client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 200)
        new_refresh = refreshed.json()["refresh"]  # rotation issues a new refresh token
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + refreshed.json()["access"])
        self.assertEqual(self.client.post("/api/auth/logout/", {"refresh": new_refresh}, format="json").status_code, 204)
        self.client.credentials()
        again = self.client.post("/api/auth/refresh/", {"refresh": new_refresh}, format="json")
        self.assertEqual(again.status_code, 401)

    def test_change_password(self):
        client = client_for(self.user)
        bad = client.post("/api/auth/change-password/", {"current_password": "wrong", "new_password": "N3w-Secret-Phrase!"})
        self.assertEqual(bad.status_code, 400)
        ok = client.post("/api/auth/change-password/",
                         {"current_password": PASSWORD, "new_password": "N3w-Secret-Phrase!"})
        self.assertEqual(ok.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("N3w-Secret-Phrase!"))

    def test_profile_update_cannot_change_role(self):
        client = client_for(self.user)
        response = client.patch("/api/auth/me/", {"job_title": "Lead", "role": Role.SUPER_ADMIN}, format="json")
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.job_title, "Lead")
        self.assertEqual(self.user.role, Role.AUDITOR)


class UserManagementTests(TestCase):
    def setUp(self):
        self.org = make_org()
        self.admin = make_user(self.org, Role.SUPER_ADMIN)
        self.auditor = make_user(self.org, Role.AUDITOR)

    def test_only_super_admin_creates_users(self):
        payload = {"email": "new@acme.test", "first_name": "New", "last_name": "User", "role": Role.REVIEWER,
                   "password": "An0ther-Strong-Pass!"}
        self.assertEqual(client_for(self.auditor).post("/api/users/", payload).status_code, 403)
        response = client_for(self.admin).post("/api/users/", payload)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(email="new@acme.test").organization, self.org)

    def test_role_change_is_logged_as_permission_change(self):
        response = client_for(self.admin).patch(f"/api/users/{self.auditor.id}/", {"role": Role.REVIEWER})
        self.assertEqual(response.status_code, 200)
        log = AuditActivityLog.objects.get(action="user.permissions_changed")
        self.assertEqual(log.changes["role"], {"from": Role.AUDITOR, "to": Role.REVIEWER})

    def test_admin_cannot_demote_self(self):
        response = client_for(self.admin).patch(f"/api/users/{self.admin.id}/", {"role": Role.AUDITOR})
        self.assertEqual(response.status_code, 400)

    def test_weak_password_rejected(self):
        response = client_for(self.admin).post("/api/users/", {
            "email": "weak@acme.test", "first_name": "W", "last_name": "P", "role": Role.AUDITOR, "password": "123"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json()["errors"])
