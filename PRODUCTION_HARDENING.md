# Production Hardening Update

Updated: 2026-05-07

## 2026-05-07 Hosted Whisper, Ollama, And Portal Access

- The public landing page now includes a direct external clinician portal link alongside the patient portal link.
- Login now returns users to the protected portal they originally opened, so clinician portal links redirect through authentication cleanly.
- The doctor portal frontend now uses a consolidated portal bootstrap endpoint, avoiding noisy multi-endpoint 404s for accounts that are not linked to a clinician profile yet.
- Hosted backend deployment now uses `backend/Dockerfile` so the backend image installs `ffmpeg`, Python, and `openai-whisper`.
- Whisper dictation is configured for the `medium` model through `WHISPER_MODEL=medium`.
- AI drafting is configured for local Ollama via a private Render service, with backend provider `AI_PROVIDER=ollama`.
- Production policy allows AI drafting only as staff-verified draft support. Every generated report, order note, and QC note remains a draft until staff verification.
- Render configuration now adds a private `pathnovate-ollama` service with a persistent model disk and `qwen2.5:1.5b` as the default drafting model.
- Validation passed: backend build, frontend build, backend/frontend audits, Render YAML parse, backend E2E suite, and browser smoke for public home, patient portal, order-online, and clinician portal redirect.

## 2026-05-06 Camera OCR, Voice, Whisper, And AI Assist

- OCR order intake now supports live camera capture for physical medical notes in HTTPS browsers, while retaining file upload and typed requisition text.
- Backend and frontend security headers now explicitly allow same-origin camera and microphone access needed for controlled capture and dictation.
- A new authenticated `/api/ai/transcribe` endpoint accepts audio dictation, runs open-source Whisper CLI when enabled, enforces audio-size limits, checks order access, and records immutable audit events.
- A new authenticated `/api/ai/specialist-assist` endpoint supports order intake, lab observations, histology, IHC, cytology QC, department messages, and pathologist report drafting with role-gated contexts and audit logging.
- The frontend now has reusable voice-assisted text fields with microphone dictation, browser text-to-speech read-back, and specialist drafting assist in order creation, OCR requisition text, histology grossing/processing, IHC QC, cytology QC, report drafting, and addenda.
- Open-source stack readiness is documented in `OPEN_SOURCE_PRODUCTION_READINESS.md`, and `/api/oss/stack-readiness` now reports OCR, Whisper, speech output, and AI controls.
- Dependency audits are clean after updating patched lockfile versions of frontend `axios` and backend `express-rate-limit`/`ip-address`.
- Runtime engines are pinned to Node `>=22.13 <26` to match the PDF/OCR dependency support window.

## 2026-05-03 External Clinician Portal E2E

- External doctor accounts now have a dedicated `/doctor-portal` UI outside the internal staff order screen.
- Clinicians can create/select authorized patients, submit online referral orders, and create OCR-backed referral orders.
- Referral orders persist one order number, one workflow item per requested test, invoice records, and billing policy metadata for patient, clinician, corporate, insurance, or lab-policy review.
- Doctor users are scoped to their own referred patients/orders, and report bodies stay hidden until final report release.
- The controlled order-to-report route for clinician referrals is covered through payment, reception, accessioning, barcode-gated histology, pathologist review, report lock, release, and doctor report visibility.
- A role-based API smoke sweep now covers common module GET endpoints and verifies they do not return server errors.

## 2026-05-03 Department Communications E2E

- Internal communications now support department threads, direct-message threads with recipient policy checks, admin broadcast notices, and regulated exception-alert threads.
- Threads can be explicitly linked to orders, specimens, order items, invoices, and reports, with cross-entity validation before persistence.
- Exception alert creation supports rejected sample, missing payment, failed QC, delayed TAT, missing specimen, and unread clinician response categories.
- Admin/super-admin exception sync can derive alert threads idempotently from rejected samples, non-cleared orders, open QC events, TAT risk/breach records, missing specimens, and unread mandatory portal communications.
- Regulated messages store read receipts, and read acknowledgements are recorded in the immutable audit chain.
- Communication attachments use the existing DMS binary storage path, checksum capture, controlled document metadata, download access checks, and retention timestamps.
- The frontend communications page now exposes multi-department routing, direct recipients, broadcast audiences, exception categories, linked entity fields, regulated read receipt controls, and message attachments.

## 2026-04-18 Modules 1-10 Hardening

