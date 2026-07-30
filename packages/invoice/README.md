# @lamido/invoice

Consumer SDK for invoice-service — Hungarian invoices through szamlazz.hu and Billingo, with
the provider chosen per request.

**Status: phase 1.** The package builds and publishes, and exports nothing but `VERSION`.
The client tier, the idempotency contract and the PDF paths arrive in phase 4 — see
`docs/plans/phase-4-invoice.md` in the repository.

## Install

```sh
pnpm add @lamido/invoice
```

## Configuration comes from your environment

```ini
INVOICE_SERVICE_BASE_URL=https://invoice.example.com
INVOICE_SERVICE_CLIENT_KEY=isk_YOUR_CLIENT_KEY
```

There is **no fallback host**. A missing base URL is a configuration error the SDK reports,
never a silent default, and no host, key or tenant identifier is baked into this package.

This service has **no browser-safe key tier**. An `isk_` key is server-only.

## Licence

MIT.
