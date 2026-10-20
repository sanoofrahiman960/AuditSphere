from django.test import TestCase

from apps.accounts.roles import Role
from apps.core.tests.factories import client_for, make_department, make_org, make_user
from apps.departments.models import Department, DepartmentMembership


class DepartmentPermissionTests(TestCase):
    def setUp(self):
        self.org = make_org()
        self.admin = make_user(self.org, Role.SUPER_ADMIN)
        self.manager = make_user(self.org, Role.DEPT_MANAGER)
        self.auditor = make_user(self.org, Role.AUDITOR)
        self.dept = make_department(self.org, "IT", manager=self.manager)

    def test_admin_creates_department_and_manager_becomes_member(self):
        response = client_for(self.admin).post("/api/departments/", {"name": "Legal", "manager": self.manager.id})
        self.assertEqual(response.status_code, 201)
        dept = Department.objects.get(name="Legal")
        self.assertTrue(DepartmentMembership.objects.filter(department=dept, user=self.manager,
                                                            member_role="MANAGER").exists())

    def test_non_admin_cannot_create_or_edit(self):
        for user in (self.manager, self.auditor):
            client = client_for(user)
            self.assertEqual(client.post("/api/departments/", {"name": "X"}).status_code, 403)
            self.assertIn(client.patch(f"/api/departments/{self.dept.id}/", {"name": "Y"}).status_code, (403, 404))

    def test_duplicate_name_rejected_case_insensitively(self):
        response = client_for(self.admin).post("/api/departments/", {"name": "it"})
        self.assertEqual(response.status_code, 400)

    def test_delete_deactivates_and_keeps_record(self):
        client = client_for(self.admin)
        self.assertEqual(client.delete(f"/api/departments/{self.dept.id}/").status_code, 204)
        self.dept.refresh_from_db()
        self.assertFalse(self.dept.is_active)
        self.assertEqual(client.post(f"/api/departments/{self.dept.id}/activate/").status_code, 200)
        self.dept.refresh_from_db()
        self.assertTrue(self.dept.is_active)

    def test_manager_lists_only_departments_they_belong_to(self):
        make_department(self.org, "Finance")
        names = [d["name"] for d in client_for(self.manager).get("/api/departments/").json()["results"]]
        self.assertEqual(names, ["IT"])
        self.assertEqual(client_for(self.auditor).get("/api/departments/").json()["count"], 0)

    def test_membership_add_and_remove(self):
        client = client_for(self.admin)
        added = client.post(f"/api/departments/{self.dept.id}/members/", {"user": self.auditor.id,
                                                                          "member_role": "MEMBER"})
        self.assertEqual(added.status_code, 201)
        membership_id = added.json()["id"]
        self.assertEqual(client.delete(f"/api/departments/{self.dept.id}/members/{membership_id}/").status_code, 204)
        self.assertFalse(DepartmentMembership.objects.get(id=membership_id).is_active)

    def test_stats_endpoint(self):
        body = client_for(self.admin).get(f"/api/departments/{self.dept.id}/stats/").json()
        self.assertIn("summary", body)
        self.assertEqual(body["summary"]["total_audits"], 0)
