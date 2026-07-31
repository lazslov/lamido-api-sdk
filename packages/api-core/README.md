# @lamido/api-core

Transport, errors, configuration, HMAC signature verification and pagination shared by the
`@lamido/*` service SDKs.

**You probably do not want to install this directly.** Install `@lamido/content`,
`@lamido/invoice` or `@lamido/payment`; each depends on this package and on nothing else.

Two things here are meant to be used directly.

## `verifySignedBody`

Verifies a webhook from content-service or payment-service. Both sign
`` `${timestamp}.${rawBody}` `` with HMAC-SHA256 and send lowercase hex behind a `sha256=`
prefix with a 300-second tolerance, differing only in header names — so each service package
binds its own names on top of this.

```ts
const verdict = await verifySignedBody({
  secret: webhookSecret,      // the whole whsec_… string; the prefix is key material
  rawBody: await request.text(),   // the raw text, never a re-serialised object
  signature: request.headers.get(signatureHeader),
  timestamp: request.headers.get(timestampHeader),
});

if (!verdict.ok) {
  // "missing_signature" | "malformed_timestamp" | "stale_timestamp" | "bad_signature"
  return new Response(verdict.reason, { status: 400 });
}
```

Three things worth knowing:

- **Pass the raw text.** Parsing and re-serialising reorders keys and changes whitespace, and
  the signature stops matching.
- **It returns a result and never throws.** A thrown error in a verification path tends to get
  caught upstream and treated as valid by accident.
- **`await` it.** The comparison uses Web Crypto, so it is async. The result is a branded type,
  which is what stops a hand-rolled `{ ok: true }` reaching a handler that expects a verdict.

## `LamidoApiError`

Every failed call throws one.

```ts
try {
  await content.getPage("about");
} catch (error) {
  if (error instanceof LamidoApiError) {
    error.status;       // HTTP status, or 0 when the request was never made
    error.code;         // the service's stable machine value, widened per package
    error.retryable;    // from the service's own error table, not guessed from the status
    error.requestPath;  // path only — never a host, never a query string
  }
  throw error;
}
```

`NotConfiguredError` is a subclass with `status: 0` and `code: "not_configured"`, so a missing
environment variable reaches your error translator through the same branch as a real 401.

## Zero runtime dependencies

Everything is a platform API: `fetch`, `AbortController`, `URL` and
`globalThis.crypto.subtle`. Node 18.17+, or any modern edge runtime. There is no `node:crypto`
import anywhere, which is asserted by a test rather than assumed.

## What it deliberately does not do

No retries, no backoff, no timeout, and no generated idempotency keys — all absent upstream on
purpose, and adding any of them here would reintroduce the failure the absence prevents. A
caller who wants a timeout passes an `AbortSignal` through.

## No host, no key, ever

Nothing about a deployment ships in this package — no base URL, no key, no tenant identifier,
not even as a default. The consuming project supplies its base URL from its own environment,
and a missing one is a reported configuration error rather than a silent fallback. The key is
held on a non-enumerable property, so stringifying or inspecting a client cannot print it.

## Licence

MIT.
