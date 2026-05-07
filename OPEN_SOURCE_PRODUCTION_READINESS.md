# Open-Source Production Readiness

Updated: 2026-05-07

This records the open-source components currently integrated into PathNovate and the controls required for live use. AI drafting is allowed by production policy as staff-verified draft support only: every generated report, order note, and QC note remains a draft until licensed staff verification, sign-off, or formal release.

## Verification Completed

- Backend production TypeScript build passes with `npm run build --prefix backend`.
- Frontend production build passes with `npm run build --prefix frontend`.
- Backend npm audit reports 0 vulnerabilities after updating `express-rate-limit` and `ip-address` in the lockfile.
- Frontend npm audit reports 0 vulnerabilities after updating `axios` in the lockfile.
- Node runtime is pinned to `>=22.13 <26` because `pdfjs-dist` and related parsing dependencies require Node 22.13+ for supported production use.
- Backend hosted deployment now uses `backend/Dockerfile`, which installs `ffmpeg`, Python, and `openai-whisper`.
- Whisper is configured to use the `medium` model.
- Local Ollama drafting is configured through a private Render service and the backend `AI_PROVIDER=ollama` path.
- Backend E2E production hardening suite passes: 11 tests covering auth, TAT, DMS, barcode workflow enforcement, multi-test order routing, clinician portal order-to-report, communications, governance, and logout revocation.
- Browser smoke passed for public home, patient portal, order-online, and clinician portal login redirect using the local backend/frontend.

## Integrated Stack

| Area | Open-source software | Production status | Required controls |
| --- | --- | --- | --- |
| API/runtime | Node.js, Express, Helmet, express-rate-limit, Zod | Ready when deployed on Node 22.13+ with hardened env values | HTTPS, CORS allowlist, JWT secret rotation, rate limits, audit review |
| Database | PostgreSQL driver `pg` | Ready for hosted and future on-prem sync planning | Managed backups, restore tests, SSL, restricted DB users |
| OCR intake | Tesseract CLI, tesseract.js, pdfjs-dist, mammoth, officeparser | Ready as assisted intake, not automatic clinical truth | Human verification before order creation, upload limits, audit trail |
| Camera OCR capture | Browser MediaDevices API | Ready on HTTPS browsers | Camera permission, no local browser storage of captured images beyond the upload flow |
| Image/PDF preprocessing | sharp, @napi-rs/canvas, PDFKit | Ready | Node 22.13+, file limits, generated-document audit retention |
| Barcodes | qrcode, bwip-js | Ready | Barcode scan enforcement and reprint audit controls |
| Queue/offline sync | BullMQ, Automerge, CouchDB-compatible sync path | Code-ready; BullMQ requires Redis for worker separation | Redis for high-volume production, conflict review SOP |
| HL7 | simple-hl7 | Integration-ready | Interface testing with each analyzer/LIS endpoint before live use |
| Digital pathology | Orthanc/OHIF/OpenSeadragon integration hooks | Integration-ready when endpoints are configured | Vendor endpoint validation, access control, storage retention |
| Voice dictation | Open-source Whisper CLI plus ffmpeg | Ready in the Docker backend image with `WHISPER_MODEL=medium` | `WHISPER_ENABLED=true`, audio-size limits, audit, human verification |
| Text-to-speech | Browser Web Speech API | Ready on supported HTTPS browsers | No audio is stored; users must verify dictated/read-back text |
| Specialist AI drafting | Local Ollama private service | Ready as production-allowed draft assist | Private service isolation, role gates, audit trail, no autonomous diagnosis/release |
| External clinician portal | React UI plus consolidated `/api/doctors/me/portal` endpoint | Ready | Public landing link, protected login redirect, linked clinician profile, authorized patient/order/report scoping |

## Hosted Deployment Configuration

- `render.yaml` deploys the backend as Docker so the image can include OS-level packages required by Whisper.
- `render.yaml` adds a private `pathnovate-ollama` service for local Ollama inference and model storage.
- Backend `AI_API_BASE_URL` is populated from the private Ollama service host and port, then normalized to an internal HTTP URL by the backend.
- `WHISPER_MODEL=medium` is set in the backend Docker image and deployment environment.
- The Ollama model is `qwen2.5:1.5b` by default. Increase the Render plan and disk if a larger model is approved.
- If an existing Render web service was originally created as native Node, Render may require recreating that service as Docker because service runtime cannot always be changed in place.
