# @lamido/payment

Consumer SDK for payment-service — Stripe and Barion behind one uniform merchant-tier API,
using each merchant's own PSP credentials.

**Status: phase 1.** The package builds and publishes, and exports nothing but `VERSION`.
The merchant tier, the money type, 502 triage and webhook verification arrive in phase 5 —
see `docs/plans/phase-5-payment.md` in the repository.

## Install

```sh
pnpm add @lamido/payment
```

## Configuration comes from your environment

```ini
PAYMENT_SERVICE_URL=https://payment.example.com
PAYMENT_SERVICE_KEY=pmk_YOUR_MERCHANT_KEY
PAYMENT_SERVICE_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

Note `PAYMENT_SERVICE_URL`, not `_BASE_URL` — this service's documented name differs from the
other two. There is **no fallback host**: a missing base URL is a configuration error the
SDK reports, never a silent default.

## Never import this into a browser bundle

A `pmk_` key is full-merchant authority. This package has no browser-safe tier and every
surface is server-only. Keep it out of client components, and out of anything a bundler
ships to a visitor.

## Licence

MIT.
