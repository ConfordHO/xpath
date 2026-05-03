# X.PATH Cameroon LIMS End-to-End Implementation Specification

Updated: 2026-05-03

This document revamps the attached LIMS implementation specification for the current X.PATH product direction: Cameroon launch, Maviance/manual payments, on-premise-first deployment, cloud backup/sync, modular monolith architecture, TypeScript backend, open-source OCR, immutable audit logging, and explicit end-to-end workflows for patients, walk-ins, reception, external clinicians, laboratory departments, finance, reporting, archives, and administration.

## 1. Product Position

X.PATH is a Laboratory Information Management System for clinical and pathology laboratory operations in Cameroon. The system must support:

- Online self-ordering by an individual patient.
- Online ordering by an external referring clinician through a dedicated clinician portal.
- Walk-in ordering through reception.
- One order number containing one or many ordered tests.
- Different tests under the same order following different workflow routes without being ignored or collapsed into a single route.
- Cameroon mobile-money collection through Maviance Smobilpay, with card/POS, bank transfer, insurance, and exceptional payments recorded through manual finance capture.
- Printable invoices and receipts before and after payment.
- OCR intake from handwritten or typed requisition notes.
- Department-to-department sample movement, with department custody and user-level interaction logs.
- Ten-year minimum electronic retention for orders, results, specimens, sample metadata, reports, payment records, audit trails, and archives.
- On-premise primary runtime with cloud backup and sync whenever reliable internet is available.
- Compliance with applicable Cameroon cyber, privacy, data protection, health-data, electronic records, and financial-record obligations.

## 2. Architecture Decision

The system will remain a modular monolith for the foreseeable future. It is not planned for near-term microservice extraction.

### Backend

The backend language and framework for the current implementation are:

- Language: TypeScript.
- API framework: Node.js and Express.
- Runtime target: Node.js 20+.
- Validation: Zod schemas and domain service guards.
- Persistence: PostgreSQL as the production database.
- File/object storage: S3-compatible object storage, with MinIO recommended for on-premise deployment.
- OCR: open-source OCR pipeline using native Tesseract through a safe spawned binary, with `tesseract.js` fallback and validated handwriting-specific open-source models available later if needed.
- PDF generation: server-side invoice, receipt, and report rendering; printable browser views are also required for operational fallback.
- Audit: append-only hash-chained audit records for every user, system, integration, payment, specimen, report, and admin action.

### Frontend

- Framework: Next.js and React.
- Primary application roles: patient, external clinician, receptionist, courier, finance, lab technician, department supervisor, pathologist, quality officer, administrator, and IT administrator.
- Portals: public/patient portal, external clinician portal, internal staff application, admin console.

### Modularity

The application remains one deployable backend and one deployable frontend, but the code must be organized by domain modules:

- Identity and access.
- Patient and clinician portals.
- Order intake and validation.
- OCR intake.
- Billing, invoices, receipts, Maviance, and manual finance capture.
- Specimen accessioning and custody.
- Department workflow engine.
- Histology, cytology, IHC, special stains, microbiology/chemistry-style analyzer flows where configured.
- Reporting and result release.
- Communications.
- Audit and compliance logs.
- Archive and retention.
- On-prem/cloud sync and disaster recovery.
- Administration and configuration.

No module should require a separate runtime service unless the need is operationally unavoidable. Optional services such as PostgreSQL, MinIO, Redis-compatible queues, reverse proxy, monitoring, and backup tooling are platform dependencies, not business microservices.

## 3. Cameroon Payments

Kenya-specific mobile-money rails are out of scope.

Supported Cameroon payment providers:

- Maviance Smobilpay for MTN Mobile Money, Orange Money, and other Cameroon-supported collection channels.
- Manual payment capture for cash, POS terminal, bank transfer, insurance, corporate billing, and exceptional approved credit.

### Payment Rules

- Every order creates an invoice or pro-forma invoice immediately after test pricing is known.
- The invoice must be printable at any time before payment.
- The invoice must show patient/order details, ordered test lines, tax/discounts where configured, total amount, amount paid, balance, payment status, and expiry/terms where applicable.
- A receipt is generated for every successful payment event and must be printable at any time after payment.
- A receipt must show provider, payment channel, gateway reference, internal payment ID, cashier or system actor, amount, currency, order number, invoice number, payment status, and verification state.
- Partial payments, overpayments, refunds, reversals, and exemptions must be recorded as ledger events and never overwrite prior financial history.
- Payment webhooks from Maviance must be verified cryptographically before mutating payment state.
- Financial clearance is a computed state based on invoice balance, exemption status, insurance authorization, and configured lab policy.

