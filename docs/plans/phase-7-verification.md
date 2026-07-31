# Phase 7 — Verification

**Goal:** prove the SDK is correct against the *real* services, prove the HMAC verifiers
cannot drift from the signers, and prove no tarball carries a host or a credential.

**Depends on:** phases 2–6, but the fixtures and the leak audit should be built alongside each
phase rather than at the end.

---

## Why a normal unit-test suite is not enough here

> **RULE — verify against a real provisioned tenant, not against the code.** Two of that
> build's sharpest bugs — a `no-store` that silently made the whole homepage dynamic and alt
> text that was captured, validated, stored and then thrown away at render — were found only
> by pointing the site at a live dev site and looking at the result. Neither was visible by
> re-reading the diff, and a keyless local build actively hid the first one.
> ([site-integration §1](../content-service/site-integration.md#1-the-shape-of-the-job))

And:

> **GOTCHA — a keyless build hides real bugs.** Treat "works locally with no key" as proof of
> the degraded path only.

So there are three tiers of test, and each proves something the others cannot.

| Tier | Runs | Proves | Needs a credential |
|---|---|---|---|
| **1. Unit** | every commit, CI | request assembly, type behaviour, error parsing, coercions, guards | no |
| **2. Pinned fixtures** | every commit, CI | HMAC verification, and the exact response bodies from the docs' examples | no |
| **3. Live contract** | on demand + nightly | that our understanding of the service is still true | **yes** — sandbox/dev tenants |

---

## 1. Unit tests

Vitest, against an injected stub `fetch` — which is why `fetch` is a constructor option rather
than a global reference ([phase 2 §1](phase-2-api-core.md#1-configuration)). No MSW, no
`nock`: a stub function is enough and keeps the dependency count at zero for tests too.

The stub asserts on what left the process, not just on what came back. Specifically, for every
package:

- the exact path and query string, including that `undefined` params were dropped and booleans
  serialised as `"true"`/`"false"`,
- that `Authorization` is present and **cannot be overridden** by a caller-supplied header,
- that `Content-Type` is set only when there is a body,
- that a caller's `init` — `next`, `cache`, `signal` — reaches `fetch` intact,
- that **no `mode`** is set, by any package,
- that a request body's array order is preserved (payment's body hash depends on it).

### The credential-leak unit tests

These four run in every package and are cheap insurance against the worst failure mode:

```
JSON.stringify(client)            must not contain the key
String(client)                    must not contain the key
util.inspect(client, {depth:null}) must not contain the key
JSON.stringify(caughtError)       must not contain the key
```

Plus: the `onRequest` hook receives an object with exactly `{ method, path }` and no other
keys — asserted on the key set, so adding a field to that hook later fails the test and forces
a deliberate decision.

---

## 2. Pinned fixtures

### HMAC fixtures — the drift guard

payment-service's published verification snippet is *"the one published in the service
repository, where a test feeds it the same fixture the signing implementation is pinned
against — so if the two ever diverge, a build fails there rather than a signature failing in
your integration."*

The SDK mirrors that, using **the same fixtures**. `packages/api-core/test/fixtures/hmac/`
holds JSON cases of `{ secret, rawBody, timestamp, expectedSignature, expect }`, covering:

| Case | Why |
|---|---|
| valid, ASCII body | the happy path |
| valid, **non-ASCII body** (Hungarian accented characters) | UTF-8 byte length is where a naive implementation diverges, and invoice payloads carry `á é í ó ö ő ú ü ű` routinely |
| valid, body containing `{` `}` `"` and a newline | whitespace sensitivity |
| `missing_signature` | header absent |
| `malformed_timestamp` | non-numeric |
| `stale_timestamp` | outside the 300 s window, both directions |
| `bad_signature` | correct length, one byte different |
| `bad_signature` | wrong length entirely (the case `timingSafeEqual` throws on) |
| secret with the `whsec_` prefix | asserts the prefix is used as key material, not stripped |

Run against `verifySignedBody` and against both bindings
(`verifyRevalidationWebhook`, `verifyPaymentWebhook`), so a wrong header name is caught.

**Cross-runtime:** the same suite runs under Node 20.19, Node 22, and an environment where
`node:crypto`, `Buffer` and `process` are deleted — proving the Web Crypto path is genuinely
portable and that nothing crept in that needs Node. *(Was "Node 18, Node 20" until the floor moved
to 20.19; Node 18 hides `globalThis.crypto` behind a flag, so it could never have passed.)*

### Response fixtures from the documentation

Every `examples.http` file and every JSON example in the doc folders is a free, authoritative
fixture. Extract them into `test/fixtures/<service>/` and assert that each parses into the
declared type and that error bodies produce the right `code`/`type`, `retryable`, and
`details` shape.

This has a second benefit: when a doc example and the SDK disagree, one of them is wrong, and
finding out at commit time is the whole point of this repository existing.

### Type-level tests

`expectTypeOf` assertions for the cases where the *type* is the feature:

- `Invoice["stornoNumber"]` does not exist; `CancelledInvoice["stornoNumber"]` is `string`.
- `createPayment({ amount_minor: "2500" })` — a bare string — is an error.
- `createPayment({ amount_minor: 2500 })` — a number — is an error.
- `listInvoices(...)` result has no `total`.
- `published`/`live` gateways cannot produce a `no-store` read.
- `createPaymentWebhookHandler({})` is an error (dedupe callbacks required).
- Every service's error `code` union is exhaustively narrowable in a `switch`.

---

## 3. Leak audit

The one non-negotiable gate, because the package is public and the mistake is permanent —
npm unpublish windows are narrow and a mirror may already have the tarball.

`scripts/audit-tarballs.ts`, run in CI and again in the release job:

1. `pnpm pack` each package into a temp dir and extract it.
2. Assert the file list is exactly what `"files"` allows. No `contracts/`, no `test/`, no
   `.env*`, no `.npmrc`, no `tsconfig`, no source outside `dist`.
3. Run the forbidden-strings scan
   ([phase 1 §5.1](phase-1-foundations.md#51-the-forbidden-strings-lint)) over **every
   extracted file**, including `.d.ts` and **`.map` files** — a sourcemap embeds original
   source text and is the likeliest leak vector. Consider shipping no sourcemaps at all, which
   removes the class entirely; the debugging cost is small for a package this size.
4. Assert `dependencies` is `{}` or exactly `{"@lazslov/api-core": …}`.
5. Assert no OpenAPI document is present in any tarball — `servers:` is stripped on import,
   but the file has no business shipping.

The scan looks for:

| Pattern | Note |
|---|---|
| `lamido.hu`, in any form | |
| any `https?://` host that is not `*.example.com` / `*.example.org` / `localhost` | |
| a key prefix followed by 12+ characters that is not a `_YOUR_`/`_EXAMPLE_` placeholder | bare prefixes must pass — [phase 2 §6](phase-2-api-core.md#6-the-browser-guard) matches on them |
| `whsec_` followed by 12+ characters | |
| any real tenant slug | maintained as a small list in the repo, itself not published |

**Negative tests for the audit itself.** A test plants each forbidden pattern in a temp
package and asserts the audit **fails**, then removes it and asserts it passes. An audit that
silently stopped matching is worse than no audit, and this is the only way to know it still
works.

---

## 4. Live contract tests

Separate suite, separate command (`pnpm test:live`), never on a PR from a fork, never gating a
normal commit. Runs nightly and before every release.

**Credentials** come from CI secrets or a local untracked `.env.live`. Sandbox/dev tenants
only — payment-service's mode is a property of the credential, so a sandbox key cannot touch
real cards, and non-production deployments refuse to construct a live PSP adapter at all.

### What it asserts, per service

Each is chosen because it verifies a *documented claim the SDK depends on*, not just that a
request succeeds.

**content-service**
- `GET /api/client/me` returns the expected site — the documented boot check.
- An unpublished slug answers `404`, and `getPage` maps it to `null`.
- A `?view=draft` attempt answers `403` for every key kind (asserting the SDK is right not to
  expose the parameter).
- A `cpk_` key on `/api/client/*` answers `403`; an unknown key answers `401` with the same
  message as a revoked one.
- Round-trip a value: read it, `PATCH` it back **unchanged**, read it again — proving the
  value shape without publishing anything.
- An out-of-range `limit` is a `400`, not a clamp.

> **GOTCHA — a probe that publishes is not a read-only probe.** Any call to `POST …/publish`
> makes every unpublished draft on that page live. The live suite **must not call publish**
> except against a dedicated throwaway page, and the test file says so at the top. *Read a
> value back unchanged to prove a shape — that costs nothing.*

**invoice-service**
- `GET /api/health` answers a bare `{"status":"ok"}` with no `data` wrapper.
- `GET /api/invoices` returns **no `total`** — the assertion that keeps the paginator honest.
- An unpaginated admin-free list omits `limit`/`offset` entirely rather than sending `null`.
- A malformed `providerConfigId` prefix is a `400 bad_request`.
- Creating with a reused `Idempotency-Key` answers `200`, not `201`, and returns the same row.
- *Not* asserted live: issuing a real invoice against a provider. That has side effects at
  szamlazz.hu/Billingo. Use the provider's own sandbox if one is configured, otherwise stop at
  validation failures, and say so in the test file.

**payment-service**
- A request carrying an `Origin` header is `403` **before** auth — asserted with a deliberately
  wrong key, proving the tripwire ordering.
- `"25.00"` as `amount_minor` is a `400`, confirming the local validator matches the service.
- A `pmk_` key on `/admin/*` is `401`.
- A second `POST …/refresh` within 5 s is a `429` carrying `retry_after`, and **no provider
  call was made**.
- A sandbox payment end to end: create, read, refresh, and one **partial refund** — the
  documented checklist item. Confirms the refund cap and the remaining-amount reporting.
- A replayed create returns `200` + `Idempotent-Replay: true` and the same frozen body.

### The drift signal

A live suite failure means one of two things, and the test output must distinguish them:
**the SDK is wrong**, or **the service moved and this repository's docs are stale.** The
second case triggers the protocol in
[phase 8 §3](phase-8-release-and-drift.md#3-the-drift-protocol) — which starts with updating
the knowledge base, not the SDK.

---

## 5. Consumer smoke projects

Two tiny fixture apps in `examples/`, built in CI, not published:

1. **`examples/next-site`** — App Router. Renders a page through cache mode A, exposes the
   revalidation route, and a server action that saves one field. Proves the `./next` subpath
   resolves, the peer dep works, and — per
   [site-integration §12](../content-service/site-integration.md#12-before-you-call-it-done)
   check 6 — that a `curl -sI` twice against the built route shows a cache **HIT** on the
   second. That is the only mechanical proof the route is still static.
2. **`examples/node-script`** — plain Node, CJS `require`, no framework. Proves the dual build
   works and that the main entries import nothing from `next`.

Both must also build with **no environment variables set at all**, rendering the degraded path
([site-integration §11](../content-service/site-integration.md#11-running-with-no-key-at-all)).
That is a first-class requirement, not a nicety: it is how a new contributor runs a client
project.

---

## Exit criteria

- [ ] Unit suite covers every exported function in all four packages; the four credential-leak tests pass in each.
- [ ] HMAC fixtures pass under Node 20.19, Node 22, and a stripped environment with no `node:crypto`, `Buffer` or `process`.
- [ ] Every JSON example in the three doc folders parses into its declared SDK type. Discrepancies are resolved by fixing the SDK **or** filing a docs PR — not by loosening the type.
- [ ] Type-level tests pass, including every "must be a compile error" case.
- [ ] `audit-tarballs` passes on all four packages, and its own negative tests prove it still detects each forbidden pattern.
- [ ] `pnpm test:live` passes against sandbox/dev tenants for all three services, and calls `publish` nowhere except a throwaway page.
- [ ] Both example projects build, and both build with an empty environment.
- [ ] `examples/next-site` shows `x-vercel-cache: HIT` on a second `curl -sI` of a mode-A route.
- [ ] CI is green with **zero** runtime dependencies reported by `pnpm why` for every package except the single `@lazslov/api-core` edge.

## Out of scope here

Load testing, PSP sandbox automation beyond one payment and one refund, and browser testing —
two of the three packages must never run in a browser, and the third's browser-safe tier is a
plain authenticated `GET`.
