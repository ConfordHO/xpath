# Module Audit

Status key:

- `Implemented`: functional coverage exists in the app and persists in the backend.
- `Partial`: some working coverage exists, but important operational or compliance controls are still missing.
- `Pending`: mostly scaffolding or record structures, without a live production-grade workflow.
- `Production ready`: `No` means the module is still demo-grade and not hardened for real-world deployment.

| # | Module | Status | Production ready | Target release date | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Order Management & Intake | Implemented | No | Managed in-app | Manual and portal intake work; internal OCR intake jobs now capture confidence scores, raw text, parsed payloads, and mandatory human verification before conversion to orders. Configurable validation-rule CRUD, per-order rule evaluation, controlled order locks, correction approvals, legal amendments, referral-doctor account onboarding, and automatic immutable before/after mutation diffs are implemented. |
| 2 | Billing, Payments & Financial Control | Implemented | No | Managed in-app | Pricing, invoices, refunds, clearance, Maviance readiness, monthly ECharts analytics, Zoho Books OAuth readiness, contact/invoice/payment sync endpoints, and two-person refund/adjustment approvals are implemented. Live Zoho and Maviance credentials still require provider sign-off testing. |
| 3 | Specimen Accessioning & Traceability | Partial | No | Managed in-app | Accessioning, specimen history, handoff events, GPS/temperature telemetry, discrepancy-to-CAPA creation, and chain-of-custody audit logging are implemented. Full device-sourced telemetry validation remains external. |
| 4 | Barcode & Label Governance | Partial | No | Managed in-app | Barcode assignment, scan event persistence, scan rejection, browser-print label payloads, and histology/IHC scan enforcement are live. Certified thermal-printer drivers remain external. |
| 5 | Pre-Analytical Workflow Management | Partial | No | Managed in-app | Courier activation from online orders, reception intake, payment prompting, browser GPS telemetry endpoint, temperature capture, TAT clocks, and operational alerts are available. Live courier-provider integration remains external. |
| 6 | Histopathology Workflow | Implemented | No | Managed in-app | Grossing-through-staining is working with barcode checks, but recuts/special stains still need more production controls. |
| 7 | Cytopathology Workflow | Partial | No | Managed in-app | Cytology routing, prep type, and QC exist, but adequacy review and escalation are not yet production-complete. |
| 8 | Immunohistochemistry / Special Stains | Partial | No | Managed in-app | IHC entry and antibody inventory work, but reagent consumption and batch-governance are still incomplete. |
| 9 | Digital Pathology Management | Partial | No | Managed in-app | Digital slide metadata and viewer links exist, but no certified viewer or validated Roche round-trip is live yet. |
| 10 | AI & Decision Support | Partial | No | Managed in-app | Local free-mode AI inference and external-provider API hooks now create versioned AI results with explainability payloads. Validated clinical AI models, bias monitoring, and regulatory sign-out policies remain external/governance work. |
| 11 | Instrument & Analyzer Integration | Partial | No | Managed in-app | HL7/ASTM, Leica, and Roche APIs are prepared, but live vendor conformance is still pending. |
| 12 | Reporting & Results Management | Partial | No | Managed in-app | Bilingual reports, addenda, and release tracking work, but cryptographic signatures and stricter release controls are still needed. |
| 13 | Communication & Notification | Partial | No | Managed in-app | Portals, communication logs, provider-ready SMS/WhatsApp dispatch endpoints, and realtime internal department chat are implemented. Live provider credentials and mandatory escalation policy testing remain external. |
| 14 | Quality Control & Assurance | Partial | No | Managed in-app | QC, QA, CAPA, and proficiency records are tracked, but evidence and approval workflows need more depth. |
| 15 | Turnaround Time & KPI Monitoring | Partial | No | Managed in-app | TAT dashboards, alerts, production readiness counts, and ECharts visualizations are live. Predictive alerting and fully automated escalation trees remain pending. |
| 16 | Archive, Inventory & Storage Management | Partial | No | Managed in-app | Archive, reagent, and waste records exist, but physical storage hierarchy and consumption tracking are not yet complete. |
| 17 | Document Management System | Partial | No | Managed in-app | Upload/download, versioning, S3-ready storage, document approval status, and training attestation are implemented. Version diffing and external object-store validation remain pending. |
| 18 | Audit Trail & Compliance | Partial | No | Managed in-app | Hash-chained audit verification, evidence export, request-level audit events, and store-level automatic before/after mutation diffs are live. Formal ISO/CAP evidence packaging and retention policy sign-off remain pending. |
| 19 | User, Role & Access Management | Partial | No | Managed in-app | RBAC, site-scoped admins, sessions, revocation, lockout counters, TOTP MFA enrollment/verification, and downstream patient anonymization are implemented. SSO/device trust/anomaly detection remain pending. |
| 20 | Integration & API Gateway | Partial | No | Managed in-app | Vendor APIs, provider readiness checks, Zoho Books integration hooks, notification provider hooks, local/external AI hooks, and offline sync APIs exist. Partner conformance testing and secret rotation remain external. |
| 21 | Configuration & Master Data | Implemented | No | Managed in-app | Catalogs, workflow templates, pricing, QC thresholds, and reference ranges are active, but approval/version control is still limited. |
| 22 | Analytics, BI & Research | Partial | No | Managed in-app | Operational analytics and TAT summaries exist, but BI dashboards and governed research pipelines remain incomplete. |
| 23 | Disaster Recovery & Business Continuity | Partial | No | Managed in-app | Managed Postgres, DR dashboard, offline snapshot, offline sync intake, RPO/RTO targets, and on-site/cloud sync guidance are implemented. Automated restore drills and true conflict resolution remain pending. |
| 25 | Multi-Site & Multi-Lab Management | Partial | No | Managed in-app | Site scoping and transfers work, but richer cross-site analytics and workflow overrides still need expansion. |

## Honest production gap

This system is now much more complete functionally and is backed by PostgreSQL, but it is still not production-ready in the strict sense because it lacks:

- full automated test coverage
- hardened authorization per module/action
- real external gateway/instrument integrations
- formal compliance evidence packaging and retention sign-off
- backup/restore orchestration beyond record tracking
- deployment, monitoring, and security controls expected in a regulated live environment