### Payment Gate

Default rule: a sample cannot be released into analytical workflow until financial clearance is `cleared`, unless an authorized exemption is recorded with a reason, approver, timestamp, and audit entry.

## 4. Order Intake Channels

### Patient Self-Order

The patient can place an order through the public online form or patient portal:

1. Patient enters demographics, contact details, requested tests, clinical notes, preferred sample collection method, and consent.
2. System creates one order number.
3. System creates one or more order items, one per requested test.
4. System creates a draft invoice/pro-forma invoice.
5. System prompts for payment through Maviance or manual instruction.
6. If pickup is requested, courier workflow starts.
7. If patient will walk in, reception workflow waits for arrival.
8. Patient can track order, payment status, sample status, and final released results.

### External Clinician Portal

The external referring clinician portal must be separate from the internal staff application.

Requirements:

- Each referring doctor/clinician receives their own account credentials.
- Clinicians can create orders using the same online ordering capabilities available to patients, plus clinician-specific fields.
- Clinicians can select or create patients they are authorized to refer.
- Clinicians can attach typed notes, scanned notes, request forms, or handwritten notes for OCR extraction.
- Clinicians can view only their own referred patients and orders.
- Clinicians can receive status updates, payment prompts if configured, sample rejection notices, and released reports.
- Clinician portal access must use MFA where policy requires it.
- Every clinician portal action is immutably logged.

### Walk-In Reception Order

Reception can create an order for an individual who walks into the premises:

1. Reception searches or creates the patient record.
2. Reception captures requested tests, referral details if any, clinical notes, consent, and payment method.
3. Reception creates the order and invoice.
4. Reception prints invoice before payment if needed.
5. Reception records payment or marks payment pending/exempted according to policy.
6. Reception receives or arranges sample collection.
7. Reception prints labels and releases the sample to the correct department route only after required gates pass.

## 5. OCR Intake

OCR is a first-class intake path, not a demonstration-only feature.

### Supported Inputs

- Typed scanned requisition image.
- Handwritten note image.
- Uploaded image from mobile camera.
- Text-based PDF.
- Scanned PDF after conversion to image pages in production.

### Open-Source OCR Pipeline

Baseline implementation:

- `tesseract.js` or native Tesseract OCR for text extraction.
- Image preprocessing before OCR: rotation correction, grayscale, thresholding, denoise, crop/border cleanup, and contrast normalization.
- Field extraction with deterministic parsers plus configurable synonym maps for local test names.
- Human verification screen before order creation.

Production enhancement path:

- Use native Tesseract workers for higher throughput.
- Add handwriting-specific model support if selected and validated.
- Keep OCR confidence, raw text, parsed fields, uploaded file hash, reviewer, and reviewer corrections.

### OCR Workflow

1. User uploads a handwritten or typed note.
2. System stores the original file with immutable hash.
3. OCR job extracts raw text.
4. Parser proposes patient details, clinician details, requested tests, clinical notes, priority, and contact information.
5. System shows extracted fields and confidence scores.
6. Receptionist or authorized clinician verifies/corrects extracted fields.
7. System creates one order number and one order item per detected test.
8. Any uncertain or unmatched test remains in an exception queue, not silently discarded.
9. Invoice is generated after the test list is verified.
10. Audit records link the final order to the OCR source and reviewer corrections.

Acceptance test: upload one handwritten note and one typed note; both must extract visible notes and allow creation of an order after human verification.

## 6. Multi-Test Order Handling

One order number can contain multiple tests, and each test can require a different workflow.

### Required Data Model Behavior

- `Order`: shared commercial and clinical container with one order number.
- `OrderItem`: one ordered test under the order.
- `WorkflowPlan`: the required route for each order item.
- `WorkflowStep`: a specific step in the route.
- `Specimen`: physical sample or sample container.
- `SpecimenAssignment`: link between specimen and one or more order items.
- `DepartmentCustodyEvent`: department-level movement event.
- `UserInteractionEvent`: user-level action inside a department.
- `Result`: result per order item or panel component.
- `Report`: final report that may include one or many order item results.

