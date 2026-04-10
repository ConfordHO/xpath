# Production Hardening Update

Updated: 2026-04-10

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
- connector readiness and simulated vendor tests
- logout/session revocation

## Env Values You Still Need To Fill

### Required

Backend:

- `MONGODB_URI`
- `JWT_SECRET`
- `CORS_ORIGIN`

Frontend:

- `VITE_API_URL`

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

- `vercel.json` now explicitly sets `installCommand`, `buildCommand`, `outputDirectory`, and SPA rewrites.
- This is intended for the frontend only.
- Set `VITE_API_URL` in the Vercel project to your deployed backend URL, usually the Render service URL ending in `/api`.

### Render

- `render.yaml` now deploys the backend from `rootDir: backend`.
- Sensitive values are declared with `sync: false`.
- HL7 MLLP is disabled by default in the Render blueprint because the web deployment is intended for the HTTP API surface.
- For file persistence on Render, prefer S3-compatible storage. If you intentionally use disk storage, attach a persistent disk and point `DMS_LOCAL_STORAGE_PATH` at the mounted path.

## What Still Needs Live Validation

- real Maviance account validation with your merchant credentials
- real webhook callbacks from Smobilpay
- real Roche/navify health check and job dispatch against installed endpoints
- real Leica processor/stainer health check and callback validation
- production CORS values for your final frontend domain(s)
- production S3 bucket and retention policy
- MongoDB backup, restore, and index review in the target environment

## External References Used

- Vercel `vercel.json` config options, including `installCommand`, `outputDirectory`, and SPA rewrites:
  - https://vercel.com/docs/project-configuration/vercel-json
  - https://vercel.com/docs/frameworks/frontend/vite
  - https://vercel.com/docs/routing/rewrites
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
