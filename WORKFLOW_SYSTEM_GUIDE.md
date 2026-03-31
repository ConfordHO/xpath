# X-Path Workflow System Guide

This guide explains how the implemented system works from the moment a client places an order to the point where the result is released back to the patient or referring clinician.

It also records the workflow behaviors I verified against the reference system and the local end-to-end smoke test completed on March 31, 2026.

## What Was Verified

I traced the reference product flow and aligned the local system to the same broad behavior:

- Public online order request creates a new order in `draft` state.
- Online orders automatically enter courier pickup flow with `ready_for_pickup`.
- Patient portal can verify by `orderNumber + lastName + dateOfBirth`.
- Courier statuses move step by step until the sample is `received_at_lab`.
- Lab processing starts only after receipt.
- Histology steps progress in order: grossing -> processing -> embedding -> sectioning -> staining.
- Case can move to pathologist review only after staining.
- Report completion and release are separate milestones.
- Patient portal shows billing, courier timeline, processing timeline, and released result.

## Verified Smoke Test

A full local run completed successfully with these generated identifiers:

- Order number: `ORD-000012`
- Accession: `XP-26-906980`
- Block: `XP-26-906980-BLK-001`
- Slide: `XP-26-906980-BLK-001-SLD-001`

Verified final state from the patient portal:

- Order status: `released`
- Financial clearance: `cleared`
- Courier status label: `Received at lab`
- Report completed at: `2026-03-31T02:25:38.610Z`
- Result released at: `2026-03-31T02:25:40.622Z`

Verified timeline sequence:

1. Order created
2. Courier checked in
3. Sample received at lab (courier)
4. Grossing completed
5. Processing completed
6. Embedding completed
7. Sectioning completed
8. Staining completed
9. Report completed
10. Result released

## End-to-End Workflow

### 1. Public Intake

There are three main entry paths:

- Online self-request from the public page
- Walk-in/manual order entry by receptionist or admin
- Referral-driven order linked to a clinician/doctor

For online requests, the system stores:

- Patient demographics
- Contact details
- Home address
- Pickup address
- Pickup place name
- Pickup coordinates when selected
- Requested tests
- Referring clinician text
- Clinical history
- General notes

Online requests are created with:

- `status = draft`
- `orderSource = online`
- `intakeSource = portal`
- `financialClearance = pending`
- `courierStatus = ready_for_pickup`

### 2. Automatic Identifier Assignment

The system assigns identifiers at different stages:

- Order number at order creation: `ORD-######`
- Accession number when technical processing starts: `XP-YY-######`
- Block number during grossing: `XP-YY-######-BLK-001`
- Slide number during sectioning: `XP-YY-######-BLK-001-SLD-001`

Important rule:

- The order number is created immediately at intake.
- The accession is only created when the case formally enters technical processing.
- Blocks do not exist until grossing is completed.
- Slides do not exist until sectioning is completed.

### 3. Courier and Pre-Analytical Flow

For online requests, the courier sequence is:

1. `ready_for_pickup`
2. `on_way_to_pickup`
3. `at_site_for_pickup`
4. `picked_up_on_way_to_lab`
5. `in_transit`
6. `received_at_lab`

When the sample reaches `received_at_lab`, the system also:

- stamps courier receipt time
- backfills order receipt time if it was empty
- moves a still-draft online order into `received`

This gives the patient portal a clear pre-analytical timeline before technical work begins.

### 4. Billing and Financial Control

Patient-facing and staff-facing finance both exist:

- Patient portal can submit a payment request
- Finance can post completed payments
- Finance can confirm payment with patient
- Full payment clears `financialClearance`

In the verified run:

- the patient portal created a pending mobile-money payment request
- finance later posted a completed payment
- finance confirmed that payment with the patient
- the order then showed `financialClearance = cleared`

### 5. Technical / Analytical Workflow

After receipt, the case moves through technical processing:

1. Assign technician
2. Start processing
3. Grossing
4. Processing
5. Embedding
6. Sectioning
7. Staining
8. Ready for review

System guardrails already enforced:

- cancelled orders cannot be processed
- draft orders cannot start processing unless received
- processing cannot happen before grossing
- embedding cannot happen before processing
- sectioning cannot happen before embedding
- staining cannot happen before sectioning
- review cannot happen before staining

### 6. IHC and Digital Pathology

The current workflow also supports:

- IHC entries attached to a slide
- simulated digital slide image generation
- slide-image retrieval by order

