# @lamido/invoice

## 0.1.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.

### Minor Changes

First release. The six client-tier endpoints plus `/api/health`; no admin endpoint.

- `createInvoice` takes an idempotency key as a **required** parameter — there is no overload
  without one — and reports `replayed: true` on a `200`. invoice-service consumes the key even
  when the call fails, so a retry needs a new one, and the doc comment says so at the call site.
- `cancelInvoice` returns a `CancelledInvoice`; `stornoNumber` exists only on that type, so
  reading it off a `getInvoice` result is a compile error. It is optional there, because the
  provider may return none and the cancel still succeeded.
- `IsoDate` — a branded date, minted by `isoDate()`, which rejects `"2026-13-45"` and
  `"25/07/2026"` locally rather than at the service.
- `getInvoicePdf` returns bytes and a filename reduced to its last path segment; a cancelled
  invoice surfaces as `InvoiceNotDownloadableError` on both `/pdf` and `/download-link`.
- `listInvoices(...).total` is a type error — several of this service's lists omit it — and
  `listAllInvoices()` terminates on a short page with no `total`.

`grossAmount` is a `number | null` in **major** units, and this package ships no conversion to
`@lamido/payment`'s minor-unit strings. The two services do not agree about money, and a helper
pretending otherwise is how a hundredfold error gets shipped.
