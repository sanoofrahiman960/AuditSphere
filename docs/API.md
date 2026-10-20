# AuditSphere API reference

Base path: `/api/`. Interactive OpenAPI documentation is served at **`/api/docs/`** (schema at `/api/schema/`).

## Conventions

* **Auth:** `Authorization: Bearer <access token>`. Access tokens live 15 minutes (`JWT_ACCESS_MINUTES`); refresh
  tokens rotate on every refresh and are blacklisted on logout.
* **Pagination:** list endpoints return `{count, next, previous, results}`; use `?page=` and `?page_size=` (max 500).
* **Search / ordering:** `?search=` and `?ordering=field` / `?ordering=-field` where documented.
* **Multi-value filters** repeat the key: `?status=OPEN&status=IN_PROGRESS`.
* **Errors** always have the same shape:

  ```json
  {"detail": "due_date: Due date cannot be before the planned start date.",
   "code": "validation_error",
   "errors": {"due_date": ["Due date cannot be before the planned start date."]}}
  ```

  | Status | Meaning |
  |---|---|
  | 400 | Validation or business-rule failure (`code: validation_error`, `business_rule`, `incomplete_checklist`) |
  | 401 | Missing/expired token |
  | 403 | Authenticated but not allowed (role/capability or object rule) |
  | 404 | Not found **or not visible to you** (other organisation / department) |
  | 409 | Workflow transition not allowed in the current state (`code: invalid_transition`) |
  | 429 | Rate limited (login, exports, AI) |
  | 503 | Optional AI module disabled or unreachable (`code: ai_unavailable`) |

* Every request gets an `X-Request-ID` response header (an incoming one is honoured) which also appears in logs and the activity log.

## Authentication

| Method & path | Body | Notes |
|---|---|---|
| `POST /auth/login/` | `{email, password}` | → `{access, refresh, user}`; throttled (`THROTTLE_LOGIN`) |
| `POST /auth/refresh/` | `{refresh}` | → `{access, refresh}` (rotated) |
| `POST /auth/logout/` | `{refresh}` | blacklists the refresh token |
| `GET /auth/me/`, `PATCH /auth/me/` | name, job title, phone | role/email are read-only; includes `capabilities` and `managed_department_ids` |
| `POST /auth/change-password/` | `{current_password, new_password}` | |

## Organisation, users

| | |
|---|---|
| `GET /organization/` | current organisation + settings |
| `PATCH /organization/` | `{name?, settings?: {risk_*_threshold, compliance_target, audit_reminder_days, action_reminder_days, overdue_reminder_interval_days, allow_self_verification, email_notifications_enabled}}` — Super Administrator |
| `GET /users/` | organisation members (filters `role` multi, `is_active`, `department`; search) — every member may list for assignment pickers |
| `POST /users/`, `PATCH /users/{id}/` | Super Administrator; users are deactivated (`is_active=false`), never deleted |
| `GET /users/roles/` | role options |

## Departments

| | |
|---|---|
| `GET/POST /departments/` | list (scoped: admins & executives see all, others their own) / create |
| `GET/PATCH/DELETE /departments/{id}/` | DELETE deactivates |
| `POST /departments/{id}/activate/` | |
| `GET/POST /departments/{id}/members/`, `DELETE /departments/{id}/members/{membership_id}/` | |
| `GET /departments/{id}/stats/` | summary, status & risk distribution, 6-month trend |

## Templates

| | |
|---|---|
| `GET/POST /audit-categories/`, `PATCH/DELETE /audit-categories/{id}/` | |
| `GET/POST /audit-templates/` | create accepts initial `applicable_standard`, `scoring_method`, `sections[]` → version 1 (draft) |
| `GET/PATCH /audit-templates/{id}/` | |
| `GET/POST /audit-templates/{id}/versions/` | POST `{source_version?, change_notes?}` clones into a new draft (one draft at a time) |
| `POST /audit-templates/{id}/duplicate/` | `{name}` |
| `GET/PATCH /template-versions/{id}/` | PATCH replaces metadata and the whole `sections[].questions[]` structure — only while the version is an unused draft |
| `POST /template-versions/{id}/approve/` | locks it; previous approved version is archived |
| `POST /template-versions/{id}/archive/` | |

