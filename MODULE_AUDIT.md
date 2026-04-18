# Module Audit

Status key:

- `Implemented`: functional coverage exists in the app and persists in the backend.
- `Partial`: some working coverage exists, but important operational or compliance controls are still missing.
- `Pending`: mostly scaffolding or record structures, without a live production-grade workflow.
- `Production readiness`: `Code ready` means the code-side workflow is now testable; `Code and external integration` means code exists but production use still needs credentials, devices, vendor endpoints, or live conformance validation; `External integration` means the remaining technical blocker is outside the codebase.

| # | Module | Status | Production readiness | Target release date | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Order Management & Intake | Implemented | Code ready | Managed in-app | Manual/portal intake, internal OCR with confidence and human verification, no-code rules, controlled locks/corrections/amendments, referral-doctor onboarding, and immutable diffs are implemented. |
| 2 | Billing, Payments & Financial Control | Implemented | Code and external integration | Managed in-app | Pricing, invoices, refunds, clearance, Maviance readiness, monthly ECharts analytics, Zoho Books readiness, sync logs, and two-person refund/adjustment approvals are implemented. Live Zoho and Maviance credentials still require provider sign-off testing. |
| 3 | Specimen Accessioning & Traceability | Implemented | Code and external integration | Managed in-app | Accessioning, specimen history, mandatory scan/handoff APIs, discrepancy approvals, quarantine/rejection decisions, discrepancy-to-CAPA, GPS/temperature telemetry, and chain-of-custody audit logging are implemented. Physical scanner/device validation remains external. |
| 4 | Barcode & Label Governance | Implemented | Code and external integration | Managed in-app | GS1-style barcode assignment, scan event persistence, rejected scan tracking, browser-print labels, lifecycle archiving, label template governance, and universal workflow scan enforcement are live. Certified scanner/printer validation remains external. |
| 5 | Pre-Analytical Workflow Management | Implemented | Code and external integration | Managed in-app | Courier activation, dispatch/webhooks, reception intake, strict receipt validation, payment prompts, provider/GPS telemetry, temperature logger ingestion, excursion quarantine, TAT clocks, and SLA escalation alerts are implemented. Live courier/logger validation remains external. |
| 6 | Histopathology Workflow | Implemented | Code ready | Managed in-app | Grossing-through-staining, barcode checks, worklist assignment, workload metadata, audit-complete ownership, recuts, special-stain requests, approvals, billing links, and inventory drawdown are implemented. |
| 7 | Cytopathology Workflow | Implemented | Code ready | Managed in-app | Cytology routing, prep type, GYN screening, adequacy review, cytotechnologist review, pathologist escalation, QC gates, trend analytics, and cytology-specific report template metadata are implemented. |
| 8 | Immunohistochemistry / Special Stains | Implemented | Code and external integration | Managed in-app | IHC/special-stain workflows, antibody/reagent inventory, batch/lot release checks, control-slide gates, QC blocks, usage metrics, approvals, billing links, and inventory drawdown are implemented. Live stainer/processor validation remains external. |
| 9 | Digital Pathology Management | Partial | Code and external integration | Managed in-app | Digital slide metadata, WADO/viewer links, ownership claims, sign-out locks, lock release, and audit trails are implemented. Certified viewer, PACS/DICOM storage, and Roche round-trip validation remain external. |
| 10 | AI & Decision Support | Partial | Code and external integration | Managed in-app | Local research/QC mode, external validated-model adapter, model registry, validation gates, clinical-use blocking, and versioned explainability payloads are implemented. A licensed/cleared clinically validated model endpoint and site validation remain external. |
| 11 | Instrument & Analyzer Integration | Partial | Code and external integration | Managed in-app | HL7/ASTM, Leica, and Roche APIs are prepared, but live vendor conformance is still pending. |
| 12 | Reporting & Results Management | Partial | Code and external integration | Managed in-app | Bilingual reports, addenda, and release tracking work, but cryptographic signatures and stricter release controls are still needed. |
| 13 | Communication & Notification | Partial | Code and external integration | Managed in-app | Portals, communication logs, provider-ready SMS/WhatsApp dispatch endpoints, and realtime internal department chat are implemented. Live provider credentials and mandatory escalation policy testing remain external. |
| 14 | Quality Control & Assurance | Partial | Code ready | Managed in-app | QC, QA, CAPA, and proficiency records are tracked, but evidence and approval workflows need more depth. |
| 15 | Turnaround Time & KPI Monitoring | Partial | Code ready | Managed in-app | TAT dashboards, alerts, production readiness counts, and ECharts visualizations are live. Predictive alerting and final escalation SOPs remain pending. |
| 16 | Archive, Inventory & Storage Management | Partial | Code ready | Managed in-app | Archive, reagent, and waste records exist, but physical storage hierarchy and consumption tracking need more operational depth. |
| 17 | Document Management System | Partial | Code and external integration | Managed in-app | Upload/download, versioning, S3-ready storage, document approval status, and training attestation are implemented. Version diffing and external object-store validation remain pending. |
| 18 | Audit Trail & Compliance | Partial | Code ready | Managed in-app | Hash-chained audit verification, evidence export, request-level audit events, and store-level automatic before/after mutation diffs are live. Formal ISO/CAP evidence packaging and retention policy sign-off remain pending. |
| 19 | User, Role & Access Management | Partial | Code ready | Managed in-app | RBAC, site-scoped admins, sessions, revocation, lockout counters, TOTP MFA enrollment/verification, and downstream patient anonymization are implemented. SSO/device trust/anomaly detection remain pending. |
| 20 | Integration & API Gateway | Partial | Code and external integration | Managed in-app | Vendor APIs, provider readiness checks, Zoho Books integration hooks, notification provider hooks, local/external AI hooks, and offline sync APIs exist. Partner conformance testing and secret rotation remain external. |
| 21 | Configuration & Master Data | Implemented | Code ready | Managed in-app | Catalogs, workflow templates, pricing, QC thresholds, and reference ranges are active, but approval/version control is still limited. |
| 22 | Analytics, BI & Research | Partial | Code ready | Managed in-app | Operational analytics and TAT summaries exist, but BI dashboards and governed research pipelines need continued expansion. |
| 23 | Disaster Recovery & Business Continuity | Partial | Code and external integration | Managed in-app | Managed Postgres, DR dashboard, offline snapshot, offline sync intake, RPO/RTO targets, and on-site/cloud sync guidance are implemented. Automated restore drills and true conflict resolution remain pending. |
| 25 | Multi-Site & Multi-Lab Management | Partial | Code ready | Managed in-app | Site scoping and transfers work, but richer cross-site analytics and workflow overrides still need expansion. |

## Honest production gap

This system is now much more complete functionally and is backed by PostgreSQL, but it is still not production-ready in the strict sense because it lacks:

- full automated test coverage
- hardened authorization per module/action
- real external gateway/instrument integrations
- formal compliance evidence packaging and retention sign-off
- backup/restore orchestration beyond record tracking
- deployment, monitoring, and security controls expected in a regulated live environment
