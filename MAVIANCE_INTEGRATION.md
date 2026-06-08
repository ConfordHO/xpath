# Maviance Cameroon Integration

This project is now prepared for Cameroon mobile-money collections through Maviance Smobilpay.

## What was implemented

- Backend Smobilpay signing using the documented `s3pAuth` HMAC-SHA1 header flow
- Config-driven MTN Cameroon and Orange Cameroon channel support
- Finance-side Maviance collection initiation
- Local persistence for Maviance transactions, PTN, receipt number, verification code, and gateway status
- Transaction verification against Smobilpay `/verifytx`
- Webhook endpoint for asynchronous payment status updates
- Patient portal support for MTN/Orange payment requests
- Finance dashboard sections for gateway readiness and recent Maviance collections

## Backend env keys

Add these in `backend/.env`:

```env
MAVIANCE_ENABLED=true
MAVIANCE_BASE_URL=https://api.smobilpay.com/s3papi
MAVIANCE_API_VERSION=3.0.0
MAVIANCE_REQUEST_FORMAT=form
MAVIANCE_TIMEOUT_MS=15000

MAVIANCE_ACCESS_TOKEN=your_public_access_token
MAVIANCE_ACCESS_SECRET=your_access_secret
MAVIANCE_WEBHOOK_SECRET=your_webhook_secret

MAVIANCE_MTN_MERCHANT=...
MAVIANCE_MTN_SERVICE_ID=...
MAVIANCE_MTN_PAYITEM_ID=

MAVIANCE_ORANGE_MERCHANT=...
MAVIANCE_ORANGE_SERVICE_ID=...
MAVIANCE_ORANGE_PAYITEM_ID=
```

`MAVIANCE_*_PAYITEM_ID` is optional. If omitted, the backend discovers a valid pay item from `/cashin`.

## Runtime flow

1. OLYVIA asks Smobilpay for a cash-in pay item when a fixed pay item is not configured.
2. OLYVIA requests a quote from `/quotestd`.
3. OLYVIA starts the wallet collection through `/collectstd`.
4. The response is persisted locally as both:
   - a normal `payment`
   - a richer `mavianceTransaction`
5. Finance can re-check the final gateway result through `/verifytx`.
6. Smobilpay webhook callbacks can also update the stored payment automatically.

## Routes added

- `GET /api/payments/maviance/config`
- `GET /api/payments/maviance/account`
- `GET /api/payments/maviance/cashin-packages?channel=mtn_cameroon|orange_cameroon`
- `GET /api/payments/maviance/transactions`
- `POST /api/payments/maviance/initiate`
- `POST /api/payments/maviance/transactions/:id/verify`
- `POST /api/payments/maviance/webhook`

## Patient portal behavior

- If a patient chooses MTN Mobile Money or Orange Money and Maviance is fully configured, the backend can launch a live wallet prompt.
- If Maviance is not yet configured, the same action degrades safely into a normal pending payment request for finance reconciliation.

## Files

- `backend/src/server/maviancePayments.ts`
- `backend/src/config.ts`
- `backend/src/types.ts`
- `backend/src/store.ts`
- `backend/src/server.ts`
- `frontend/src/views/operations.tsx`
- `frontend/src/views/public.tsx`

## Official references used

- Smobilpay authentication: https://apidocs.smobilpay.com/s3papi/Authentication.1578338286.html
- Smobilpay API basics: https://apidocs.smobilpay.com/s3papi/API-Basics.1578338307.html
- Smobilpay API reference: https://apidocs.smobilpay.com/s3papi/API-Reference.2066448558.html
- Smobilpay OpenAPI spec: https://s3papidoc.smobilpay.maviance.info/swagger/s3p.yml
- Smobilpay webhook callback docs: https://apidocs.smobilpay.com/s3papi/Callback-support-via-Webhook.1578338315.html
- Smobilpay use cases: https://apidocs.smobilpay.com/s3papi/Use-Cases.2066448527.html
- Smobilpay error handling: https://apidocs.smobilpay.com/s3papi/Error-Codes-%26-Server-Responses.1578338301.html
