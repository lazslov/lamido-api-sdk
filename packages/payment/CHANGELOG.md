# @lamido/payment

## 0.1.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.

### Minor Changes

First release. The seven merchant endpoints. No admin endpoint, no `/v1/providers/*`, and no
browser-safe tier — every surface here throws when constructed in a browser.

- `MinorUnits` — a branded decimal string minted by `minorUnits()`, `huf()` or `eurCents()`.
  `createPayment({ amount_minor: "25.00" })` is a type error, and no exported function performs
  arithmetic on the type. HUF is zero-decimal; the branding is what stops that becoming a
  hundredfold mistake.
- `createPayment` and `createRefund` require an `IdempotencyKey`. The key is body-hashed
  upstream, so a request body's array order is preserved exactly as given.
- **502 triage.** Each of the four documented `detail` shapes classifies to a distinct verdict;
  an unrecognised one is `"unclassified"` with `retryable: false`. Failing closed is the only
  safe direction when the question is "did the money move?".
- `isFulfillable` is `true` for `succeeded` and for nothing else — not for `authorized`, not for
  `pending`, and deliberately not for `partially_refunded`.
- `verifyPaymentWebhook` and `parsePaymentWebhookEvent`, plus `./next`'s route handler, which
  cannot be constructed without `alreadyProcessed` and `markProcessed`.
- `reconcilePayments` — skips terminal payments, serialises per id, and returns a report rather
  than `void`, so a `429`'s `retry_after` reaches the caller instead of being swallowed.
