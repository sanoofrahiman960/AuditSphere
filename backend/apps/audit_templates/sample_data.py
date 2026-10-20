"""
Example checklists per department. They are starting points for administrators
to customise — not authoritative legal, regulatory or certification requirements.
"""


def q(code, text, guidance="", rt="YES_NO_NA", sev="MEDIUM", cat="COMPLIANCE", evidence=False, ca=False,
      mandatory=True, weight="1.00", **extra):
    return {"code": code, "text": text, "guidance": guidance, "response_type": rt, "failure_severity": sev,
            "risk_category": cat, "evidence_required": evidence, "requires_corrective_action": ca,
            "is_mandatory": mandatory, "weight": weight, **extra}


SAMPLE_TEMPLATES = [
    {
        "department": "IT",
        "name": "IT General Controls Audit",
        "category": "Information Technology",
        "description": "Access management, backups, patching, incident response, assets, licensing, change "
                       "management and disaster recovery.",
        "applicable_standard": "Internal IT Security Policy (example; align with ISO/IEC 27001 controls as needed)",
        "scoring_method": "WEIGHTED",
        "sections": [
            {"title": "User access and permissions", "questions": [
                q("IT-AC-01", "Are user access rights reviewed at least quarterly by system owners?",
                  "Obtain the latest access review sign-offs for critical systems.", sev="HIGH", cat="SECURITY",
                  evidence=True, ca=True, weight="2.00"),
                q("IT-AC-02", "Is privileged (admin) access limited to approved personnel with MFA enforced?",
                  "Compare the admin group membership to the approved list; confirm MFA policy.", sev="CRITICAL",
                  cat="SECURITY", evidence=True, ca=True, weight="3.00"),
                q("IT-AC-03", "Are leavers' accounts disabled within 1 business day of the exit date?",
                  "Sample 10 leavers from HR and compare against directory disable dates.", rt="PASS_FAIL",
                  sev="HIGH", cat="SECURITY", evidence=True, ca=True, weight="2.00"),
                q("IT-AC-04", "Number of active accounts with no login in the last 90 days",
                  "Report from the identity provider; target is 0.", rt="NUMBER", sev="MEDIUM", cat="SECURITY",
                  numeric_min="0", numeric_max="0"),
            ]},
            {"title": "Backup, restore and disaster recovery", "questions": [
                q("IT-BK-01", "Are backups of critical systems completed successfully every day?",
                  "Review the backup console for the last 30 days.", sev="HIGH", cat="OPERATIONAL", evidence=True,
                  weight="2.00"),
                q("IT-BK-02", "Was a restore test performed and documented in the last 6 months?", sev="HIGH",
                  cat="OPERATIONAL", evidence=True, ca=True, weight="2.00"),
                q("IT-DR-01", "Date of the last disaster recovery exercise", rt="DATE", cat="OPERATIONAL"),
                q("IT-DR-02", "Rate the completeness of the disaster recovery plan (1 = absent, 5 = fully tested)",
                  rt="RATING", cat="OPERATIONAL", sev="HIGH", rating_max=5, rating_pass_threshold=3),
            ]},
            {"title": "Patching, incidents and change management", "questions": [
                q("IT-PM-01", "Are critical security patches applied within the 14-day policy window?",
                  "Check the patch compliance report for servers and endpoints.", sev="HIGH", cat="SECURITY",
                  evidence=True, ca=True, weight="2.00"),
                q("IT-IR-01", "Is there an approved incident response procedure with a named owner?",
                  sev="MEDIUM", cat="SECURITY"),
                q("IT-IR-02", "Were all security incidents in the period logged, classified and closed?",
                  sev="MEDIUM", cat="SECURITY"),
                q("IT-CM-01", "Do production changes have documented approval and a rollback plan?",
                  "Sample 10 changes from the change log.", rt="PASS_FAIL", sev="MEDIUM", cat="OPERATIONAL",
                  evidence=True),
            ]},
            {"title": "Assets, licensing and policy", "questions": [
                q("IT-AS-01", "Is the IT asset inventory complete and reconciled in the last quarter?",
                  sev="MEDIUM", cat="OPERATIONAL"),
                q("IT-SL-01", "Are installed software titles covered by valid licences?", sev="MEDIUM",
                  cat="LEGAL"),
                q("IT-SP-01", "Have all staff acknowledged the information security policy this year?",
                  sev="LOW", cat="COMPLIANCE"),
                q("IT-SP-02", "Auditor notes on security policy adherence", rt="TEXT", mandatory=False),
            ]},
        ],
    },
    {
        "department": "Business Operations",
        "name": "Business Operations Process Audit",
        "category": "Operations",
        "description": "SOP compliance, documentation, approvals, efficiency, exceptions, records and SLAs.",
        "applicable_standard": "Operations SOP Manual (example)",
        "sections": [
            {"title": "Procedures and documentation", "questions": [
                q("OPS-SOP-01", "Are current SOPs available, version-controlled and approved?", sev="MEDIUM",
                  cat="OPERATIONAL", evidence=True),
                q("OPS-SOP-02", "Do sampled transactions follow the documented SOP steps?",
                  "Sample 15 transactions and walk through each step.", rt="PASS_FAIL", sev="HIGH",
                  cat="OPERATIONAL", ca=True),
                q("OPS-DOC-01", "Are process maps updated after each significant process change?", sev="LOW",
                  cat="OPERATIONAL"),
            ]},
            {"title": "Approvals, exceptions and records", "questions": [
                q("OPS-APR-01", "Are approvals obtained from the correct authority level per the delegation matrix?",
                  sev="HIGH", cat="COMPLIANCE", evidence=True, ca=True),
                q("OPS-EXC-01", "Are process exceptions logged, justified and approved?", sev="MEDIUM",
                  cat="OPERATIONAL"),
                q("OPS-REC-01", "Are records retained according to the retention schedule?", sev="MEDIUM",
                  cat="LEGAL"),
            ]},
            {"title": "Performance and service levels", "questions": [
                q("OPS-SLA-01", "Percentage of SLA targets met in the period", rt="NUMBER", sev="MEDIUM",
                  cat="OPERATIONAL", numeric_min="95", numeric_max="100"),
                q("OPS-EFF-01", "Rate operational efficiency (1 = poor, 5 = excellent)", rt="RATING",
                  rating_max=5, rating_pass_threshold=3, sev="LOW", cat="OPERATIONAL"),
                q("OPS-EFF-02", "Improvement opportunities observed", rt="TEXT", mandatory=False),
            ]},
        ],
    },
    {
        "department": "Sales",
        "name": "Sales Compliance Audit",
        "category": "Commercial",
        "description": "CRM accuracy, lead follow-up, approvals, discounting, target reporting, orders and customer data.",
        "applicable_standard": "Sales Policy and Discount Authority Matrix (example)",
        "sections": [
            {"title": "CRM and pipeline", "questions": [
                q("SAL-CRM-01", "Are CRM opportunity records complete (stage, value, close date, owner)?",
                  "Sample 20 open opportunities.", rt="PASS_FAIL", sev="MEDIUM", cat="OPERATIONAL"),
                q("SAL-LEAD-01", "Are new leads followed up within the 2-business-day standard?", sev="LOW",
                  cat="OPERATIONAL"),
                q("SAL-RPT-01", "Do reported sales figures reconcile to the finance ledger?", sev="HIGH",
                  cat="FINANCIAL", evidence=True, ca=True),
            ]},
            {"title": "Approvals and discounting", "questions": [
                q("SAL-DSC-01", "Are discounts above the threshold approved per the authority matrix?",
                  sev="HIGH", cat="FINANCIAL", evidence=True, ca=True),
                q("SAL-APR-01", "Are non-standard contract terms approved by Legal before signature?",
                  sev="HIGH", cat="LEGAL", ca=True),
                q("SAL-ORD-01", "Is each sampled order supported by a signed quote or purchase order?",
                  rt="PASS_FAIL", sev="MEDIUM", cat="FINANCIAL", evidence=True),
            ]},
            {"title": "Customer data handling", "questions": [
                q("SAL-DATA-01", "Is customer personal data stored only in approved systems?", sev="HIGH",
                  cat="LEGAL", ca=True),
                q("SAL-DATA-02", "Are customer data exports restricted and logged?", sev="MEDIUM",
                  cat="SECURITY"),
            ]},
        ],
    },
    {
        "department": "Finance",
        "name": "Finance Controls Audit",
        "category": "Financial",
        "description": "Invoices, expenses, budgets, payments, record completeness and reconciliations.",
        "applicable_standard": "Finance Policy Manual (example)",
        "scoring_method": "WEIGHTED",
        "sections": [
            {"title": "Payables and payments", "questions": [
                q("FIN-INV-01", "Are supplier invoices verified against goods receipt before payment?",
                  sev="HIGH", cat="FINANCIAL", evidence=True, ca=True, weight="2.00"),
                q("FIN-PAY-01", "Are payments authorised by two approvers per the payment policy?",
                  rt="PASS_FAIL", sev="CRITICAL", cat="FINANCIAL", evidence=True, ca=True, weight="3.00"),
                q("FIN-PAY-02", "Are changes to supplier bank details independently verified?", sev="CRITICAL",
                  cat="FINANCIAL", ca=True, weight="3.00"),
            ]},
            {"title": "Expenses and budgets", "questions": [
                q("FIN-EXP-01", "Are expense claims approved by the line manager with receipts attached?",
                  rt="PASS_FAIL", sev="MEDIUM", cat="FINANCIAL", evidence=True),
                q("FIN-BUD-01", "Budget variance for the period (%)", "Absolute variance against approved budget.",
                  rt="NUMBER", sev="MEDIUM", cat="FINANCIAL", numeric_min="-5", numeric_max="5"),
            ]},
            {"title": "Records and reconciliations", "questions": [
                q("FIN-REC-01", "Are bank reconciliations completed and reviewed monthly?", sev="HIGH",
                  cat="FINANCIAL", evidence=True, ca=True, weight="2.00"),
                q("FIN-REC-02", "Are general ledger records complete for the period with no unexplained suspense items?",
                  sev="MEDIUM", cat="FINANCIAL"),
            ]},
        ],
    },
    {
        "department": "Procurement",
        "name": "Procurement Audit",
        "category": "Procurement",
        "description": "PO approvals, vendor documentation, supplier evaluation, contracts and 3-way matching.",
        "applicable_standard": "Procurement Policy (example)",
        "sections": [
            {"title": "Purchasing", "questions": [
                q("PRC-PO-01", "Are purchase orders approved before goods or services are received?",
                  rt="PASS_FAIL", sev="HIGH", cat="FINANCIAL", evidence=True, ca=True),
                q("PRC-MATCH-01", "Are invoices matched to the PO and goods receipt (3-way match)?", sev="HIGH",
                  cat="FINANCIAL", ca=True),
                q("PRC-POL-01", "Were competitive quotes obtained above the policy threshold?", sev="MEDIUM",
                  cat="COMPLIANCE"),
            ]},
            {"title": "Vendors and contracts", "questions": [
                q("PRC-VEN-01", "Is vendor onboarding documentation complete (registration, tax, bank)?",
                  sev="MEDIUM", cat="COMPLIANCE", evidence=True),
                q("PRC-EVAL-01", "Are key suppliers evaluated at least annually?", sev="LOW", cat="OPERATIONAL"),
                q("PRC-CON-01", "Are active suppliers covered by a valid, signed contract?", sev="HIGH",
                  cat="LEGAL", ca=True),
            ]},
        ],
    },
    {
        "department": "Human Resources",
        "name": "HR Compliance Audit",
        "category": "People",
        "description": "Employee files, onboarding/offboarding, training, acknowledgements, leave and access.",
        "applicable_standard": "HR Policy Handbook (example)",
        "sections": [
            {"title": "Employee lifecycle", "questions": [
                q("HR-DOC-01", "Are employee files complete (contract, ID, right-to-work)?", "Sample 15 files.",
                  rt="PASS_FAIL", sev="HIGH", cat="LEGAL", evidence=True, ca=True),
                q("HR-ONB-01", "Is the onboarding checklist completed for new joiners?", sev="MEDIUM",
                  cat="PEOPLE"),
                q("HR-OFF-01", "Is the offboarding checklist (asset return, access removal) completed?", sev="HIGH",
                  cat="SECURITY", ca=True),
            ]},
            {"title": "Training and policies", "questions": [
                q("HR-TRN-01", "Mandatory training completion rate (%)", rt="NUMBER", sev="MEDIUM",
                  cat="COMPLIANCE", numeric_min="90", numeric_max="100"),
                q("HR-POL-01", "Have employees acknowledged the code of conduct this year?", sev="MEDIUM",
                  cat="COMPLIANCE"),
            ]},
            {"title": "Leave, attendance and access", "questions": [
                q("HR-LV-01", "Are leave requests approved before leave is taken?", sev="LOW", cat="PEOPLE"),
                q("HR-ACC-01", "Is HR system access restricted to authorised HR staff?", sev="HIGH",
                  cat="SECURITY", ca=True),
            ]},
        ],
    },
    {
        "department": "Administration",
        "name": "Administration and Facilities Audit",
        "category": "Facilities",
        "description": "Asset allocation, maintenance, facility inspections, vendor agreements and admin policy.",
        "applicable_standard": "Administration Policy (example)",
        "sections": [
            {"title": "Assets and maintenance", "questions": [
                q("ADM-AST-01", "Are company assets allocated with signed custody records?", sev="MEDIUM",
                  cat="OPERATIONAL"),
                q("ADM-PM-01", "Is preventive maintenance performed per the maintenance schedule?", sev="MEDIUM",
                  cat="OPERATIONAL", evidence=True),
                q("ADM-EQ-01", "Date of the last equipment maintenance schedule review", rt="DATE",
                  cat="OPERATIONAL"),
            ]},
            {"title": "Facilities and vendors", "questions": [
                q("ADM-FAC-01", "Were monthly facility safety inspections completed and actions tracked?",
                  sev="HIGH", cat="OPERATIONAL", evidence=True, ca=True),
                q("ADM-VEN-01", "Are facility vendor agreements current and signed?", sev="MEDIUM", cat="LEGAL"),
                q("ADM-POL-01", "Rate overall adherence to administrative policy (1-5)", rt="RATING",
                  rating_max=5, rating_pass_threshold=3, sev="LOW"),
            ]},
        ],
    },
]

SAMPLE_DEPARTMENTS = [
    ("IT", "IT", "Infrastructure, applications and information security."),
    ("Business Operations", "OPS", "Core operational processes and service delivery."),
    ("Sales", "SAL", "Sales, account management and commercial operations."),
    ("Finance", "FIN", "Accounting, payables, receivables and treasury."),
    ("Procurement", "PRC", "Purchasing, vendor management and contracts."),
    ("Human Resources", "HR", "People operations, recruitment and training."),
    ("Administration", "ADM", "Facilities, assets and office administration."),
    ("Customer Support", "CS", "Customer service and support operations."),
    ("Legal and Compliance", "LEG", "Legal affairs, regulatory and compliance."),
]
