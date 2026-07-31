# Phase 2 — `@lazslov/api-core`

**Goal:** the one module through which every request leaves the process, plus the primitives
the three service packages share: configuration, an error base, the three response read
paths, a paginator, and the HMAC webhook verifier.

**Depends on:** [phase 1](phase-1-foundations.md).

**Size guide:** this should land around 600–800 lines of source. If it grows past that,
something service-specific has leaked in.

---

## What belongs in core, and what does not

Core owns everything that is true of **all three** services. Given the divergence table in
the [index](README.md#why-not-one-package), that is less than instinct suggests.

| In core | Not in core — why |
|---|---|
| building a request, one `fetch` call, header assembly | — |
| base-URL and credential resolution, including "not configured" | — |
| the error base class and the never-sent sentinel | **error normalisation** — content/invoice read `error.code`, payment reads `problem.type`. Each package parses its own. |
| the three response read paths (`data` / `data` + siblings / raw) | **which endpoint uses which** — per package |
| a generic paginator driven by a page-reader callback | **pagination parameters** — `limit`/`offset` vs keyset cursor vs no paging at all |
| HMAC verification with configurable header names and tolerance | **the header names** — `X-Signature` vs `X-Content-Signature`; each package binds them |
| the browser guard, parameterised by which key prefixes are server-only | **the tripwire behaviour** — payment rejects `Origin` on every surface, content has no tripwire at all |
| idempotency-key *plumbing* and validation | **whether a key is required** — per endpoint, per package |
| — | **money.** Nothing generic is true: invoice is a major-unit number, payment is a minor-unit string. |

---

## 1. Configuration

```ts
export interface ServiceConfig {
  /** Absolute origin, no trailing slash. Trailing slashes are stripped once, here. */
  baseUrl: string;
  /** The bearer token, verbatim. Never parsed, never logged. */
  apiKey: string;
  /** Injected for tests, or to wrap with a consumer's own instrumentation. */
  fetch?: typeof fetch;
  /** Merged into every request's init, under the caller's own per-call init. */
  defaultInit?: RequestInit;
  /** Called before each request. Receives method and path — never headers, never the key. */
  onRequest?: (event: { method: string; path: string }) => void;
}
```

### Resolution, and the two failure modes

Each service package exposes both of these, over one shared core helper:

```ts
createContentClient(config?)     // throws NotConfiguredError if the env is incomplete
tryCreateContentClient(config?)  // returns null instead
```

The `try` variant exists because of a real requirement in the reference integration:

> **RULE — the site must boot, render and be clickable with no service variables set.**
> ([site-integration §11](../content-service/site-integration.md#11-running-with-no-key-at-all))

That is how a new contributor runs the project and how a checkout stays playable without a
production credential. `tryCreate…` returning `null` is what lets a site render placeholders
instead of crashing.

The **`status: 0` sentinel** is the other half of the same idea, taken from
[site-integration §2](../content-service/site-integration.md#2-one-gateway-file-three-cache-modes):
a request that was never made surfaces as an error with `status === 0` and
`code === "not_configured"`, so a consumer's single error translator handles a missing env
var through the same channel as a real 401. Without it, callers need two branches for the
same user-visible outcome.

Explicit config always beats the environment, so one process can hold two clients for two
tenants. There is **no fallback base URL** and reading `process.env` is guarded for runtimes
where it does not exist.

---

## 2. The transport

One function. Everything else in every package calls it.

```ts
async function request<T>(
  cfg: ResolvedConfig,
  spec: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    path: string;                        // always starts with "/", callers never build the origin
    query?: QueryInit;                   // see §3
    body?: unknown;                      // JSON.stringify'd only when present
    headers?: Record<string, string>;
    /** Framework escape hatch: `{ next: { tags: […] } }`, `{ cache: "no-store" }`, `{ signal }`. */
    init?: RequestInit;
    /** How to read the response — see §4. */
    read: ReadMode;
    /** Translates a non-2xx body into an Error. Supplied by the service package. */
    onError: ErrorParser;
  },
): Promise<T>
```

Behaviour, each point earning its place:

- **`Content-Type: application/json` only when there is a body.** Sending it on a GET is
  harmless but noise, and it is the kind of thing that trips a strict gateway.
- **The response body is parsed even on failure.** The error envelope is where `code` and
  `details` live; a transport that reads the body only on success throws away the one thing
  the caller can act on. Parse failures degrade to `null`, never throw.
- **`init` is spread *under* our headers but *over* our cache defaults.** The caller may set
  `next`/`cache`/`signal`; the caller may not overwrite `Authorization`.
- **No `mode` is ever set.** content-service documents a
  [GOTCHA](../content-service/conventions.md#8-security-invariants) that integrators who
  added `mode: "same-origin"` to satisfy invoice-service's tripwire should not copy it here.
  Core stays out of it; each package decides.
- **No timeout, no retry, no backoff.** See the
  [index](README.md#the-sdk-does-not-invent-behaviour). A `signal` passes through.
- **`onRequest` receives method and path only.** Not headers, not the body, not the key.
  There is no code path in core that can put a credential into a log line.

### The credential never widens its blast radius

> **RULE — the key appears in exactly one place: the `Authorization` header of one request.**
> Not in the error object, not in `toString()`, not in a request-echo field, not in
> `onRequest`. Store it on a non-enumerable property so `JSON.stringify(client)` and a
> console inspection of a client object cannot print it.

Cheap to do, and it turns a whole class of accidental disclosure — a caught client object
logged as context — into a non-event.

---

## 3. Query building

`QueryInit` is `Record<string, string | number | boolean | null | undefined>`. `undefined`
and `null` keys are **dropped**, not serialised as `"undefined"`.

Booleans serialise as the literal `"true"` / `"false"`, because content-service accepts only
those two strings and treats anything else as a `400` rather than as falsy
([conventions §6](../content-service/conventions.md#6-types-and-formats)) — which is correct
behaviour and worth not fighting.

---

## 4. The three read paths

> **RULE — do not write a single `unwrap(body.data)` helper and use it everywhere.** It
> compiles, returns the right rows, and silently discards sibling metadata. A time series
> without its `interval` cannot be labelled; a stuck list without its `cutoff` cannot say
> what it filtered on.
> ([invoice conventions §4](../invoice-service/conventions.md#4-response-envelope))

That rule is the reason `read` is an explicit parameter on every call rather than a default.

```ts
export type ReadMode =
  | { kind: "data" }                 // unwrap `data`, discard nothing else exists
  | { kind: "envelope" }             // return `{ data, ...siblings }` whole
  | { kind: "raw" }                  // the parsed body untouched — payment, and /api/health
  | { kind: "bytes" }                // ArrayBuffer + content-type — invoice PDFs
  | { kind: "none" };                // 204, and a webhook ack
```

`bytes` exists because invoice-service's three PDF endpoints answer
`application/pdf`, not JSON ([invoice conventions §4](../invoice-service/conventions.md#4-response-envelope)),
and a transport that always calls `.json()` cannot express that.

`raw` is what payment-service uses for everything: it has
[no envelope at all](../payment-service/conventions.md#4-errors) — a success response is the
resource itself.

### The status is part of the contract, so it must be reachable

Two endpoints distinguish a *new* result from a *replayed* one by **status code alone**:

- invoice-service: *"branch on the status code, not the body — `201` = a new invoice was
  just issued, `200` = an idempotent replay"*
  ([client-api §1](../invoice-service/client-api.md#responses)).
- payment-service: a replay is `200` + the frozen body + an `Idempotent-Replay: true`
  header; a first success is `201`
  ([conventions §5](../payment-service/conventions.md#5-idempotency)).

A transport that returns only the unwrapped body throws that away, and the caller cannot tell
a fresh charge from a replay — which is the one distinction idempotency exists to express.
So every `ReadMode` accepts `withMeta: true`, which wraps the result:

```ts
{ value: T; status: number; headers: Headers }
```

Only the two idempotent creates use it. Everything else takes the plain value, because a
response envelope on every call would be noise.

---

## 5. HMAC signature verification

Both webhook-sending services use the **identical algorithm** with different header names:

| | content-service | payment-service |
|---|---|---|
| Signed string | `` `${timestamp}.${rawBody}` `` | `` `${timestamp}.${rawBody}` `` |
| Algorithm | HMAC-SHA256, lowercase hex, `sha256=` prefix | same |
| Signature header | `X-Content-Signature` | `X-Signature` |
| Timestamp header | `X-Content-Timestamp` (Unix **seconds**) | `X-Signature-Timestamp` (Unix **seconds**) |
| Tolerance | 300 s | 300 s |
| Retry body | identical body, timestamp **and signature** | new `X-Delivery-Id`, same `X-Event-Id` |

So: one verifier in core, two thin bindings in the service packages.

```ts
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

export type VerifyFailure =
  | "missing_signature"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "bad_signature";

export async function verifySignedBody(input: {
  secret: string;
  rawBody: string;           // the raw text. NEVER a re-serialised object.
  signature: string | null;
  timestamp: string | null;
  toleranceSeconds?: number; // default 300
  nowSeconds?: number;       // injectable, so fixtures are deterministic
}): Promise<VerifyResult>;
```

Five implementation requirements, each tied to a documented trap:

1. **Verify over the raw bytes.** `JSON.parse` then re-serialise reorders keys and changes
   whitespace, and the signature stops matching. The signature is the reason `rawBody` is a
   `string` parameter and not an object — the type makes the mistake awkward.
2. **The timestamp header goes into the digest verbatim**, as the string it arrived as. Not
   `Number(ts)` re-stringified — that would break on a leading zero.
3. **Reject a skew over the tolerance, checked before the digest.** The timestamp is inside
   the signed string on purpose: without a skew window, a captured body replays forever.
4. **Constant-time comparison, with no Node-only API.** `node:crypto.timingSafeEqual`
   throws on a length mismatch and is unavailable on edge runtimes. Instead use
   **double-HMAC**: generate a random 32-byte key once per call, HMAC both the presented and
   the computed signature under it, and compare those digests. Equal-length by construction,
   and a byte-wise comparison of two unpredictable digests leaks nothing about the secret.
5. **Return a result, never throw.** The published snippets both note that a thrown error in
   a verification path *"tends to get caught and treated as valid by accident."* The function
   is `async` because `crypto.subtle` is — callers must `await`, and a forgotten `await`
   yields a Promise which is truthy, so `if (!verdict.ok)` on a Promise would pass. Guard
   against that: the result object is branded, and the route-handler helpers in
   [phase 6](phase-6-next-adapters.md) take the verdict rather than letting a consumer
   hand-roll the check.

The secret is used **whole**. payment-service states it explicitly:

> **RULE — the whole `whsec_…` string is the key.** The prefix is key material, not a label
> to strip. ([merchant-api](../payment-service/merchant-api.md#verifying-the-signature))

So the verifier must not trim, split on `_`, or normalise the secret in any way.

### Pinned fixtures

payment-service's published snippet is *"drift-tested against the signing implementation"* —
a test in the service repo feeds it the same fixture the signer is pinned against. Core
mirrors that: `packages/api-core/test/fixtures/hmac/*.json`, each holding a secret, a raw
body, a timestamp, and the expected signature, with at least one case per `VerifyFailure`
value and one case whose body contains non-ASCII (Hungarian accented characters appear in
invoice payloads, and UTF-8 byte length is where a naive implementation diverges).

---

## 6. The browser guard

The three services differ, so the guard is parameterised rather than absolute.

```ts
export function assertServerOnly(apiKey: string, opts: {
  serverOnlyPrefixes: readonly string[];
  serviceName: string;
}): void;
```

It throws at **client construction** — not per request — when
`typeof window !== "undefined"` and the key carries a server-only prefix. Bindings:

| Package | `serverOnlyPrefixes` | Rationale |
|---|---|---|
| content | `["csk_"]` | a `cpk_` key is [public by design](../content-service/conventions.md#2-the-three-credential-tiers) and browser-safe; a `csk_` in a bundle *"must be rotated, not hidden."* |
| invoice | `["isk_"]` | no CORS on any route; browser `fetch` fails anyway |
| payment | `["pmk_"]` | server-to-server only; the service rejects an `Origin` header with 403 before auth runs |

This is a **tripwire, not a boundary** — the same framing the payment docs use for their own
`Origin` check. It catches the accident (a gateway module imported into a React client
component) at the earliest possible moment, with a message that says which env var to move
and that the exposed key now needs rotating rather than hiding.

It does not replace `import "server-only"`. Each package's README tells the consumer to put
that at the top of their gateway file, because a build error beats a runtime throw. The
guard is what catches the case where they did not.

---

## 7. Errors

```ts
export class LamidoApiError extends Error {
  readonly service: string;      // "content-service" | …
  readonly status: number;       // 0 when the request was never made
  readonly code: string;         // the service's stable machine value
  readonly details?: unknown;
  readonly requestPath: string;  // path only — never a full URL, never a query string
  readonly retryable: boolean;   // decided by the service package, from its own error table
}

export class NotConfiguredError extends LamidoApiError { /* status 0, code "not_configured" */ }
```

Design notes:

- **`code` is a plain string, widened per package** to a union of that service's documented
  values (`ContentErrorCode`, `InvoiceErrorCode`, `PaymentProblemType`). A caller gets
  exhaustive `switch` narrowing without core knowing any of them.
- **`requestPath` is the path, never the full URL.** payment-service does exactly this in its
  RFC 7807 `instance` member, and for the stated reason: Barion puts `paymentId` in the query
  string and there is no reason to echo that into anyone's logs. Same discipline here — and
  it also means an error object cannot carry the host.
- **`retryable` is computed by the service package**, from its own documented error table,
  not inferred from the status code. A 422 on payment-service means *"the state forbids it,
  retry later"*; a 409 sometimes means retry and sometimes does not. Only the package that
  read the table can say.
- **No response body echo.** `details` carries only the service's own `details` /
  extension members. A request body could contain a plaintext provider secret — invoice's
  docs carry an explicit *"do not log request bodies"* rule — so the error object is not
  allowed to hold one.

---

## 8. The paginator

```ts
export async function collectAll<T>(
  readPage: (params: { limit: number; offset: number }) => Promise<{
    items: T[];
    total?: number;   // absent on the lists that do not return one
  }>,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<T[]>
```

Adapted from
[site-integration §2](../content-service/site-integration.md#unwrap-in-the-gateway-and-follow-total),
with one change forced by invoice-service.

Termination, in order:

1. `items.length === 0` — always terminal.
2. `total` present and `collected >= total` — the normal exit. Guarded by (1) because
   `total` can move between requests.
3. `total` **absent** and `items.length < pageSize` — a short page is the last page. This
   branch is required: `GET /api/invoices` returns no `total`, and the unpaginated
   invoice endpoints omit `limit` and `offset` too, so their body has no pagination keys at
   all ([invoice conventions §6](../invoice-service/conventions.md#6-pagination)).
4. `maxPages` — a loop breaker that **throws** rather than returning a truncated list.
   Default 100. A silently truncated list is a bug nobody looks for in a fetch helper; the
   whole reason this loops instead of hardcoding `limit=100` is that a cap starts truncating
   the day a list outgrows it.

`pageSize` defaults to 100, which is the documented maximum on both `limit`-based services.

Payment's admin tier uses keyset cursors, and its merchant tier is not paginated at all —
neither uses this. `collectAll` is not exported from `@lazslov/payment`.

---

## 9. Idempotency plumbing

Core provides validation and header placement. It does **not** provide generation.

```ts
/** Brands a string so an endpoint requiring a key cannot receive an arbitrary one. */
export type IdempotencyKey = string & { readonly __idempotencyKey: unique symbol };

/** Validates and brands. Throws on empty, on >255 chars, or on non-ASCII. */
export function idempotencyKey(value: string): IdempotencyKey;

/** Derives `${operation}-attempt-${attempt}` — the documented shape. */
export function derivedIdempotencyKey(operation: string, attempt: number): IdempotencyKey;
```

> **RULE — core never generates a key from a clock, a counter or a random source.**

payment-service is explicit: *"derive it from the operation, not from the clock —
`order-12345-attempt-1`, never a fresh UUID per retry,"* and *"a new key after an unanswered
request is how double charges happen."* Barion does not deduplicate on its own request id,
confirmed against its sandbox, so a retry under a new key is simply a second payment.

A convenience that produced a key would be used by default, would be correct in the happy
path, and would silently reintroduce exactly the failure the requirement exists to prevent.
`derivedIdempotencyKey` takes the attempt number **as a parameter** so incrementing it is a
visible decision at the call site.

The branded type is what makes this enforceable: `createPayment` takes
`IdempotencyKey`, so a caller cannot pass `crypto.randomUUID()` without routing it through
`idempotencyKey()` and noticing.

---

## Public API surface

```ts
// @lazslov/api-core
export { request, type ReadMode, type QueryInit }
export { resolveConfig, type ServiceConfig, type ResolvedConfig }
export { LamidoApiError, NotConfiguredError }
export { verifySignedBody, type VerifyResult, type VerifyFailure }
export { assertServerOnly }
export { collectAll }
export { idempotencyKey, derivedIdempotencyKey, type IdempotencyKey }
export { VERSION }
```

Core is a **published package but not a documented one**: its README says "you probably want
`@lazslov/content`, `@lazslov/invoice` or `@lazslov/payment`" and describes only
`verifySignedBody` and the error classes, which are the two things a consumer touches
directly.

---

## Exit criteria

- [ ] `dependencies` is `{}`. Verified by the tarball audit, not by inspection.
- [ ] `request` works against a stub `fetch` for all five `ReadMode`s, including a non-JSON error body and a 204.
- [ ] A caller-supplied `init` reaches `fetch` intact — asserted specifically for `{ next: { tags: ["content"] } }` and for `{ signal }` — and cannot overwrite `Authorization`.
- [ ] `JSON.stringify(client)`, `String(client)`, `util.inspect(client)` and `JSON.stringify(caughtError)` contain no substring of the API key. One test each.
- [ ] `verifySignedBody` passes every pinned fixture, including a non-ASCII body and one case per `VerifyFailure`.
- [ ] Verification runs green on Node 20.19, Node 22, and a simulated edge environment where `node:crypto` and `Buffer` are undefined.
- [ ] A wrong-by-one-byte signature is rejected, and the comparison path is double-HMAC (asserted by reading the source in review — there is no way to unit-test constant time meaningfully).
- [ ] `assertServerOnly` throws for `csk_`/`isk_`/`pmk_` when `window` is defined, and does **not** throw for `cpk_`.
- [ ] `collectAll` terminates correctly in all four cases, and **throws** rather than truncating at `maxPages`.
- [ ] `idempotencyKey("")` and a 256-character key both throw. There is no export that returns a key without an argument.
- [ ] Core exports no host, no default base URL, and no service-specific error code. Grep-asserted.

## Out of scope here

No endpoint functions, no error-code unions, no money types, no framework awareness. Core
should be describable without naming which three services exist — and the fact that it
*cannot* quite be (the HMAC header tables, the key prefixes) marks exactly the seams where
phases 3–5 bind to it.