### Routing Rules

- Each order item is routed independently.
- Shared specimens can feed multiple tests, but each test keeps its own workflow status.
- A completed histology item must not mark cytology, IHC, chemistry, or special-stain items complete.
- The order status is derived from its items:
  - `draft`: order not submitted.
  - `pending_validation`: submitted but not validated.
  - `pending_payment`: invoice exists and payment is incomplete.
  - `ready_for_collection`: payment/authorization state allows collection.
  - `in_progress`: at least one item has started analytical workflow.
  - `partially_completed`: at least one item is released and others are still active.
  - `completed`: all non-cancelled order items are released or formally cancelled.
  - `cancelled`: all items cancelled with approval.

### Example

Order `ORD-000123` includes:

- Full blood count: analyzer route.
- Histology biopsy: accessioning, grossing, processing, embedding, sectioning, staining, pathologist review.
- IHC panel: starts only after histology block/slide dependency is available.

The system must show all three item routes, prevent hidden pending work, and block final order completion until every required route reaches release or documented cancellation.

## 7. Department Workflow and Custody

When a sample moves from one place to another, it is assigned to a department, not a specific user.

### Department Custody

Required custody events:

- From reception to accessioning.
- Accessioning to histology/cytology/IHC/analyzer department.
- Department to quality review when required.
- Department to pathologist review.
- Department to archive.
- Department to external referral lab when configured.

Each custody event records:

- Sample/specimen ID.
- Order item IDs affected.
- From department.
- To department.
- Timestamp.
- Condition.
- Temperature if relevant.
- Barcode scan confirmation.
- User who initiated the handoff.
- Department that accepted the handoff.
- Optional receiving user acknowledgement.

### User Interactions Inside a Department

Once the sample is in a department, the system records every user interaction:

- User viewed the work item.
- User scanned the sample.
- User started a step.
- User paused or rejected a step.
- User added notes.
- User uploaded images/documents.
- User completed a step.
- Supervisor approved or overrode an exception.

The sample remains department-owned until transferred, but all user actions are visible in the audit log.

## 8. Explicit End-to-End Workflows

### Workflow A: Patient Online Order With Pickup

1. Patient submits online form.
2. System creates order number and order items.
3. System creates printable invoice.
4. Patient pays through Maviance or requests manual payment.
5. Payment gateway callback verifies payment.
6. Financial clearance updates.
7. Courier pickup is scheduled.
8. Courier collects sample and records condition/location.
9. Reception receives sample and scans it.
10. Accessioning assigns specimen/accession IDs and labels.
11. Each order item receives its workflow route.
12. Sample moves department-to-department.
13. Users in each department complete required steps.
14. Pathologist or authorized reviewer signs results.
15. Report is released to patient portal.
16. Invoice and receipts remain printable.
17. Result, specimen metadata, and audit trail enter ten-year archive.

### Workflow B: External Clinician Order

1. Clinician logs into the external clinician portal.
2. Clinician creates/selects patient.
3. Clinician enters tests or uploads requisition note for OCR.
4. System creates order and order items after verification.
5. System generates invoice according to payer policy.
6. Patient, clinician, insurer, or corporate account pays according to configuration.
7. Sample is delivered, collected, or received at reception.
8. Workflow proceeds per order item.
9. Clinician receives status updates and final released report.
10. Clinician cannot access unrelated patient records.

### Workflow C: Walk-In Reception Order

1. Patient arrives at premises.
2. Reception captures patient, tests, clinical details, and consent.
3. System creates order and printable invoice.
4. Reception records payment or authorized exception.
5. Sample is collected/received.
6. Reception prints labels and hands custody to accessioning/department.
7. Tests route independently by workflow plan.
8. Reports are reviewed, signed, released, and archived.

### Workflow D: OCR Order From Handwritten or Typed Note

1. Staff or clinician uploads note.
2. OCR extracts text.
3. Parser proposes structured order fields.
4. Reviewer corrects and verifies fields.
5. System creates order, order items, invoice, and workflow plans.
6. The original note, raw OCR text, parsed payload, corrections, and final order link are retained.

### Workflow E: Multi-Test Single Order

1. Order has multiple tests.
2. System creates one workflow plan per order item.
3. Shared specimens are linked to all relevant order items.
4. Each workflow route advances independently.
5. Cross-test dependencies are explicit, such as IHC waiting for histology block availability.
6. Dashboard shows pending, blocked, completed, and released items separately.
7. Final order completion requires every item to be released, cancelled, or formally resolved.

