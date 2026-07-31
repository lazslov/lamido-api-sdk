# @lazslov/api-core

## 0.1.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.

### Minor Changes

First release. The shared foundation the three service packages are built on, and the only
runtime dependency any of them declares.

- `request` — one `fetch` wrapper covering all five read modes, passing a caller's `init`
  through intact while refusing to let it overwrite `Authorization`.
- `LamidoApiError` and `NotConfiguredError`, with a redaction contract: no serialisation of a
  client or of a caught error contains any substring of the API key.
- `verifySignedBody` — a constant-time HMAC verifier on `crypto.subtle`, so it runs unchanged in
  an edge runtime with no `node:crypto` and no `Buffer`. **This is the one piece that must exist
  in exactly one place**, and the reason core is published rather than inlined three times.
- `resolveConfig`, `assertServerOnly`, `collectAll`, `idempotencyKey`, `buildQuery`.

Core exports no host, no default base URL and no service-specific error code. Nothing here
knows which service it is talking to.
