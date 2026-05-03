# Module Audit

This audit reflects the current TypeScript/Node modular monolith after restoring the backend on `main`. The live Postgres state is read by `backend` through `backend/.env`, and the application keeps one backend runtime for API, OCR intake, payments, documents, integrations, and audit logging.

Status key:

- `Implemented`: working Node/Express API coverage exists, persists in the backend state, and is exercised by tests or frontend flows.
- `Partial`: the workflow is represented and usable, but production use still needs deeper controls, richer UI, physical-device validation, or live vendor credentials.
- `External validation`: the code path exists, but the blocker is live provider/device/conformance testing outside the repository.

| # | Module | State in Node backend | Current readiness | Notes |
| --- | --- | --- | --- | --- |
| 1 | Order Management & Intake | Implemented | Code ready | Walk-in reception orders, patient public order requests, clinician portal orders, OCR intake conversion, and one order with multiple independent test workflows are implemented. |
| 2 | Billing, Payments & Financial Control | Implemented | Code ready, external validation for gateways | Maviance Cameroon, manual payment capture, invoices before payment, receipts after payment, printable invoice/receipt details, and financial clearance are implemented. |
| 3 | Specimen Accessioning & Traceability | Implemented | Code ready | Orders create accession/sample views, department-level custody transfers, and separate per-user handling events. |
| 4 | Barcode & Label Governance | Partial | Code ready for IDs, external validation for scanners/printers | Specimen IDs and compatibility records exist. Certified barcode printer/scanner validation is still external. |
| 5 | Pre-Analytical Workflow Management | Partial | Code ready, external validation for courier/logger devices | Accessioning and payment gates are live. Courier, GPS, and temperature logger integrations remain compatibility/API records until devices are connected. |
| 6 | Histopathology Workflow | Implemented | Code ready | Histology biopsy routes through accessioning, grossing, processing, embedding, sectioning, staining, review, and release. |
| 7 | Cytopathology Workflow | Implemented | Code ready | Cytology routes through accessioning, cytology case, cytology screening, review, and release. |
| 8 | Immunohistochemistry / Special Stains | Implemented | Code ready, external validation for instruments | IHC panel workflow, catalog pricing, order routing, and reporting integration are implemented. |
| 9 | Digital Pathology Management | Partial | External validation | Generic records support existing frontend views, but certified WSI/PACS/viewer integration still needs a real provider. |
| 10 | AI & Decision Support | Partial | External validation | Open integration records exist. Clinical AI requires validated models, versioned model governance, and site sign-off. |
| 11 | Instrument & Analyzer Integration | Partial | External validation | HL7/vendor API compatibility is preserved, but live analyzer/device conformance remains outside the repo. |
| 12 | Reporting & Results Management | Implemented | Code ready | Report draft, lock, sign, release/email, addenda, and order status completion are implemented. |
| 13 | Communication & Notification | Implemented | Code ready | Department communication threads, messages, read state, linked order support, and audit logging are implemented. |
| 14 | Quality Control & Assurance | Partial | Code ready foundation | QC/QA/CAPA records are preserved through compatibility collections; deeper approval/evidence workflows remain to expand. |
| 15 | Turnaround Time & KPI Monitoring | Partial | Code ready foundation | Dashboard and readiness summaries exist; predictive alerts and SOP escalation policy are not yet fully modeled. |
| 16 | Archive, Inventory & Storage Management | Implemented for archives, partial for inventory | Code ready foundation | Completed orders can be archived for at least 10 years. Inventory/storage depth remains compatibility-level. |
| 17 | Document Management System | Partial | Code ready foundation | Multipart document upload metadata is implemented and audited; version diffing and object-store validation remain pending. |
| 18 | Audit Trail & Compliance | Implemented | Code ready | Every core mutation appends hash-chained audit events, with admin log, verification, and evidence export endpoints. |
| 19 | User, Role & Access Management | Implemented | Code ready | Users, login, profile updates, password changes, roles, active flags, and clinician portal user provisioning are implemented. |
| 20 | Integration & API Gateway | Partial | External validation | Payment/provider readiness exists; live vendor credentials, secret rotation, and conformance testing remain external. |
| 21 | Configuration & Master Data | Implemented | Code ready | Test catalog is now writable and persisted, including code, category, price, active flag, turnaround, and workflow route. |
| 22 | Analytics, BI & Research | Partial | Code ready foundation | Operational summaries exist; governed research exports and richer BI remain future work. |
| 23 | Disaster Recovery & Business Continuity | Partial | Code ready foundation | On-prem-primary runtime, Postgres state, cloud sync records, and DR dashboard exist. Automated restore drills remain external. |
| 24 | Patient Engagement & Education | Implemented | Code ready | Public online order form, patient portal lookup, order detail, report view, and patient payment request flow are implemented. |
| 25 | Multi-Site & Multi-Lab Management | Partial | Code ready foundation | Site-scoped users and transfer/custody primitives exist. Rich multi-site dashboards and per-site workflow overrides need expansion. |

## Migration State

- Primary backend: `backend` TypeScript/Node/Express modular monolith.
- Other backend runtimes: removed from the deployable surface; OCR remains in-process through open-source Node/native adapters.
- Payment geography: Cameroon only; Maviance Smobilpay and manual payment capture are supported.
- OCR engine: open-source native Tesseract via a safe spawned binary, with `tesseract.js`, typed-note fallback, and human verification/conversion.
- Data retention: report/order archives are retained for at least 10 years.
- Audit model: hash-chained append-only events with verification endpoint and evidence export.
- Runtime model: on-premise server is the default runtime; cloud sync status/run records support backup synchronization when internet is reliable.

## Remaining Production Risks

- Live Maviance credentials and webhook validation are still required before real payment traffic.
- Physical scanners, label printers, analyzers, tissue processors, stainers, digital slide scanners, and cloud object storage require vendor/device validation.
- Cameroon legal review and facility SOP sign-off are still required before regulated patient production.
- More granular RBAC enforcement per module/action, restore-drill automation, and full regression coverage should be added before go-live.