- Universal barcode scan enforcement now covers reception intake, lab release, processing start, technical workflow transitions, cytology screening, IHC, special stains, and digital sign-out controls.
- GS1-style barcode handling now includes application-identifier parsing, scan rejection capture, and dedicated operational lifecycle controls for assignment, browser-print, reprint audit, and archive justification.
- Sample rejection now uses a controlled discrepancy workflow with severity, quarantine/rejection/accept-with-deviation decisions, supervisor approval, chain-of-custody exception events, and CAPA links.
- Courier and temperature integrations are API-ready through dispatch/webhook endpoints, provider event telemetry, device-source logger ingestion, excursion detection, and automatic quarantine alerts.
- SLA escalation automation now converts TAT risk/breach alerts into operational notifications for the responsible role.
- Recuts and special stains now have request/approval/completion flows, billing references, control-slide gates, QC blocks, and inventory drawdown.
- Histology worklists now support assignment queues, workload metadata, completion ownership, and audit capture.
- Cytology now includes GYN/non-GYN screening, adequacy criteria, Bethesda-style result category fields, cytotechnologist review, pathologist escalation, QC gates, trend analytics, and template metadata.
- IHC/special stains now enforce batch/lot release, control-slide pass/fail gates, QC exceptions, and reagent usage metrics.
- Digital pathology now has ownership claims, sign-out locks, lock release, and stricter audit trails.
- AI now has a model registry, external validated-model adapter, clinical-use blocking, and local research/QC-only fallback. No free local model is marked clinically diagnostic without regulatory/site validation.

## What Was Hardened In Code

### Audit and compliance

- Audit events are now hash-chained and verifiable.
- Audit persistence is append-only in the application layer: existing audit entries are preserved, and newly appended entries are chained after the latest stored hash.
- Order-specific audit retrieval is available at `GET /api/orders/:id/audit`.
- Global audit verification is available at `GET /api/audit/verify`.
- Request IDs are attached to API responses and recorded with new audit entries.

### Security

- Backend security headers are applied with `helmet`.
- General API and authentication rate limits are enabled.
- JWT validation now checks `issuer`, `audience`, and an active session ID.
- Logout is now server-side and revokes the active session immediately at `POST /api/auth/logout`.
- Revoked sessions are rejected on subsequent requests.

### TAT and workflow control

- TAT clocks and averages are exposed at `GET /api/tat/dashboard`.
- Histology and IHC actions enforce barcode scans before progression.
- Specimen, block, and slide barcodes are automatically assigned when created.
- Business-rule scan failures now return workflow-appropriate client errors instead of incorrect `404`s.

### DMS / file storage

- Document upload is available at `POST /api/documents/upload`.
- File replacement/versioning is available at `POST /api/documents/:id/file`.
- File download is available at `GET /api/documents/:id/file`.
- Local filesystem storage works for development.
- S3-compatible object storage is now implemented in code for production deployments.

### Integration readiness

- Maviance readiness is visible at `GET /api/payments/maviance/config`.
- Live Maviance validation is available at `GET /api/payments/maviance/validate-live`.
- Vendor connector test calls are available at `POST /api/vendor-connectors/:id/test`.
- A consolidated readiness view is available at `GET /api/integration-readiness`.

### Regression coverage


Backend tests now cover:

- auth/login and audit verification
- TAT dashboard response
- DMS upload, replace, and download
- barcode enforcement on histology progression
- multi-test single-order routing with item-level plans, shared specimen links, explicit IHC dependency checks, and final release gating
- external clinician portal order-to-report flow with authorized patients, OCR referral ordering, invoice/payment policy, report privacy before release, and released-report access after sign-out
- department communications with linked regulated threads, direct-message policy rejection, broadcasts, exception alerts and sync, read receipts, attachment upload/download, and audit verification
- public registration closure for production
- connector readiness and simulated vendor tests
- logout/session revocation

## Env Values You Still Need To Fill

### Required

Backend:

- `DATABASE_URL`
- `DATABASE_SSL_MODE`
- `JWT_SECRET`
- `CORS_ORIGIN`

Frontend:

- `NEXT_PUBLIC_API_URL`

### Recommended for production security

Backend:

- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `JWT_EXPIRY`
- `TRUST_PROXY`
- `GENERAL_RATE_LIMIT_WINDOW_MS`
- `GENERAL_RATE_LIMIT_MAX`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `PUBLIC_REGISTRATION_ENABLED=false`
- `MFA_ENFORCED=true` for admin/super-admin production accounts

### Required for live Maviance

- `MAVIANCE_ENABLED=true`
- `MAVIANCE_ACCESS_TOKEN`
- `MAVIANCE_ACCESS_SECRET`
- `MAVIANCE_WEBHOOK_SECRET`
- `MAVIANCE_MTN_MERCHANT`
- `MAVIANCE_MTN_SERVICE_ID`
- `MAVIANCE_MTN_PAYITEM_ID`
- `MAVIANCE_ORANGE_MERCHANT`
- `MAVIANCE_ORANGE_SERVICE_ID`
- `MAVIANCE_ORANGE_PAYITEM_ID`

### Required for live Leica / Roche vendor calls

