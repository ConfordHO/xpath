# Vendor Instrument Integrations

This project now includes API-ready integration scaffolding for:

- Leica tissue processor
- Leica stainer
- Roche scanner

Seeded connector products:

- `Leica HistoCore PELORIS 3`
- `Leica HistoCore SPECTRA ST`
- `Roche VENTANA DP 200`

## What Was Added

Backend support now includes:

- vendor connector configuration records
- outbound vendor job queueing
- retry support for failed or queued jobs
- public webhook endpoints for device callbacks
- workflow-side effects when callbacks arrive

The webhook processing updates persisted workflow data:

- Leica tissue processor callbacks can complete processing tasks and update accession/sample state
- Leica stainer callbacks can complete staining tasks and update slide/sample state
- Roche scanner callbacks can create or update digital slide metadata and append instrument run logs

## API Endpoints

Authenticated endpoints:

- `GET /api/vendor-connectors/catalog`
- `GET /api/vendor-connectors`
- `POST /api/vendor-connectors`
- `PUT /api/vendor-connectors/:id`
- `POST /api/vendor-connectors/:id/test`
- `GET /api/vendor-jobs`
- `POST /api/vendor-jobs`
- `POST /api/vendor-jobs/:id/retry`
- `GET /api/vendor-webhook-events`

Public webhook endpoints:

- `POST /webhooks/vendors/leica/tissue_processor`
- `POST /webhooks/vendors/leica/stainer`
- `POST /webhooks/vendors/roche/scanner`

## Suggested Backend Env Vars

Add these in `backend/.env` when you move from simulation to live vendor traffic:

- `LEICA_PROCESSOR_API_TOKEN`
- `LEICA_PROCESSOR_WEBHOOK_SECRET`
- `LEICA_STAINER_API_TOKEN`
- `LEICA_STAINER_WEBHOOK_SECRET`
- `ROCHE_SCANNER_API_TOKEN`
- `ROCHE_SCANNER_WEBHOOK_SECRET`
- `VENDOR_INTEGRATION_TIMEOUT_MS`

## Current Mode

The seeded vendor connectors default to `liveMode: false`.

That means:

- payloads are fully built and persisted
- dispatch URLs are resolved
- jobs are queued and visible in the UI
- no live outbound call is attempted until you enable live mode on the connector and provide the needed env secret

## Frontend Console

The admin enterprise console now includes:

- connector create and edit
- connector test action
- dispatch queue form
- recent jobs table
- recent webhook events table

## Important Assumption

The referenced Claude share could not be retrieved from this environment because the page was blocked behind an access challenge, so this implementation is based on:

- the vendor scope you specified
- the current LIMS workflow already in this codebase
- official product naming for Leica and Roche hardware
