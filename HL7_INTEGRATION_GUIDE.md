# HL7, MLLP, Leica, and Roche Integration Guide

## What is now implemented

The backend now supports:

- HL7 v2.x message parsing with MLLP framing
- automatic ACK generation with `CA` and `CE`
- inbound message routing for:
  - `ADT^A28`
  - `ADT^A31`
  - `ADT^A40`
  - `OML^O21`
  - `ORU^R01`
  - `SSU^U03`
- ASTM adapter ingest for cobas-style payloads
- message audit logging for inbound and outbound traffic
- specimen records and immutable specimen status history
- result persistence
- scanner image reference persistence using WADO-style URLs
- outbound HL7 preview/send API
- scanner order-download message generation

## Runtime listener

The TCP MLLP listener starts with the backend and listens on:

- host: `0.0.0.0`
- port: `2575`

It strips MLLP framing, routes the message, and responds with an ACK wrapped in MLLP.

## Main files

- [hl7Integration.ts](/Users/mac/Desktop/Work-Space/xpath/backend/src/server/hl7Integration.ts)
- [types.ts](/Users/mac/Desktop/Work-Space/xpath/backend/src/types.ts)
- [store.ts](/Users/mac/Desktop/Work-Space/xpath/backend/src/store.ts)
- [seed.ts](/Users/mac/Desktop/Work-Space/xpath/backend/src/seed.ts)

## REST endpoints

Authenticated:

- `GET /api/v1/hl7/log`
- `POST /api/v1/hl7/outbound`
- `GET /api/v1/specimens`
- `POST /api/v1/specimens`
- `GET /api/v1/specimens/:id`
- `PATCH /api/v1/specimens/:id/status`
- `GET /api/v1/specimens/:id/history`
- `POST /api/v1/orders`
- `GET /api/v1/orders/:id`
- `DELETE /api/v1/orders/:id`
- `POST /api/v1/orders/:id/dispatch-hl7`
- `POST /api/v1/results`
- `GET /api/v1/results/:specimenId`
- `PATCH /api/v1/results/:id`
- `POST /api/v1/images`
- `GET /api/v1/images/:specimenId`
- `POST /api/v1/astm/ingest`

## Status model

Primary specimen workflow states:

- `REGISTERED`
- `GROSSING`
- `PROCESSING`
- `EMBEDDING`
- `SECTIONING`
- `STAINING`
- `SCANNED`
- `UNDER_REVIEW`
- `REPORTED`
- `ARCHIVED`
- `CANCELLED`
- `AMENDED`

Real-time analyzer presence is tracked separately through `trackingStatus`, for example `on_analyzer`.

## Verified smoke tests

These were tested successfully against the running backend:

- login through `POST /api/auth/login`
- outbound HL7 preview through `POST /api/v1/hl7/outbound`
- inbound MLLP for `ADT^A28`, `OML^O21`, `SSU^U03`, and `ORU^R01`
- persistence of a new HL7-created specimen with:
  - `patientExternalId = P-2026-99999`
  - `instrumentId = SPM-HL7-001`
  - `status = SCANNED`
  - `trackingStatus = on_analyzer`
- image persistence from scanner-style `OBX` segments
- ASTM ingest through `POST /api/v1/astm/ingest`

## Current scope

This implementation is API-ready and workflow-aware, but still not the same thing as a production-certified device connection. Remaining real-world work would include:

- vendor-specific conformance testing with Roche and Leica
- real endpoint credentials and network routing
- HL7 field-level validation against each site’s exact profile
- retry queues, dead-letter handling, and operational dashboards
- stronger deduplication and reconciliation rules for high-volume live traffic