Implementation status: covered in the backend hardening regression suite. The API now returns item-level workflow plans, shared specimen assignments, explicit IHC dependency state, dashboard item counts, and report release gates that block final order release until every item is completed, released, cancelled, or formally resolved.

### Workflow F: Printable Billing Before and After Payment

1. Invoice is printable immediately after order pricing.
2. Invoice before payment shows unpaid/pending status.
3. Payment creates a receipt.
4. Receipt is printable immediately.
5. Invoice after payment shows paid/partial/refunded status and linked receipts.
6. Finance can reprint invoice or receipt any time with reprint audit.

### Workflow G: Archive and Retention

1. Released results and completed specimen metadata are moved into archive state.
2. Physical sample/archive location is recorded where applicable.
3. Electronic records remain searchable according to role permissions.
4. Records are retained for a minimum of 10 years.
5. Disposal after retention requires policy approval, reason, supervisor approval, and immutable disposal log.

## 9. Communications Between Departments

The system must provide communication lines between all departments.

Required features:

- Department-to-department threads linked to orders, specimens, order items, invoices, or reports.
- Direct messages where policy allows.
- Broadcast notices from admin or quality.
- Exception alerts for rejected samples, missing payment, failed QC, delayed TAT, missing specimen, or unread clinician response.
- Message read receipts for regulated workflow messages.
- Attachments where needed, stored with audit and retention policy.
- All communication actions recorded immutably.

Implementation status: implemented end to end on 2026-05-03.

- Backend APIs provide linked department/direct/broadcast/exception threads, message read acknowledgements, attachment upload/download through controlled DMS storage, and an idempotent exception-alert sync endpoint.
- Access controls enforce participant-only direct threads, role/department thread visibility, admin/super-admin broadcast creation, and attachment download authorization.
- Immutable audit events are recorded for thread creation, message send, regulated read acknowledgement, broadcast creation, exception creation/sync, and attachment upload.
- Frontend communications now includes thread type, departments, direct recipients, broadcast audiences, exception category, priority, linked entity fields, regulated read controls, and attachments.
- Hardening E2E coverage verifies linked regulated communications, direct-message policy rejection, unauthorized broadcast rejection, read receipts, attachment storage/download, broadcasts, manual exceptions, synced failed-QC exceptions, and audit-chain validity.

## 10. Audit and Admin Logs

Every action must be recorded immutably and visible to system administrators in the logs section.

Required audit coverage:

- Login, logout, failed login, MFA events, password reset.
- Patient record create/view/update.
- Clinician account create/update/disable.
- Order create/submit/validate/amend/cancel.
- OCR upload, extraction, verification, correction, and conversion to order.
- Invoice create/print/reprint/update.
- Payment initiate/verify/webhook/manual capture/refund/reversal/exemption.
- Specimen create/label/scan/move/reject/accept/archive.
- Department handoff and receipt.
- Every workflow step start/complete/override.
- Result draft/edit/sign/release/amend.
- Report print/download/send.
- Configuration change.
- Role/permission change.
- Data export and backup/sync action.

Audit records must be append-only and hash-chained. No administrator can silently edit or delete logs. Corrections require new compensating records.

## 11. Archives and Ten-Year Retention

Minimum electronic retention: 10 years.

Records covered:

- Orders and order items.
- Patient and clinician linkage.
- OCR source documents and extracted text.
- Specimens, samples, blocks, slides, aliquots, and archive locations.
- Chain of custody and department handoffs.
- User interaction logs.
- Results, reports, amendments, and signatures.
- Invoices, receipts, refunds, exemptions, and ledger entries.
- Communications and notifications.
- Audit logs.
- Backup/sync logs.

Retention must be configurable only upward unless management explicitly approves a lawful policy change. Deletion must be soft-delete or archival disposal with immutable approval logs.

## 12. Cameroon Cybersecurity and Data Protection

The system must be implemented to support compliance with applicable Cameroon law and regulatory expectations, including privacy, confidentiality, cybersecurity, electronic communications, financial records, and healthcare data governance.

Controls:

- Data minimization by role.
- Strong authentication and MFA for privileged users and external clinicians.
- Role-based and object-level authorization.
- Encryption in transit with TLS.
- Encryption at rest for database backups and object storage.
- Separate IT administration access from clinical PHI access.
- Audit logs for all PHI access.
- Patient consent capture where applicable.
- Breach/incident logging and notification workflow.
- Data export controls.
- Backup encryption and tested restore.
- On-premise primary data custody with controlled cloud backup.
- Legal review before production go-live.

The compliance matrix must be validated by qualified local legal/compliance advisors before production launch.

## 13. On-Premise Primary With Cloud Backup and Sync

The on-premise server is the default operational system.

### Required Behavior

- Staff access the on-premise system during normal operations.
- Cloud backup receives encrypted database backups, object-storage backups, and audit/sync metadata when reliable internet is available.
- Sync is resumable after internet interruption.
- Sync never causes silent data loss or last-write-wins overwrites for regulated records.
- Cloud copy can be used for disaster recovery, reporting replica, or emergency read-only access according to policy.

### Sync Categories

- Database: PostgreSQL backups and/or controlled replication.
- Files: OCR uploads, reports, receipts, invoices, images, and attachments.
- Audit logs: hash-chain preserving export.
- Configuration: versioned configuration snapshots.
- Recovery verification: scheduled restore test evidence.

### Offline/Degraded Operation

If internet is unavailable:

- On-premise operations continue.
- Payment gateways may degrade to pending/manual payment mode.
- Cloud sync queue accumulates.
- Users see sync status.
- When internet returns, queued backup/sync jobs resume.

## 14. Required Feature Inventory

The following features must exist end to end before production sign-off:

- Patient online ordering.
- External clinician portal with individual credentials.
- Walk-in reception ordering.
- OCR upload and verified order creation.
- Multi-test order item routing.
- Maviance payment initiation and verification.
- Printable invoice before payment.
- Printable invoice after payment.
- Printable receipt after every payment.
- Reception intake and sample receipt.
- Barcode and label printing.
- Department-level sample custody.
- User-level interaction logging inside departments.
- Histology workflow where configured.
- Cytology workflow where configured.
- IHC and special stains where configured.
- Analyzer or direct-review workflows where configured.
- Result drafting, review, signing, amendment, and release.
- Patient and clinician result access.
- Internal department communications.
- Immutable admin-visible logs.
- Ten-year archives.
- On-prem primary deployment.
- Cloud backup/sync.
- Cameroon compliance controls.
- Admin configuration for test catalog, pricing, workflows, roles, departments, retention, and payment settings.

## 15. Acceptance Criteria

Production readiness requires the following tests to pass:

- Create an online patient order with two tests that route to different workflows; confirm both routes appear and neither is ignored.
- Create a clinician portal order and confirm the clinician sees only their own referred cases.
- Create a walk-in reception order and print the unpaid invoice.
- Pay one invoice through Maviance test credentials; verify webhook updates payment state and receipt is printable.
- Upload a typed note to OCR; verify extracted notes and create an order.
- Upload a handwritten note to OCR; verify extracted notes and create an order after human correction if needed.
- Move a sample from reception to a department without assigning it to a specific user; then record multiple user interactions inside that department.
- Complete one order item while another remains pending; confirm the parent order remains partially completed.
- Complete all order items; confirm the parent order becomes completed/released only after all required results are signed/released.
- Reprint invoice and receipt; confirm reprint audit is visible.
- View full immutable audit log as system admin.
- Archive completed case and confirm ten-year retention policy.
- Simulate internet outage; confirm on-premise work continues and cloud sync resumes later.
- Restore a backup to a test environment and verify orders, files, reports, payments, and audit hashes.

## 16. Current Documentation Updates From Source DOCX

The attached DOCX is superseded in the following ways:

- Replace Kenya-specific legal and mobile-money assumptions with Cameroon compliance review and Maviance/manual payment flows.
- Keep the restored TypeScript/Node/Express modular monolith as the only backend runtime.
- Replace microservice roadmap with a modular-monolith-only operating model.
- Make OCR an explicit testable workflow using open-source OCR.
- Make one-order/many-tests routing explicit and mandatory.
- Make invoice/receipt printing available before and after payment.
- Make department-level custody separate from user-level activity logging.
- Make external clinician portal a separate authenticated portal.
- Make on-premise primary plus cloud backup/sync the deployment default.
- Make immutable admin-visible logs mandatory for every action.
- Make ten-year archive retention mandatory.
