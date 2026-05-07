# Open-Source Production Readiness

Updated: 2026-05-06

This records the open-source components currently integrated into PathNovate and the controls required for live use. The codebase builds cleanly and npm audit is clean after dependency updates, but clinical use still requires site SOPs, role training, validation records, and licensed staff sign-off.

## Verification Completed

- Backend production TypeScript build passes with `npm run build --prefix backend`.
- Frontend production build passes with `npm run build --prefix frontend`.
- Backend npm audit reports 0 vulnerabilities after updating `express-rate-limit` and `ip-address` in the lockfile.
- Frontend npm audit reports 0 vulnerabilities after updating `axios` in the lockfile.
- Node runtime is pinned to `>=22.13 <26` because `pdfjs-dist` and related parsing dependencies require Node 22.13+ for supported production use.

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
| Voice dictation | Open-source Whisper CLI plus ffmpeg | Code-ready; enabled only after host install | `WHISPER_ENABLED=true`, installed CLI/model, audio-size limits, audit, human verification |
| Text-to-speech | Browser Web Speech API | Ready on supported HTTPS browsers | No audio is stored; users must verify dictated/read-back text |
| Specialist AI drafting | OpenAI-compatible ChatGPT endpoint or Ollama | Ready as drafting assist only | Configure provider credentials, keep role gates, prohibit autonomous diagnosis/release |

## Deployment Decisions Needed

- Choose the Whisper host path: install `openai-whisper` plus `ffmpeg` on the backend host, or run a separate Whisper worker/service and point `WHISPER_COMMAND` to that wrapper.
- Choose the Whisper model size: `base` is fast for testing, `small` or `medium` gives better transcription at higher CPU/RAM cost.
- Choose the AI drafting provider: ChatGPT/OpenAI-compatible API via `AI_PROVIDER=openai`, `AI_API_BASE_URL=https://api.openai.com/v1`, `AI_API_KEY`, and `AI_MODEL`, or a local Ollama endpoint.
- Confirm whether AI drafting is allowed in production policy. The implementation is role-gated and audited, but every generated report/order/QC note remains a draft until staff verification.
- For hosted Render deployment, keep `WHISPER_ENABLED` unset or false unless the backend image includes Whisper and ffmpeg. Native Render Node services may need a Docker deployment to install those OS/Python dependencies reliably.
