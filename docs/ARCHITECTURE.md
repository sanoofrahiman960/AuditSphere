# AuditSphere — Architecture

## 1. System overview

```
┌──────────────────────────┐        HTTPS / JSON (JWT)        ┌───────────────────────────────┐
│  React SPA (Vite + TS)   │  ───────────────────────────────▶ │  Django + DRF  (/api/*)        │
│  TanStack Query, Axios   │                                   │  services/ ← business rules     │
│  Tailwind, Recharts      │ ◀───────── PDF / XLSX ─────────── │  scoping.py ← data isolation    │
└──────────────────────────┘                                   └──────┬───────────┬────────────┘
                                                                      │           │
                                       ┌──────────────────────────────┘           │ enqueue
                                       ▼                                          ▼
                          ┌─────────────────────────┐              ┌────────────────────────────┐
                          │ SQLite (local dev)       │              │ Celery worker + beat       │
                          │ PostgreSQL (DATABASE_URL)│ ◀─────────── │ (Redis broker) — or eager   │
                          └─────────────────────────┘              │ mode / `run_reminders` cmd │
                                       ▲                            └────────────┬───────────────┘
                                       │                                         │ SMTP
                          ┌─────────────────────────┐                            ▼
                          │ Private file storage     │                       Email inbox
                          │ local MEDIA / S3 bucket  │
                          └─────────────────────────┘
          optional:  ai_assistant ──▶ embeddings + Qdrant (RAG) ──▶ Claude (drafts only, human review)
```

* **Frontend** is a pure client: it never decides permissions, it only hides controls the API would refuse anyway.
* **Backend** is organised as Django apps per bounded context. Each app has `models.py`, `serializers.py`, `views.py`, `urls.py`, and where there is real business logic a `services.py`. Views stay thin; state transitions, scoring and notifications live in services and run inside `transaction.atomic()`.
* **Database**: `DATABASE_URL` selects the engine. With nothing set, a local SQLite file (`backend/db.sqlite3`) is used so the project runs with zero infrastructure. Set `DATABASE_URL=postgres://…` to use PostgreSQL — no code changes.
* **Background jobs**: Celery tasks (reminders, overdue flagging, email delivery). If `CELERY_BROKER_URL` is empty the tasks run eagerly in-process, and `python manage.py run_reminders` runs the scheduled job (use Windows Task Scheduler / cron).
* **Files** go through Django's storage API: local private `MEDIA_ROOT` (never served directly) or S3 via `django-storages`. Downloads always go through an authorised API endpoint.

## 2. Multi-tenancy and authorisation

Every business row carries `organization_id`. Each request is scoped in three layers:

1. **Organisation isolation** – every queryset starts from `Model.objects.filter(organization=request.user.organization)`.
2. **Role capabilities** – `apps/accounts/roles.py` defines what each role may do (create templates, schedule audits, verify actions…). Checked by DRF permission classes.
3. **Object visibility** – `apps/core/scoping.py` (`visible_audits`, `visible_findings`, `visible_actions`, `visible_departments`) is the *single* source of truth used by viewsets, dashboards, reports, search and file downloads.

| Role | Sees | Can do |
|---|---|---|
| Super Administrator | whole organisation | users, roles, departments, settings, everything an Audit Admin can |
| Audit Administrator | whole organisation | templates, scheduling, assignment, cancel/reopen, close findings, verify actions |
| Auditor | audits they are assigned to (+ their findings/actions) | execute checklists, evidence, findings, submit |
| Reviewer | audits they review (+ their findings/actions) | approve / request rework, verify or reject action closure, reopen actions |
| Department Manager | audits/findings/actions of departments they manage | create & assign corrective actions, submit evidence |
| Corrective Action Owner | actions they own, findings they own | update progress, comment, upload evidence, request verification |
| Executive Viewer | whole organisation, read-only | dashboards and report exports |

Any user additionally sees actions and findings explicitly assigned to them. Self-verification of a corrective action is refused unless `OrganizationSettings.allow_self_verification` is on.

## 3. Domain model (ER summary)

