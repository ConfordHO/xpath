# X.PATH Order-to-Report Implementation Guide

Updated: 2026-04-15

This guide explains how the current system works in code for the two primary journeys:

1. Online request to final pathology report
2. Walk-in reception request to final pathology report

It also explains the main control points that were added in this pass: courier activation, receptionist gating, payment prompting, multi-test workflow routing, TAT capture, privacy masking, Zoho Books readiness, and blocker reminders.

## Local runtime

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:4000/api`

The frontend `.env` now points to the local backend by default for development.

## Core principles implemented

- Orders are visible only to the roles that should handle them at each stage.
- Patient identity is visible to reception/admin/requester roles, and anonymized for downstream lab handling after reception.
- Online pickup automatically activates the courier workflow.
- Payment state is captured at pickup, at reception, and during finance reconciliation.
- A case cannot be released to the laboratory workflow until reception and finance gates are satisfied.
- Multi-test orders expose per-test route guides so histology, cytology, IHC, analyzer, and direct pathology paths do not get mixed.
- TAT is recorded per phase and feeds dashboards/averages.
- When someone tries to continue while a prerequisite is missing, the UI shows a blocker reminder with the missing step and the responsible role.
- Accounting is now Zoho Books only. The system prepares contacts, invoices, and payments for Zoho sync and keeps immutable sync logs.

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
- other fallback/manual methods

When a completed payment is recorded:

- the order payment state is updated
- financial clearance is recalculated
- the local invoice is ensured
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

This makes it easier to split operational handling while preserving a single originating order.

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
- Express backend on port `4000`
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
