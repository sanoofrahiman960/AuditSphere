"""Organisation isolation and department-level visibility."""
from django.test import TestCase

from apps.accounts.roles import Role
from apps.audits import services as audit_services
from apps.core.tests.factories import World, client_for, make_user


class OrganisationIsolationTests(TestCase):
    def setUp(self):
        self.acme = World("acme", start=True)
        self.globex = World("globex")

    def test_lists_never_include_other_organisation_rows(self):
        client = client_for(self.globex.admin)
        for url in ("/api/audits/", "/api/departments/", "/api/audit-templates/", "/api/users/",
                    "/api/findings/", "/api/corrective-actions/", "/api/activity-logs/"):
            rows = client.get(url).json()["results"]
            ids = {r["id"] for r in rows}
            if url == "/api/audits/":
                self.assertNotIn(self.acme.audit.id, ids)
                self.assertIn(self.globex.audit.id, ids)
            if url == "/api/users/":
                self.assertFalse({r["email"] for r in rows} & {self.acme.admin.email})

    def test_detail_of_other_organisation_object_is_404(self):
        client = client_for(self.globex.admin)
        self.assertEqual(client.get(f"/api/audits/{self.acme.audit.id}/").status_code, 404)
        self.assertEqual(client.get(f"/api/departments/{self.acme.department.id}/").status_code, 404)
        self.assertEqual(client.post(f"/api/audits/{self.acme.audit.id}/cancel/", {"reason": "x"}).status_code, 404)

    def test_cannot_reference_other_organisation_objects_on_create(self):
        client = client_for(self.globex.audit_admin)
        response = client.post("/api/audits/", {
            "title": "Cross-tenant", "department": self.acme.department.id,
            "template_version": self.acme.template.current_approved_version.id,
            "planned_start_date": "2026-01-01", "due_date": "2026-01-10",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("department", response.json()["errors"])
        self.assertIn("template_version", response.json()["errors"])

    def test_dashboard_counts_are_scoped(self):
        summary = client_for(self.globex.executive).get("/api/dashboard/summary/").json()
        self.assertEqual(summary["total_audits"], 1)


class DepartmentVisibilityTests(TestCase):
    def setUp(self):
        self.w = World(start=True)

    def test_manager_sees_only_own_department_audits(self):
        other_template_audit = audit_services.create_audit(self.w.audit_admin, {
            "title": "Sales audit", "department": self.w.other_department,
            "template_version": self.w.template.current_approved_version,
            "planned_start_date": "2026-01-01", "due_date": "2026-01-20",
            "lead_auditor": self.w.other_auditor, "reviewer": self.w.reviewer,
        })
        audit_services.schedule(self.w.audit_admin, other_template_audit)
        ids = {a["id"] for a in client_for(self.w.manager).get("/api/audits/").json()["results"]}
        self.assertEqual(ids, {self.w.audit.id})
        self.assertEqual(client_for(self.w.manager).get(f"/api/audits/{other_template_audit.id}/").status_code, 404)

    def test_manager_does_not_see_draft_audits(self):
        draft = audit_services.create_audit(self.w.audit_admin, {
            "title": "Draft", "department": self.w.department,
            "template_version": self.w.template.current_approved_version,
            "planned_start_date": "2026-01-01", "due_date": "2026-01-20",
        })
        self.assertEqual(client_for(self.w.manager).get(f"/api/audits/{draft.id}/").status_code, 404)

    def test_unassigned_auditor_cannot_see_audit(self):
        self.assertEqual(client_for(self.w.other_auditor).get(f"/api/audits/{self.w.audit.id}/").status_code, 404)

    def test_executive_reads_everything_but_cannot_write(self):
        client = client_for(self.w.executive)
        self.assertEqual(client.get(f"/api/audits/{self.w.audit.id}/").status_code, 200)
        self.assertEqual(client.post("/api/findings/", {"audit": self.w.audit.id, "title": "x",
                                                        "description": "y"}).status_code, 403)
        self.assertEqual(client.post("/api/departments/", {"name": "New"}).status_code, 403)

    def test_action_owner_sees_nothing_until_assigned(self):
        owner = make_user(self.w.org, Role.ACTION_OWNER)
        client = client_for(owner)
        self.assertEqual(client.get("/api/audits/").json()["count"], 0)
        self.assertEqual(client.get("/api/corrective-actions/").json()["count"], 0)