```
Organization 1─1 OrganizationSettings (risk thresholds, reminder days, self-verification policy)
Organization 1─* User (role)              Organization 1─* Department 1─* DepartmentMembership *─1 User
Department.manager ─▶ User

AuditCategory
AuditTemplate (department?, category) 1─* AuditTemplateVersion (status DRAFT|APPROVED|ARCHIVED, locked)
AuditTemplateVersion 1─* AuditSection 1─* AuditQuestion

Audit ─▶ Department, AuditTemplateVersion (PROTECT → preserved questions), lead_auditor, reviewer, department_contact
Audit 1─* AuditAssignment (assignment history / team)
Audit 1─* AuditResponse (unique audit+question) ─▶ AuditQuestion
Audit 1─* AuditEvidence (optional response / finding link)
Audit 1─* ReviewDecision
Audit 1─* AuditFinding 1─* RiskAssessment (history; latest drives severity)
AuditFinding 1─* CorrectiveAction 1─* ActionComment, ActionEvidence, ActionStatusChange

Notification (dedupe_key unique per recipient) ── NotificationPreference (per user × type)
AuditActivityLog (append-only, SHA-256 hash chain per organisation)
ai_assistant: PolicyDocument 1─* PolicyChunk (vector stored in Qdrant)
```

Deletion policy: audit-trail objects use `PROTECT` (templates used by audits, audits with findings, users referenced by records). Departments and users are **deactivated**, not deleted.

## 4. Workflows

### Audit lifecycle
```
DRAFT ─schedule→ SCHEDULED ─start→ IN_PROGRESS ─submit→ SUBMITTED ─approve→ APPROVED ─complete→ COMPLETED
                                       ▲                    │
                                       └──── start ── REWORK_REQUIRED ◀─request-rework─┘
cancel (reason): DRAFT|SCHEDULED|IN_PROGRESS|REWORK_REQUIRED → CANCELLED
reopen (reason): COMPLETED|CANCELLED → IN_PROGRESS
```
*Overdue* is derived (`due_date < today` and not APPROVED/COMPLETED/CANCELLED). Submission is refused while mandatory answers or required evidence are missing, a failed check that requires a finding has none, or a reviewer comment is unresolved. Reviewers comment on individual questions (`ReviewComment`) while the audit is SUBMITTED; the audit team resolves each comment (with a note) during rework. Only the assigned reviewer (or an Audit Admin who is *not* the lead auditor) can approve. Audit completion is independent of corrective-action closure.

### Corrective action lifecycle
```
OPEN → IN_PROGRESS → PENDING_VERIFICATION → CLOSED
                ▲              │ reject
                └── REWORK_REQUIRED ◀┘          CLOSED ─reopen→ REWORK_REQUIRED
```
Every transition writes an `ActionStatusChange` row and an activity-log entry. *Overdue* is derived from `due_date`. When every action of a finding is closed, the finding moves to RESOLVED.

## 5. Scoring rules (shown in the UI)

* A question is **scored** if its type is Yes/No, Pass/Fail, Yes/No/N/A, rating (pass threshold), or numeric with a configured min/max. Text and date questions are informational.
* **Compliance % = Σ weight(compliant) ÷ Σ weight(answered, scored, not N/A) × 100.** With the "simple" method every weight is 1.
* N/A answers are excluded from the denominator. Unanswered questions are **never** counted as compliant; they are reported separately and block submission when mandatory.
* Department / overall score = the same formula over all APPROVED + COMPLETED audits in the selected period.
* **Risk score = likelihood (1–5) × impact (1–5).** Severity thresholds are configurable per organisation (defaults: Critical ≥ 20, High ≥ 12, Medium ≥ 6, else Low). A manual override requires a reason and is recorded in `RiskAssessment`. AI never sets severity.

Scores are internal indicators, not proof of legal or certification compliance.

## 6. Notifications

`apps/notifications/services.notify()` creates an in-app `Notification` (unique on `recipient + dedupe_key`, so a reminder for the same event and period is created once) and, if the user's preference allows, queues an email. The daily `run_reminders` job sends: upcoming audit deadlines, upcoming action deadlines, overdue actions (to owner and department manager). Reminder offsets (e.g. `7,3,1` days) are configured in organisation settings.

## 7. Activity log

`AuditActivityLog` rows are written by `apps/activity_logs/services.log_activity()` from services and views. The model refuses `save()` on existing rows and `delete()`; the Django admin is read-only. Each row stores `prev_hash` and `hash = sha256(prev_hash + canonical JSON)`; `python manage.py verify_activity_log` detects tampering.

## 8. AI module (optional, off by default)

`AI_ENABLED=false` by default. When enabled: policy documents → text extraction → chunking → embeddings → Qdrant. Queries retrieve passages scoped to the organisation and generate answers grounded on the passages with citations (document title, page). Drafts (finding summaries, corrective-action recommendations, management summaries) are returned as suggestions for a human to edit; nothing is saved automatically and no severity/compliance decision is made by the model.