Question fields: `code, text, guidance, response_type (YES_NO|PASS_FAIL|YES_NO_NA|RATING|TEXT|NUMBER|DATE),
is_mandatory, evidence_required, weight, risk_category, failure_severity, requires_corrective_action, rating_max,
rating_pass_threshold, numeric_min, numeric_max, order`.

## Audits

| | |
|---|---|
| `GET /audits/` | filters: `department, status (multi), lead_auditor, reviewer, priority (multi), audit_type, template, due_from, due_to, planned_from, planned_to, overdue, mine`; search; ordering `planned_start_date, due_date, reference, status, priority, compliance_score, created_at, title` |
| `GET /audits/calendar/?start=&end=` | unpaginated events (same filters) |
| `POST /audits/`, `PATCH /audits/{id}/`, `DELETE /audits/{id}/` | Audit Administrators; delete only in DRAFT. Body: `title, department, template_version, audit_type, period_start, period_end, planned_start_date, due_date, lead_auditor, reviewer, department_contact, scope, objectives, priority, team_member_ids[]` |
| `POST /audits/{id}/schedule/` | DRAFT → SCHEDULED (needs lead auditor + reviewer; notifies team) |
| `POST /audits/{id}/start/` | SCHEDULED / REWORK_REQUIRED → IN_PROGRESS (audit team) |
| `GET /audits/{id}/workspace/` | sections, questions with saved responses & evidence, validation issues, scoring explanation |
| `PUT /audits/{id}/responses/` | `{responses: [{question_id, choice_value, text_value, number_value, date_value, rating_value, is_not_applicable, manual_assessment, observation, recommendation, risk_flagged}], overall_summary?, overall_recommendation?}` — upsert; returns the workspace |
| `GET /audits/{id}/validation/` | `{issues: [{question_id, code: mandatory_unanswered|evidence_missing|finding_required|review_comment_open, message}]}` (`question_id` is null for audit-level comments) |
| `POST /audits/{id}/submit/` | IN_PROGRESS → SUBMITTED; 400 `incomplete_checklist` with `errors.issues` |
| `POST /audits/{id}/approve/` | `{comments?}` SUBMITTED → APPROVED (assigned reviewer, or an admin outside the audit team) |
| `POST /audits/{id}/request-rework/` | `{comments}` SUBMITTED → REWORK_REQUIRED; comments may be empty when open question comments exist |
| `POST /audits/{id}/complete/` | APPROVED → COMPLETED |
| `POST /audits/{id}/cancel/`, `POST /audits/{id}/reopen/` | `{reason}` — Audit Administrators |
| `GET/POST /audits/{id}/evidence/` | multipart `file, response_id?, finding_id?, description?` |
| `GET /audit-evidence/{id}/download/`, `DELETE /audit-evidence/{id}/` | authorised streaming download; delete by uploader while editable |
| `GET /audits/{id}/reviews/`, `GET /audits/{id}/history/` | review decisions; activity history |
| `GET/POST /audits/{id}/review-comments/` | reviewer comments on a question (`{body, question_id}`) or the whole audit (`question_id: null`); POST only by the reviewer while SUBMITTED |
| `POST /audits/{id}/review-comments/{comment_id}/resolve/` | `{note?}` — audit team, while IN_PROGRESS/REWORK_REQUIRED; resumes a reworked audit. Open comments block submission (`review_comment_open` issue) |

Audit detail includes a `permissions` object (`can_edit, can_schedule, can_start, can_execute, can_submit,
can_review, can_complete, can_cancel, can_reopen, can_raise_findings, can_upload_evidence, can_delete`) computed for the caller.

## Findings

