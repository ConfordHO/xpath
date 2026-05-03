# X.PATH Order-to-Report Implementation Guide

Updated: 2026-04-26

This guide explains how the current system works in code for the two primary journeys:

1. Online request to final pathology report
2. Walk-in reception request to final pathology report
3. External clinician portal request to final pathology report
4. OCR-assisted request to final pathology report

It also explains the main control points for the Cameroon implementation: courier activation, receptionist gating, Maviance/manual payment prompting, printable invoices and receipts, multi-test workflow routing, TAT capture, privacy masking, OCR verification, external clinician ordering, immutable audit logs, department custody, cloud backup/sync, and blocker reminders.

## Local runtime

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:4000/api`

The frontend `.env` now points to the local backend by default for development.

## Core principles implemented

- Orders are visible only to the roles that should handle them at each stage.
- Patient identity is visible to reception/admin/requester roles, and anonymized for downstream lab handling after reception.
- Online pickup automatically activates the courier workflow.
- Payment state is captured at pickup, at reception, through Maviance callbacks, and during finance reconciliation.
- A case cannot be released to the laboratory workflow until reception and finance gates are satisfied.
- Multi-test orders expose per-test route guides so histology, cytology, IHC, analyzer, and direct pathology paths do not get mixed or silently ignored.
- TAT is recorded per phase and feeds dashboards/averages.
- Invoices are printable before and after payment; receipts are printable after every payment event.
- OCR intake must retain the source file, raw extracted text, parsed fields, confidence, reviewer corrections, and final order link.
- Sample movement is department-owned; every user interaction inside a department is still recorded.
- Every action is written to immutable admin-visible audit logs.
- Completed results and specimen/sample metadata are archived for at least 10 years.
- When someone tries to continue while a prerequisite is missing, the UI shows a blocker reminder with the missing step and the responsible role.
- Accounting is now Zoho Books only. The system prepares contacts, invoices, and payments for Zoho sync and keeps immutable sync logs.

See also `CAMEROON_LIMS_E2E_IMPLEMENTATION.md` for the complete updated implementation specification based on the attached source document and Cameroon launch instructions.

## Online order to final report

### 1. Public intake

When someone submits the online order form:

- The system creates an order number immediately.
- The order is stored with `orderSource = online`, `status = draft`, and `financialClearance = pending`.
- A unique anonymous case code is also created for downstream privacy masking.
- The requester email and phone are stored for notifications and payment prompts.
- If a referring doctor name/email/phone is supplied and no matching doctor exists, the backend creates the referral-doctor record and a linked doctor portal account where possible.
- Admin and receptionist receive an in-app notification about the new referral doctor.

### 2. Automatic courier activation

Online orders automatically enter courier flow:

- `courierStatus = ready_for_pickup`
- Courier, receptionist, and admin are notified that a pickup is required.

The courier dashboard then supports the pickup progression:

1. `ready_for_pickup`
2. `on_way_to_pickup`
3. `at_site_for_pickup`
4. `picked_up_on_way_to_lab`
5. `in_transit`
6. `received_at_lab`

At pickup, the courier can record:

- whether the order was unpaid
- whether cash was handed to the courier
- whether payment was already done online
- amount collected
- reference
- optional GPS coordinates
- optional transport temperature

### 3. Reception confirmation

When the sample arrives at the facility, the receptionist uses reception intake to:

- confirm physical receipt
- confirm transport condition and temperature
- confirm the condition of the sample
- record whether payment is still unpaid, paid online, cash was with courier, cash was received at reception, or fully reconciled
- append chain-of-custody and pre-analytical log records

Once reception intake is completed:

- the requester is queued for notification that the sample has reached the lab
- the order becomes visible for the next gated steps

### 4. Payment and reconciliation

If payment is still pending, the receptionist or finance role can:

- record direct payment
- send a payment prompt to the requester

Payment prompts support the Cameroon flow through Maviance readiness:

- MTN Mobile Money
- Orange Money
- card/POS or bank-transfer handling through manual finance capture
- other fallback/manual methods

When a completed payment is recorded:

- the order payment state is updated
- financial clearance is recalculated
- the local invoice is ensured
- the receipt becomes printable
- the payment is prepared for Zoho Books sync

### 5. Release to the correct workflow

The receptionist releases the case to the lab only after:

- reception confirmation exists
- financial clearance is `cleared`
- any technician assignment needed by the route has been selected

Before release, the UI checks blockers and shows a popup if anything is missing.

For multi-test orders, the order now exposes per-test workflow routes, for example:

- Histology test -> accessioning -> grossing -> processing -> embedding -> sectioning -> staining -> pathologist review
- Cytology test -> cytology case -> cytology QC -> pathologist review
- IHC-linked test -> accessioning/histology path -> IHC -> pathologist review
- Direct pathology review tests -> pathologist review without technician flow

This preserves one originating order number while ensuring each ordered test has its own workflow state. Completing one test cannot complete or hide the remaining tests.

### 5A. Department custody and user interactions

When a sample moves between work areas, the custody target is the department, not a named individual user. The handoff records the sending department, receiving department, specimen/order item, barcode scan, condition, timestamp, and initiating user.

Inside the receiving department, the system records every user interaction separately: view, scan, start, note, exception, approval, completion, upload, and handoff. This gives the lab department-level work queues without losing user-level accountability.

### 6. Downstream privacy masking

After reception handoff:

- downstream lab roles do not continue using direct patient identity
- the order uses the anonymous case label for lab-facing views
- direct patient contact details are hidden from those downstream roles

This is aligned with the system’s privacy-by-design implementation for Cameroon and broader international data-minimization practice.

### 7. Technical and pathology workflow

After lab release:

- technician-facing work can start
- accessioning and histology stages are barcode-gated where required
- TAT clocks continue to run
- workflow history is written with timestamps and actors
- each order item advances independently according to its configured workflow plan

The pathologist then:

- reviews the anonymized case
- completes the report
- signs out the report in-system
- releases the result

### 8. Final release

When the result is released:

- the requester-facing flow can access the identified patient result again
- communications and report delivery logs are updated
- the order timeline shows the end-to-end path from intake to release

## Walk-in reception to final report

### 1. Front-desk order entry

For a walk-in:

- receptionist or admin creates the patient and order
- referring doctor details can still be linked or created so referral incentives are preserved
- the order starts without courier pickup unless manually added later

### 2. Payment handling

The receptionist can:

- record cash/card/manual payment directly
- mark it as pending
- trigger a payment prompt if needed

### 3. Reception intake

The receptionist confirms:

- sample receipt
- sample condition
- transport details where relevant
- payment collection state

### 4. Workflow release

The receptionist releases the order to the appropriate workflow only when:

- reception has confirmed receipt
- finance is cleared
- technician assignment is chosen if required

### 5. Technical workflow, review, and report

From there the case follows the same controlled downstream path:

- test-specific route
- barcode/traceability controls
- TAT capture
- anonymized downstream handling
- pathologist review
- report completion and release

## External clinician portal order to final report

External referring doctors use a separate clinician portal with their own credentials.

1. Clinician logs in.
2. Clinician creates or selects an authorized patient.
3. Clinician submits requested tests through the online order form or uploads a requisition note for OCR.
4. The system creates one order number and one order item per requested test.
5. Invoice/payment rules run according to patient, clinician, corporate, insurance, or lab policy.
6. Sample collection, reception, accessioning, department workflow, reporting, release, and archiving follow the same controlled route as patient and walk-in orders.
7. Clinician can view only their referred cases and released reports.

Implementation status: implemented end to end on 2026-05-03.

- Doctor-role users have a separate clinician portal at `/doctor-portal`.
- Clinicians can create authorized patients, select existing authorized patients, submit referral orders, or create referral orders from OCR requisition text/files.
- Referral orders create one order number, item-level workflow plans, invoice records, and billing policy metadata for patient, clinician, corporate, insurance, or lab-policy review.
- Referral samples then use the same payment, reception, accessioning, barcode, histology, reporting, and release gates as walk-in and patient orders.
- Doctor users can list only their own referred cases. Report payloads remain hidden until release, then become visible through the clinician portal and order detail.
- E2E hardening coverage verifies manual clinician referral, OCR clinician referral, invoice/payment policy, full lab processing to released report, report privacy before release, and report visibility after release.

## OCR-assisted order to final report

OCR intake supports typed and handwritten notes.

1. User uploads a note or requisition image.
2. Open-source OCR extracts text.
3. The parser proposes patient, clinician, tests, notes, and priority.
4. A human reviewer verifies and corrects the extracted fields.
5. Unmatched or uncertain tests remain in an exception queue and are never silently discarded.
6. The system creates the order, order items, invoice, and workflow plans.
7. Source file, raw OCR text, parsed payload, corrections, reviewer, and created order are retained in the audit trail.

## Invoice and receipt printing

Invoices must be printable at any time before or after payment. Receipts must be printable at any time after payment.

Each invoice print or reprint records an audit event. Each receipt print or reprint records an audit event. Printed documents must show order number, invoice/receipt number, patient or payer details, test lines, totals, amount paid, balance, provider reference where available, and payment status.

## Archive retention

Released reports, order data, specimen/sample data, OCR sources, payment records, communication records, and audit logs are retained electronically for a minimum of 10 years. Disposal after the retention period requires policy authorization and immutable disposal logging.

## Blocker reminders

The system now raises blocker reminders when a user tries to continue without required prior steps.

Examples:

- courier delivery still pending
- reception confirmation pending
- financial clearance pending
- workflow routing pending
- technician assignment pending

Each blocker includes:

- what is missing
- which role owns the next action

## TAT capture

The implementation now captures TAT across the order path, including:

- order creation
- courier lifecycle
- reception intake
- workflow release
- technical workflow stages
- report completion
- result release

These records feed:

- phase-level dashboards
- averages
- operational monitoring

## Zoho Books integration readiness

The internal accounting workspace has been removed from active use.

The accounting path is now:

- referral doctor -> Zoho contact sync
- order -> Zoho invoice sync
- payment -> Zoho customer payment sync

The system includes:

- OAuth consent URL generation
- one-time grant-token exchange support
- organization lookup
- immutable sync logs
- config/readiness visibility in the UI

To complete live Zoho integration, fill these backend env values:

- `ZOHO_BOOKS_ENABLED`
- `ZOHO_BOOKS_CLIENT_ID`
- `ZOHO_BOOKS_CLIENT_SECRET`
- `ZOHO_BOOKS_REDIRECT_URI`
- `ZOHO_BOOKS_REFRESH_TOKEN`
- `ZOHO_BOOKS_ORGANIZATION_ID`
- `ZOHO_BOOKS_WEBHOOK_SECRET`

## Current code-level status

Implemented and working locally:

- Next.js frontend on port `3000`
- TypeScript/Node backend on port `4000`
- PostgreSQL-backed persistence
- online intake
- referral-doctor auto-onboarding notifications
- courier activation and progression
- receptionist intake and payment prompting
- payment recording and clearance gating
- route-to-lab gating with blocker popups
- per-test workflow route visibility
- downstream anonymization
- Zoho Books readiness console
- module-audit target milestone editing

Still dependent on external credentials or third parties:

- live Zoho OAuth tenant credentials
- live Maviance merchant credentials
- live SMS/WhatsApp providers
- live Roche/Leica validation
- production object storage configuration