In the verified run:

- IHC was logged on the generated slide
- digital slide images were generated for the same slide

### 7. Reporting and Release

Pathologist actions are split into separate stages:

1. Save report draft
2. Lock report
3. Email/release report

These stages matter:

- `save` updates clinical content and versions
- `lock` marks the report complete and sets order `completed`
- `email` releases the result and sets order `released`

This mirrors the real-world difference between:

- report authored
- report finalized
- report actually released

### 8. Patient Portal Result Return

The patient portal now supports:

- lookup by order number, last name, and date of birth
- fallback search by identity when order number is missing
- full order detail view
- courier tracking
- payment history
- released report summary
- diagnosis display
- PDF report download

## Role Handoffs

### Patient / External Clinician

Can:

- request tests online
- save order number
- follow pickup and processing progress
- submit payment requests
- view released results

### Courier

Can:

- progress courier pickup states
- move the order into lab receipt through `received_at_lab`

### Receptionist

Can:

- receive walk-in/manual orders
- mark orders received
- assign technician
- manage front-desk intake progression

### Finance

Can:

- review payment summary
- post completed payments
- confirm payment with patient
- drive financial clearance

### Technician

Can:

- start processing
- gross
- process
- embed
- section
- stain
- add IHC entries
- simulate slide images
- send case to pathologist review

### Pathologist

Can:

- save report content
- finalize report
- release result

## Scenario Handling

### Scenario 1: Online self-request

Expected behavior:

- order is created immediately
- order number is shown to the user
- courier pickup begins automatically
- patient can track every milestone in portal

### Scenario 2: Patient has order number

Expected behavior:

- fastest portal lookup path
- exact order verification using order number + last name + DOB

### Scenario 3: Patient does not have order number

Expected behavior:

- portal can still search by last name + DOB
- matching cases are listed so the patient can open the right one

### Scenario 4: Payment request submitted before finance posts payment

Expected behavior:

- pending payment appears in records
- finance can later reconcile it with a completed transaction
- patient portal shows both pending and completed history

### Scenario 5: Courier delay

Expected behavior:

- order stays visible in one of the courier stages
- no accession is created until lab receipt and processing begins

### Scenario 6: Sample received but not yet processed

Expected behavior:

- order stays `received`
- technician assignment can happen before accessioning

### Scenario 7: Processing in progress

Expected behavior:

- accession exists
- sample is traceable through block and slide generation
- patient portal still reflects that result is pending

### Scenario 8: IHC required

Expected behavior:

- slide can receive IHC records
- case can still continue toward reporting
- slide-level history remains tied to accession/block/slide IDs

### Scenario 9: Digital slide workflow

Expected behavior:

- digital slide image set is linked to the slide ID
- pathologist can retrieve slide images by order

### Scenario 10: Report complete but not yet released

Expected behavior:

- order becomes `completed`
- result is finalized internally
- patient-facing release still waits for release action

### Scenario 11: Final result released

Expected behavior:

- order becomes `released`
- patient portal shows diagnosis and report summary
- released timestamp is stored
- report PDF becomes meaningful for patient download

### Scenario 12: Cancelled order

Current enforced behavior:

- cancelled orders cannot be assigned or processed

### Scenario 13: Sample rejection / discrepancy

The broader data model already includes rejection/discrepancy tracking in specimen and enterprise records.

Operational expectation:

- mark rejection/discrepancy at specimen level
- stop normal processing
- capture reason and follow-up action

### Scenario 14: Order amendment / addendum

The platform already includes amendment/addendum-capable reporting structures.

Operational expectation:

- preserve history/version trail
- avoid overwriting released clinical content without traceability

## Production Notes

The workflow is now functionally smooth across backend and frontend for the tested path:

- external order creation
- automatic numbering
- courier progression
- finance posting
- technical processing
- report sign-out
- patient result return

Still important for future hardening:

- stronger automated regression tests around every status transition
- stricter financial release policies if release must be blocked without clearance
- richer specimen rejection UI flows
- explicit addendum/amendment UI for released reports
- deeper audit exports for regulated environments

## Recommended Test Credentials

See:

- `SEEDED_CREDENTIALS.md`

Most useful roles for checking the workflow:

- `courier@xpath.lims`
- `receptionist@xpath.lims`
- `finance@xpath.lims`
- `technician@xpath.lims`
- `pathologist@xpath.lims`
- `admin@xpath.lims`