- `LEICA_PROCESSOR_API_TOKEN`
- `LEICA_PROCESSOR_WEBHOOK_SECRET`
- `LEICA_STAINER_API_TOKEN`
- `LEICA_STAINER_WEBHOOK_SECRET`
- `ROCHE_SCANNER_API_TOKEN`
- `ROCHE_SCANNER_WEBHOOK_SECRET`
- `VENDOR_INTEGRATION_TIMEOUT_MS`

### Required for live courier and temperature telemetry

- `COURIER_PROVIDER`
- `COURIER_API_BASE_URL`
- `COURIER_API_KEY`
- `COURIER_WEBHOOK_SECRET`
- `TEMPERATURE_LOGGER_PROVIDER`
- `TEMPERATURE_LOGGER_WEBHOOK_SECRET`
- `SPECIMEN_TEMP_MIN_CELSIUS`
- `SPECIMEN_TEMP_MAX_CELSIUS`

### Required for clinical AI provider integration

- `AI_VALIDATED_MODEL_ENDPOINT`
- `AI_VALIDATED_MODEL_API_KEY`
- `AI_PROVIDER`
- `AI_API_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

For hosted production, the default drafting provider is local Ollama via Render private networking. Generated text remains staff-verified draft content only.

### Required for Whisper dictation

- `WHISPER_ENABLED=true`
- `WHISPER_COMMAND`
- `WHISPER_MODEL`
- `WHISPER_LANGUAGE`
- `WHISPER_TIMEOUT_MS`
- `WHISPER_MAX_AUDIO_BYTES`

The backend Docker image installs open-source Whisper and `ffmpeg`; native-host deployments must install the same packages before enabling dictation.

### Required for durable document storage

If you want object storage:

- `DMS_STORAGE_PROVIDER=s3`
- `S3_BUCKET_NAME`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

If you stay on filesystem storage:

- `DMS_STORAGE_PROVIDER=local`
- `DMS_LOCAL_STORAGE_PATH`

## Deployment Notes

### Vercel

- `vercel.json` now explicitly sets the frontend install/build commands, `.next` output directory, and the Next.js framework preset.
- This is intended for the frontend only and should produce a `.next` build, not a `dist` build.
- Set `NEXT_PUBLIC_API_URL` in the Vercel project to your deployed backend URL, usually the Render service URL ending in `/api`.

### Render

- `render.yaml` now deploys the backend as Docker using `backend/Dockerfile`.
- `render.yaml` adds a private Docker `pathnovate-ollama` service and injects its internal host/port into `AI_API_BASE_URL`.
- Sensitive values are declared with `sync: false`.
- HL7 MLLP is disabled by default in the Render blueprint because the web deployment is intended for the HTTP API surface.
- For file persistence on Render, prefer S3-compatible storage. If you intentionally use disk storage, attach a persistent disk and point `DMS_LOCAL_STORAGE_PATH` at the mounted path.
- Whisper dictation is enabled in the Docker deployment with the `medium` model.

## What Still Needs Live Validation

- real Maviance account validation with your merchant credentials
- real webhook callbacks from Smobilpay
- real Roche/navify health check and job dispatch against installed endpoints
- real Leica processor/stainer health check and callback validation
- production CORS values for your final frontend domain(s)
- production S3 bucket and retention policy
- PostgreSQL backup, restore, and index review in the target environment

## External References Used

- Vercel and Next.js deployment config options:
  - https://vercel.com/docs/project-configuration/vercel-json
  - https://vercel.com/docs/frameworks/full-stack/nextjs
- Render Blueprint and persistence guidance:
  - https://render.com/docs/blueprint-spec
  - https://render.com/docs/disks
  - https://render.com/docs/cli-reference
- Maviance / Smobilpay signing and webhook behavior:
  - https://apidocs.smobilpay.com/s3papi/Authentication.1578338286.html
  - https://apidocs.smobilpay.com/s3papi/API-Basics-%26-Concepts.2075426886.html
  - https://apidocs.smobilpay.com/s3papi/Callback-support-via-Webhook.1578338315.html
- File upload hardening guidance:
  - https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- Roche and Leica product/integration references used to shape scanner/stainer/processor readiness:
  - https://diagnostics.roche.com/us/en/products/instruments/navify-pathology-lab-hub-ins-6029.html
  - https://diagnostics.roche.com/global/en/products/instruments/ventana-dp-200-ins-6320.html
  - https://www.leicabiosystems.com/en-at/histology-equipment/tissue-processors/histocore-peloris-3/
  - https://www.leicabiosystems.com/fr/equipement-dhistologie/coloration-et-montage-de-la-lamelle-de-routine/automate-de-coloration-histocore-spectra-st/
- Standards and clinical governance references used for the 2026-04-18 hardening pass:
  - https://www.gs1us.org/industries-and-insights/healthcare
  - https://extranet.who.int/prequal/immunization-devices/e006-temperature-monitoring-devices
  - https://www.iso.org/standard/76677.html
  - https://www.ncbi.nlm.nih.gov/books/NBK269610/
  - https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-software-medical-device
  - https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices
