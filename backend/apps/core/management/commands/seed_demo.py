"""
Development seed data: one demo organisation with users for every role, departments, approved sample
templates, and audits in every lifecycle state with responses, evidence, findings and corrective actions.

All records are created through the same services the API uses, so workflow rules, scoring,
notifications and the activity log behave exactly as they would for real data.

    python manage.py seed_demo            # refuses to run when DJANGO_DEBUG is false
"""
import os
import random
from datetime import datetime, time, timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.audit_templates.loader import load_sample_templates
from apps.audit_templates.models import AuditQuestion, AuditTemplate
from apps.audit_templates.sample_data import SAMPLE_DEPARTMENTS
from apps.audits import services as audits
from apps.audits.models import Audit
from apps.corrective_actions import services as actions
from apps.departments.models import Department, DepartmentMembership
from apps.findings import services as findings
from apps.findings.models import AuditFinding
from apps.notifications.reminders import run_reminders
from apps.organizations.models import Organization

RT = AuditQuestion.ResponseType

USERS = [
    # email prefix, first, last, role, job title
    ("admin", "Sarah", "Mitchell", Role.SUPER_ADMIN, "Head of Governance"),
    ("audit.admin", "David", "Chen", Role.AUDIT_ADMIN, "Internal Audit Manager"),
    ("auditor1", "Priya", "Nair", Role.AUDITOR, "Senior Internal Auditor"),
    ("auditor2", "James", "Okafor", Role.AUDITOR, "Internal Auditor"),
    ("auditor3", "Elena", "Rossi", Role.AUDITOR, "IT Auditor"),
    ("reviewer", "Michael", "Brown", Role.REVIEWER, "Audit Quality Reviewer"),
    ("reviewer2", "Aisha", "Rahman", Role.REVIEWER, "Compliance Reviewer"),
    ("it.manager", "Tom", "Fischer", Role.DEPT_MANAGER, "IT Manager"),
    ("finance.manager", "Laura", "Gómez", Role.DEPT_MANAGER, "Finance Controller"),
    ("ops.manager", "Ravi", "Patel", Role.DEPT_MANAGER, "Operations Manager"),
    ("hr.manager", "Grace", "Kim", Role.DEPT_MANAGER, "HR Manager"),
    ("sales.manager", "Omar", "Haddad", Role.DEPT_MANAGER, "Sales Director"),
    ("procurement.manager", "Nina", "Kowalski", Role.DEPT_MANAGER, "Procurement Lead"),
    ("admin.manager", "Peter", "Lindqvist", Role.DEPT_MANAGER, "Facilities Manager"),
    ("owner1", "Carlos", "Mendes", Role.ACTION_OWNER, "Systems Administrator"),
    ("owner2", "Hannah", "Wright", Role.ACTION_OWNER, "Accounts Payable Lead"),
    ("owner3", "Yusuf", "Demir", Role.ACTION_OWNER, "Operations Analyst"),
    ("exec", "Catherine", "Moore", Role.EXECUTIVE, "Chief Operating Officer"),
]

DEPT_MANAGERS = {
    "IT": "it.manager", "Finance": "finance.manager", "Business Operations": "ops.manager",
    "Human Resources": "hr.manager", "Sales": "sales.manager", "Procurement": "procurement.manager",
    "Administration": "admin.manager",
}
DEPT_MEMBERS = {"IT": ["owner1"], "Finance": ["owner2"], "Business Operations": ["owner3"],
                "Procurement": ["owner2"]}

# (department, template name, target status, months ago (planned start), lead, reviewer, compliance rate)
AUDIT_PLAN = [
    ("IT", "IT General Controls Audit", "COMPLETED", 10, "auditor3", "reviewer", 0.85),
    ("Finance", "Finance Controls Audit", "COMPLETED", 9, "auditor1", "reviewer", 0.9),
    ("Procurement", "Procurement Audit", "COMPLETED", 8, "auditor2", "reviewer2", 0.7),
    ("Human Resources", "HR Compliance Audit", "COMPLETED", 7, "auditor1", "reviewer2", 0.88),
    ("Sales", "Sales Compliance Audit", "COMPLETED", 6, "auditor2", "reviewer", 0.75),
    ("Business Operations", "Business Operations Process Audit", "COMPLETED", 5, "auditor1", "reviewer", 0.82),
    ("Administration", "Administration and Facilities Audit", "COMPLETED", 4, "auditor2", "reviewer2", 0.93),
    ("IT", "IT General Controls Audit", "COMPLETED", 3, "auditor3", "reviewer2", 0.78),
    ("Finance", "Finance Controls Audit", "APPROVED", 2, "auditor1", "reviewer", 0.8),
    ("Procurement", "Procurement Audit", "SUBMITTED", 1, "auditor2", "reviewer", 0.72),
    ("Human Resources", "HR Compliance Audit", "REWORK_REQUIRED", 1, "auditor1", "reviewer2", 0.85),
    ("Sales", "Sales Compliance Audit", "IN_PROGRESS", 2, "auditor2", "reviewer", 0.7),  # overdue
    ("Business Operations", "Business Operations Process Audit", "IN_PROGRESS", 0, "auditor1", "reviewer2", 0.8),
    ("IT", "IT General Controls Audit", "SCHEDULED", -1, "auditor3", "reviewer", 0),
    ("Administration", "Administration and Facilities Audit", "SCHEDULED", 0, "auditor2", "reviewer2", 0),
    ("Finance", "Finance Controls Audit", "DRAFT", -2, "auditor1", "reviewer", 0),
    ("Sales", "Sales Compliance Audit", "CANCELLED", 3, "auditor2", "reviewer", 0),
]

AUDIT_DURATION_DAYS = 21


class Command(BaseCommand):
    help = "Create development demo data (refuses to run unless DJANGO_DEBUG=true or --force)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Allow running with DEBUG off (never in production)")
        parser.add_argument("--password", default=os.environ.get("SEED_DEMO_PASSWORD", "AuditSphere#2026"))

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("seed_demo is for development only. Set DJANGO_DEBUG=true or pass --force.")
        if Organization.objects.filter(slug="acme").exists():
            raise CommandError("Demo data already exists. Reset with `python manage.py flush` first.")
        self.rng = random.Random(42)
        self.today = timezone.localdate()
        self.password = options["password"]
        with transaction.atomic():
            self.seed()
        totals = run_reminders()
        self.stdout.write(self.style.SUCCESS(
            f"Demo data created. Reminders: {totals}.\n"
            f"Sign in with any of these accounts (password: {self.password}):\n"
            + "\n".join(f"  {p}@acme.test  ({r.label})" for p, _, _, r, _ in USERS)
            + f"\n  admin@globex.test  (separate organisation, for isolation testing)"
        ))

    # ------------------------------------------------------------------ setup
    def seed(self):
        org = Organization.objects.create(name="Acme Corporation", slug="acme")
        org.settings.email_notifications_enabled = False  # keep the console quiet while seeding
        org.settings.save()
        self.org = org
        self.users = {}
        for prefix, first, last, role, title in USERS:
            self.users[prefix] = User.objects.create_user(
                email=f"{prefix}@acme.test", password=self.password, organization=org, role=role,
                first_name=first, last_name=last, job_title=title,
            )
        self.depts = {}
        for name, code, description in SAMPLE_DEPARTMENTS:
            manager = self.users.get(DEPT_MANAGERS.get(name, ""))
            dept = Department.objects.create(organization=org, name=name, code=code, description=description,
                                             manager=manager)
            if manager:
                DepartmentMembership.objects.create(department=dept, user=manager,
                                                    member_role=DepartmentMembership.MemberRole.MANAGER)
            for member in DEPT_MEMBERS.get(name, []):
                DepartmentMembership.objects.create(department=dept, user=self.users[member])
            self.depts[name] = dept

        load_sample_templates(org, self.users["admin"], approve=True)
        self.templates = {t.name: t for t in AuditTemplate.objects.filter(organization=org)}

        for plan in AUDIT_PLAN:
            self.create_audit(*plan)

        org.settings.email_notifications_enabled = True
        org.settings.save()

        other = Organization.objects.create(name="Globex Industries", slug="globex")
        User.objects.create_user(email="admin@globex.test", password=self.password, organization=other,
                                 role=Role.SUPER_ADMIN, first_name="Gary", last_name="Globex")
        Department.objects.create(organization=other, name="Finance", code="FIN")

    # ------------------------------------------------------------------ audits
    def create_audit(self, dept_name, template_name, target, months_ago, lead_key, reviewer_key, rate):
        admin = self.users["audit.admin"]
        lead, reviewer = self.users[lead_key], self.users[reviewer_key]
        dept = self.depts[dept_name]
        template = self.templates[template_name]
        planned = self.today - timedelta(days=int(months_ago * 30.4))
        due = planned + timedelta(days=AUDIT_DURATION_DAYS)
        audit = audits.create_audit(admin, {
            "title": f"{template_name} — {planned:%B %Y}",
            "department": dept,
            "template_version": template.current_approved_version,
            "audit_type": "IT" if dept_name == "IT" else ("FINANCIAL" if dept_name == "Finance" else "INTERNAL"),
            "period_start": planned - timedelta(days=90),
            "period_end": planned - timedelta(days=1),
            "planned_start_date": planned,
            "due_date": due,
            "lead_auditor": lead,
            "reviewer": reviewer,
            "department_contact": dept.manager,
            "scope": f"Review of {dept_name.lower()} controls and records for the preceding quarter.",
            "objectives": "Assess design and operating effectiveness of key controls; identify risks and "
                          "improvement opportunities.",
            "priority": self.rng.choice(["MEDIUM", "MEDIUM", "HIGH", "LOW"]),
            "team_member_ids": [],
        })
        if target == "DRAFT":
            return audit
        audits.schedule(admin, audit)
        if target == "SCHEDULED":
            return audit
        if target == "CANCELLED":
            audits.cancel(admin, audit, "Merged into the next quarter's audit cycle.")
            return audit

        audits.start(lead, audit)
        fill_all = target != "IN_PROGRESS"
        self.answer_checklist(audit, lead, rate, fill_all)
        audit.refresh_from_db()

        if target == "IN_PROGRESS":
            self.backdate(audit, planned, due)
            return audit
        audits.submit(lead, audit)
        if target == "REWORK_REQUIRED":
            audits.request_rework(reviewer, audit, "Please attach the sampled transaction list for the "
                                                   "employee file test and expand the root cause of HR-OFF-01.")
        elif target in ("APPROVED", "COMPLETED"):
            audits.approve(reviewer, audit, "Work papers are complete and conclusions are supported.")
            if target == "COMPLETED":
                audits.complete(reviewer, audit)
        self.backdate(audit, planned, due, finished=target in ("APPROVED", "COMPLETED"))
        self.create_actions(audit, months_ago)
        return audit

    def answer_checklist(self, audit, lead, rate, fill_all):
        questions = list(AuditQuestion.objects.filter(section__version=audit.template_version).order_by(
            "section__order", "order"))
        if not fill_all:
            questions = questions[: max(1, int(len(questions) * 0.6))]
        items, failed = [], []
        for q in questions:
            compliant = self.rng.random() < rate
            item = {"question_id": q.id, **self.answer(q, compliant)}
            if not compliant and q.is_scored:
                item["observation"] = "Exceptions noted in the sampled items; see evidence."
                item["recommendation"] = "Strengthen the control and evidence its operation each period."
                item["risk_flagged"] = q.failure_severity in ("CRITICAL", "HIGH")
                failed.append(q)
            items.append(item)
        audits.save_responses(lead, audit, items, overall={
            "overall_summary": "Fieldwork completed through walkthroughs, sampling and document inspection.",
            "overall_recommendation": "Address failed controls through the corrective actions raised.",
        })
        audit.refresh_from_db()
        responses = {r.question_id: r for r in audit.responses.all()}
        for q in questions:
            r = responses.get(q.id)
            if q.evidence_required and r and r.compliance != "NOT_APPLICABLE":
                audits.add_evidence(lead, audit, ContentFile(
                    f"Evidence for {q.code}: sample listing and screenshots reviewed on "
                    f"{self.today:%Y-%m-%d}.\n".encode(), name=f"{q.code or q.id}-evidence.txt"),
                    response_id=r.id, description=f"Supporting evidence for {q.code}")
        for q in failed:
            if q.requires_corrective_action or self.rng.random() < 0.5:
                findings.create_finding(lead, {
                    "audit": audit, "question": q,
                    "title": f"Control exception: {q.text[:120]}",
                    "description": f"Testing of control {q.code} identified exceptions in the sampled population.",
                    "observed_condition": "Several sampled items did not meet the documented requirement.",
                    "root_cause": self.rng.choice([
                        "Process not documented for the new system.", "Insufficient staff awareness of policy.",
                        "Manual control with no secondary review.", "Ownership unclear after reorganisation.",
                    ]),
                    "business_impact": "Increased likelihood of errors or unauthorised activity going undetected.",
                    "recommended_action": "Define the control owner, document the procedure and evidence each run.",
                    "owner": audit.department.manager,
                    "target_date": audit.due_date + timedelta(days=45),
                })

    def answer(self, q, compliant):
        if q.response_type in (RT.YES_NO, RT.YES_NO_NA):
            if q.response_type == RT.YES_NO_NA and self.rng.random() < 0.05:
                return {"choice_value": "NA", "observation": "Not applicable to this department."}
            return {"choice_value": "YES" if compliant else "NO"}
        if q.response_type == RT.PASS_FAIL:
            return {"choice_value": "PASS" if compliant else "FAIL"}
        if q.response_type == RT.RATING:
            low, high = q.rating_pass_threshold, q.rating_max
            return {"rating_value": self.rng.randint(low, high) if compliant else self.rng.randint(1, max(1, low - 1))}
        if q.response_type == RT.NUMBER:
            if q.numeric_min is not None and q.numeric_max is not None:
                mid = (q.numeric_min + q.numeric_max) / 2
                return {"number_value": mid if compliant else q.numeric_min - 3}
            return {"number_value": 12}
        if q.response_type == RT.DATE:
            return {"date_value": self.today - timedelta(days=self.rng.randint(20, 200))}
        return {"text_value": "Reviewed with the process owner; observations recorded in work papers."}

    def backdate(self, audit, planned, due, finished=False):
        audit = Audit.objects.get(pk=audit.pk)
        started = timezone.make_aware(datetime.combine(planned, time(9, 0)))
        fields = {"started_at": started}
        if audit.submitted_at:
            fields["submitted_at"] = started + timedelta(days=AUDIT_DURATION_DAYS - 4)
        if finished:
            # Most audits finish on time; a few slip past their due date.
            slip = self.rng.choice([-3, -2, -1, 0, 2, 6])
            fields["approved_at"] = started + timedelta(days=AUDIT_DURATION_DAYS + slip)
            if audit.status == Audit.Status.COMPLETED:
                fields["completed_at"] = fields["approved_at"] + timedelta(days=2)
        Audit.objects.filter(pk=audit.pk).update(**fields)
        AuditFinding.objects.filter(audit=audit).update(created_at=started + timedelta(days=10))

    # ------------------------------------------------------------------ actions
    def create_actions(self, audit, months_ago):
        owners = [self.users["owner1"], self.users["owner2"], self.users["owner3"]]
        manager = audit.department.manager or self.users["audit.admin"]
        for i, finding in enumerate(audit.findings.all()):
            owner = owners[(audit.id + i) % len(owners)]
            due = self.today + timedelta(days=self.rng.randint(-40, 60)) if months_ago <= 4 else \
                self.today - timedelta(days=self.rng.randint(30, 150))
            action = actions.create_action(manager, {
                "finding": finding, "owner": owner, "due_date": due,
                "action_type": "CORRECTIVE",
                "title": f"Remediate {finding.question.code if finding.question else finding.reference}",
                "description": finding.recommended_action or "Implement and evidence the control.",
                "priority": "HIGH" if finding.severity in ("CRITICAL", "HIGH") else "MEDIUM",
            })
            if self.rng.random() < 0.4:
                actions.create_action(manager, {
                    "finding": finding, "owner": owner, "due_date": due + timedelta(days=30),
                    "action_type": "PREVENTIVE", "title": "Train staff and add a periodic review",
                    "description": "Deliver refresher training and add a quarterly management review.",
                    "priority": "MEDIUM",
                })
            roll = self.rng.random()
            old = months_ago > 4
            if roll < 0.25 and not old:
                continue  # stays OPEN
            actions.start(owner, action)
            action.refresh_from_db()
            actions.update_action(owner, action, {"progress": self.rng.choice([20, 40, 60, 80])})
            if roll < 0.5 and not old:
                continue  # IN_PROGRESS
            actions.add_evidence(owner, action, ContentFile(b"Updated procedure and sign-off sheet.\n",
                                                            name="resolution-evidence.txt"))
            actions.submit_for_verification(owner, action, "Procedure updated, staff briefed and control "
                                                           "evidenced for the last cycle.")
            if roll < 0.65 and not old:
                continue  # PENDING_VERIFICATION
            verifier = audit.reviewer
            action.refresh_from_db()
            if self.rng.random() < 0.15:
                actions.verify(verifier, action, False, "Evidence covers only one month; provide three.")
            else:
                actions.verify(verifier, action, True, "Evidence reviewed; control operating effectively.")
