# Module Audit

Status key:

- `Implemented`: functional coverage exists in the app and persists in the backend.
- `Partial`: some working coverage exists, but important operational or compliance controls are still missing.
- `Pending`: mostly scaffolding or record structures, without a live production-grade workflow.
- `Production ready`: `No` means the module is still demo-grade and not hardened for real-world deployment.

| # | Module | Status | Production ready | Notes |
| --- | --- | --- | --- | --- |
| 1 | Order Management & Intake | Implemented | No | Manual and portal intake work on the current Postgres-backed app; OCR/NLP remains simulated. |
| 2 | Billing, Payments & Financial Control | Partial | No | Pricing, invoices, refunds, and clearance exist, but Maviance is only API-ready until live settlement and reconciliation are proven. |
| 3 | Specimen Accessioning & Traceability | Partial | No | Accessioning and specimen status history work, but universal chain-of-custody enforcement is still incomplete. |
| 4 | Barcode & Label Governance | Partial | No | Barcode assignment and histology/IHC scan enforcement are live, but printer integration and universal scan gating are still missing. |
| 5 | Pre-Analytical Workflow Management | Partial | No | Courier and receipt workflows work, and TAT is clocked, but logistics integrations and exception handling are still incomplete. |
| 6 | Histopathology Workflow | Implemented | No | Grossing-through-staining is working with barcode checks, but recuts/special stains still need more production controls. |
| 7 | Cytopathology Workflow | Partial | No | Cytology routing, prep type, and QC exist, but adequacy review and escalation are not yet production-complete. |
| 8 | Immunohistochemistry / Special Stains | Partial | No | IHC entry and antibody inventory work, but reagent consumption and batch-governance are still incomplete. |
| 9 | Digital Pathology Management | Partial | No | Digital slide metadata and viewer links exist, but no certified viewer or validated Roche round-trip is live yet. |
| 10 | AI & Decision Support | Pending | No | AI result records exist, but no live inference pipeline or regulated validation workflow is implemented. |
| 11 | Instrument & Analyzer Integration | Partial | No | HL7/ASTM, Leica, and Roche APIs are prepared, but live vendor conformance is still pending. |
| 12 | Reporting & Results Management | Partial | No | Bilingual reports, addenda, and release tracking work, but cryptographic signatures and stricter release controls are still needed. |
| 13 | Communication & Notification | Partial | No | Portals and communication logs exist, but secure provider integrations and escalation workflows are incomplete. |
| 14 | Quality Control & Assurance | Partial | No | QC, QA, CAPA, and proficiency records are tracked, but evidence and approval workflows need more depth. |
| 15 | Turnaround Time & KPI Monitoring | Partial | No | TAT dashboards and alerts are live, but full SLA escalation and richer KPI visualization are still missing. |
| 16 | Archive, Inventory & Storage Management | Partial | No | Archive, reagent, and waste records exist, but physical storage hierarchy and consumption tracking are not yet complete. |
| 17 | Document Management System | Partial | No | Upload/download, versioning, and S3-ready storage are live, but approvals and training attestation remain incomplete. |
| 18 | Audit Trail & Compliance | Partial | No | Hash-chained append-only audit verification is live, but before/after diffs and legal export still need implementation. |
| 19 | User, Role & Access Management | Partial | No | RBAC, site-scoped admins, sessions, and revocation work; MFA/SSO and stronger password governance are still pending. |
| 20 | Integration & API Gateway | Partial | No | Vendor APIs and readiness checks exist, but centralized gateway policy and partner-certified integrations are unfinished. |
| 21 | Configuration & Master Data | Implemented | No | Catalogs, workflow templates, pricing, QC thresholds, and reference ranges are active, but approval/version control is still limited. |
| 22 | Analytics, BI & Research | Partial | No | Operational analytics and TAT summaries exist, but BI dashboards and governed research pipelines remain incomplete. |
| 23 | Disaster Recovery & Business Continuity | Partial | No | The system now runs on managed Postgres, but tested backups, restores, and failover execution are still pending. |
| 25 | Multi-Site & Multi-Lab Management | Partial | No | Site scoping and transfers work, but richer cross-site analytics and workflow overrides still need expansion. |

## Honest production gap

This system is now much more complete functionally and is backed by PostgreSQL, but it is still not production-ready in the strict sense because it lacks:

- full automated test coverage
- hardened authorization per module/action
- real external gateway/instrument integrations
- stronger audit immutability guarantees
- backup/restore orchestration beyond record tracking
- deployment, monitoring, and security controls expected in a regulated live environment
