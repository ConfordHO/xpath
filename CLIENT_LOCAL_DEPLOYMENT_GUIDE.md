# OLYVIA LIMS Local Deployment Guide

This package contains the OLYVIA Lab Information Management System (LIMS), developed by X.PATH Labs, for local/on-site deployment.

The system has two applications:

- `backend`: Node.js/Express API, PostgreSQL-backed application state, reports, workflow logic, authentication, and integrations.
- `frontend`: Next.js web application used from a browser.

The recommended local setup keeps all data on the client machine or on an on-site server. No cloud database is required.

## 1. Requirements

Install these before starting:

- Node.js `22.13` or newer, below `26`
- npm, included with Node.js
- PostgreSQL `14` or newer
- Git, optional but useful

Optional tools:

- Tesseract OCR, if OCR intake should run locally
- ffmpeg and Whisper, if voice transcription should run locally
- A process manager such as PM2, systemd, or Windows Task Scheduler for always-on production use

Check versions:

```bash
node -v
npm -v
psql --version
```

## 2. Unzip The Package

Unzip the package into a working folder, for example:

```bash
mkdir -p ~/olymvia-lims
unzip olyvia-lims-local-deployment.zip -d ~/olymvia-lims
cd ~/olymvia-lims/olymvia-lims
```

If the extracted folder name is different, `cd` into the folder that contains `package.json`, `backend`, and `frontend`.

## 3. Create The Local PostgreSQL Database

Create a database user and database. You may change the username, password, and database name, but keep the same values in `backend/.env`.

```bash
createuser -P olyvia_user
createdb -O olyvia_user olyvia_lims
```

If you prefer using `psql`:

```sql
CREATE USER olyvia_user WITH PASSWORD 'change-this-password';
CREATE DATABASE olyvia_lims OWNER olyvia_user;
```

Test the connection:

```bash
psql "postgresql://olyvia_user:change-this-password@localhost:5432/olyvia_lims" -c "select current_database();"
```

## 4. Configure The Backend

Create the backend environment file:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set at minimum:

```env
PORT=4000
NODE_ENV=production
TRUST_PROXY=false

DATABASE_URL=postgresql://olyvia_user:change-this-password@localhost:5432/olyvia_lims
DATABASE_SSL_MODE=disable
POSTGRES_STATE_TABLE=app_state
POSTGRES_STATE_ID=primary

JWT_SECRET=replace-this-with-a-long-random-secret
JWT_ISSUER=xpath-backend
JWT_AUDIENCE=xpath-clients
JWT_EXPIRY=7d

CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000

DMS_STORAGE_PROVIDER=local
DMS_LOCAL_STORAGE_PATH=./storage/documents

PUBLIC_REGISTRATION_ENABLED=false
HL7_MLLP_ENABLED=false
MAVIANCE_ENABLED=false
NOTIFICATION_EMAIL_ENABLED=false
OFFLINE_SYNC_ENABLED=false
AI_PROVIDER=local
WHISPER_ENABLED=false
```

For access from other computers on the same network, add the server IP to `CORS_ORIGIN`. Example:

```env
CORS_ORIGIN=http://localhost:3000,http://192.168.1.20:3000
```

Generate a strong `JWT_SECRET`. On macOS or Linux:

```bash
openssl rand -base64 48
```

## 5. Configure The Frontend

Create the frontend environment file:

```bash
cp frontend/.env.example frontend/.env
```

For use on the same machine:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_TEST_ACCESS=false
NEXT_PUBLIC_XAF_PER_USD=558.24
```

For LAN access from other machines, use the server IP:

```env
NEXT_PUBLIC_API_URL=http://192.168.1.20:4000/api
NEXT_PUBLIC_TEST_ACCESS=false
NEXT_PUBLIC_XAF_PER_USD=558.24
```

Also make sure the same frontend URL is listed in `backend/.env` under `CORS_ORIGIN`.

## 6. Install Dependencies

From the project root:

```bash
npm install --prefix backend
npm install --prefix frontend
```

## 7. Initialize The Database

Run this once for a new empty database:

```bash
npm run seed --prefix backend
```

Important: seeding resets the LIMS application state. Do not run this again after real patient/order/report data has been entered unless you intentionally want to reset the system.

Seeded demo logins all use this password:

```text
admin123
```

Main seeded accounts:

- `superadmin@xpath.lims`
- `admin@xpath.lims`
- `admin.douala@xpath.lims`
- `receptionist@xpath.lims`
- `technician@xpath.lims`
- `pathologist@xpath.lims`
- `review.pathologist@xpath.lims`
- `finance@xpath.lims`
- `courier@xpath.lims`
- `doctor@xpath.lims`

Before production use, create real user accounts, rotate or disable demo accounts, and enable MFA for administrator roles if required.

## 8. Run In Development Mode

Use this for first-time testing:

```bash
npm run dev:backend
```

In a second terminal:

```bash
npm run dev:frontend
```

Open:

```text
http://localhost:3000
```

Health check:

```bash
curl http://localhost:4000/api/health
```

Expected response:

```json
{"ok":true}
```

## 9. Run In Production Mode Locally

Build both apps:

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

Start the backend:

```bash
npm run start --prefix backend
```

Start the frontend in another terminal:

```bash
PORT=3000 npm run start --prefix frontend
```

Open:

```text
http://localhost:3000
```

For an always-on installation, run these commands under PM2, systemd, or another service manager.

## 10. LAN Access

To allow other staff computers to access the system:

1. Give the server a static LAN IP, for example `192.168.1.20`.
2. Set `frontend/.env`:

```env
NEXT_PUBLIC_API_URL=http://192.168.1.20:4000/api
```

3. Set `backend/.env`:

```env
CORS_ORIGIN=http://localhost:3000,http://192.168.1.20:3000
```

4. Restart backend and frontend.
5. Open from staff computers:

```text
http://192.168.1.20:3000
```

Do not expose PostgreSQL port `5432` to the internet.

## 11. Backups

Create a database backup:

```bash
pg_dump "postgresql://olyvia_user:change-this-password@localhost:5432/olyvia_lims" > olyvia_lims_backup.sql
```

Restore a database backup:

```bash
psql "postgresql://olyvia_user:change-this-password@localhost:5432/olyvia_lims" < olyvia_lims_backup.sql
```

Also back up the document storage folder:

```text
backend/storage/documents
```

Recommended backup schedule:

- Daily database backup
- Daily document storage backup
- Weekly offline backup copy
- Periodic restore test on a separate machine

## 12. Troubleshooting

Backend cannot connect to database:

- Confirm PostgreSQL is running.
- Confirm `DATABASE_URL` username, password, host, port, and database name.
- For local PostgreSQL, use `DATABASE_SSL_MODE=disable`.

Frontend cannot call backend:

- Confirm backend is running on port `4000`.
- Confirm `NEXT_PUBLIC_API_URL` ends with `/api`.
- Confirm `CORS_ORIGIN` includes the exact frontend URL.
- Restart frontend after changing `frontend/.env`.

Login fails:

- Confirm `npm run seed --prefix backend` was run once.
- Confirm the backend is using the intended database.
- Try `superadmin@xpath.lims` with password `admin123`.

Port already in use:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Stop the old process or choose another port.

## 13. Security Notes

- Keep `.env` files private.
- Change all demo passwords before real use.
- Use a long random `JWT_SECRET`.
- Do not expose PostgreSQL directly to public networks.
- Prefer VPN access for remote staff.
- Keep the operating system, Node.js, PostgreSQL, and npm packages updated.
- Back up both PostgreSQL and uploaded document storage.