| | |
|---|---|
| `GET /findings/` | filters `audit, department, status (multi), severity (multi), owner, risk_category, question, open, overdue, created_from, created_to` |
| `POST /findings/` | `audit, question?, title, description, expected_requirement, observed_condition, root_cause, business_impact, risk_category, likelihood, impact, owner, recommended_action, target_date` — severity is calculated |
| `GET/PATCH /findings/{id}/` | detail includes risk assessments, evidence, actions and `permissions` |
| `POST /findings/{id}/assess/` | `{likelihood, impact, override_severity?, rationale?}` — override needs reviewer/admin and a rationale |
| `POST /findings/{id}/close/` | `{notes, accept_risk?}` — all actions must be closed unless accepting the risk (admins) |
| `POST /findings/{id}/reopen/` | `{notes}` |
| `GET/POST /findings/{id}/evidence/`, `GET /findings/{id}/history/` | |
| `GET /findings/risk-matrix/` | thresholds + explanation |

## Corrective actions

| | |
|---|---|
| `GET /corrective-actions/` | filters `finding, audit, department, owner, status (multi), priority (multi), severity (multi), action_type, overdue, open, mine, due_from, due_to` |
| `POST /corrective-actions/` | `finding, action_type, title, description, owner, due_date, priority` — admins or the department's manager |
| `GET/PATCH /corrective-actions/{id}/` | owner may change `progress`, `resolution_notes`; managers also `title, description, owner, due_date, priority, action_type` |
| `POST /corrective-actions/{id}/start/` | |
| `POST /corrective-actions/{id}/submit-verification/` | `{resolution_notes}` |
| `POST /corrective-actions/{id}/verify/` | `{approved, notes}` — reviewer/admin; never the owner unless `allow_self_verification` |
| `POST /corrective-actions/{id}/reopen/` | `{notes}` |
| `GET/POST /corrective-actions/{id}/comments/` | |
| `GET/POST /corrective-actions/{id}/evidence/`, `GET /action-evidence/{id}/download/` | |

## Notifications

| | |
|---|---|
| `GET /notifications/` | own notifications (`is_read`, `notification_type` filters) |
| `GET /notifications/unread-count/`, `POST /notifications/{id}/read/`, `POST /notifications/read-all/` | |
| `GET/PUT /notification-preferences/` | matrix of `{notification_type, in_app, email}` |

## Dashboard and reports

All accept `department, date_from, date_to` (and the report filters below) and are scoped to the caller's visibility.

| | |
|---|---|
| `GET /dashboard/summary/` | KPI counts, compliance score/target, scoring & risk explanations |
| `GET /dashboard/my-work/` | the caller's to-do list: audits to perform, audits to review/complete, actions awaiting their verification, their own open actions, overdue actions in departments they manage |
| `GET /dashboard/status-distribution/`, `/risk-distribution/`, `/department-compliance/`, `/monthly-trend/`, `/upcoming-audits/`, `/recent-activity/`, `/overdue-actions/` | |
| `GET /reports/` | catalog |
| `GET /reports/{key}/` | JSON report: `audits, department-compliance, findings, corrective-actions, overdue, periodic, auditor-workload, completion-trend, department-comparison`; filters `date_from, date_to, department, audit_type, status, severity, auditor, owner, period=month|quarter` |
| `GET /reports/{key}/export/pdf/`, `GET /reports/{key}/export/excel/` | file download; logged in the activity log; throttled |

## Activity log, search, health

| | |
|---|---|
| `GET /activity-logs/` | admins; filters `actor, object_type, object_id, action (prefix), date_from, date_to`; search |
| `GET /activity-logs/verify-integrity/` | verifies the hash chain |
| `GET /search/?q=` | audits, findings, actions, departments, templates the caller can see |
| `GET /health/`, `GET /health/ready/` | liveness; readiness (database and, if configured, broker) — no auth |

## AI assistant (optional)

| | |
|---|---|
| `GET /ai/status/` | `{enabled, llm_configured, retrieval_configured, model, disclaimer}` |
| `GET/POST /ai/policy-documents/`, `PATCH /ai/policy-documents/{id}/`, `POST /ai/policy-documents/{id}/index/` | upload (PDF/TXT/MD), approve, index into Qdrant |
| `POST /ai/policy-search/` | `{question, department?}` → answer with citations and sources |
| `POST /ai/audits/{id}/summary-draft/`, `POST /ai/findings/{id}/recommendation-draft/` | drafts for human review; nothing is saved |
