# Progress

Live status of the eight phases in [README.md](README.md). Each phase's boxes are its own
exit criteria, verbatim — so this file is a checklist, not a summary that can drift from one.

**Where we are:** phases 1 and 2 are complete and verified locally. Nothing is published, and
nothing is pushed — branch `phase-1-foundations`, commits `195a913` and `af64491`.

**What's next:** phase 3 (`@lamido/content`). Phases 3, 4 and 5 are independent of each other;
the plan's suggested first cut is 1 + 2 + 3 + 6 published as `0.1.0`.

| # | Phase | State |
|---|---|---|
| 1 | [Foundations](phase-1-foundations.md) | ✅ done |
| 2 | [`@lamido/api-core`](phase-2-api-core.md) | ✅ done |
| 3 | [`@lamido/content`](phase-3-content.md) | ⬜ next |
| 4 | [`@lamido/invoice`](phase-4-invoice.md) | ⬜ not started |
| 5 | [`@lamido/payment`](phase-5-payment.md) | ⬜ not started |
| 6 | [Framework adapters](phase-6-next-adapters.md) | ⬜ blocked on 3 and 5 |
| 7 | [Verification](phase-7-verification.md) | ⬜ blocked on 2–6 |
| 8 | [Release & drift](phase-8-release-and-drift.md) | ⬜ blocked on 7 |

Deviations from the plans and the reasoning behind them are in
[../ai-context.md](../ai-context.md).

---

## ✅ Phase 1 — Foundations

- [x] Repo with the four package directories and a root that cannot be published
- [x] `pnpm build` produces ESM + CJS + types for all four; `publint` and `attw` clean on each
- [x] Three contracts pinned, `servers:` stripped, `CONTRACTS.json` filled from the KB front matter
- [x] `pnpm generate:types` is idempotent — running it leaves the working tree clean
- [x] The forbidden-strings lint fails on a planted deployment host and a planted 30-character
      `csk_…`, and passes on `csk_YOUR_SECRET_KEY`
- [x] `audit-tarballs` fails on a deliberately added stray file, then passes once removed
- [x] CI green on an `@lamido/api-core` that exports nothing but a version constant

## ✅ Phase 2 — `@lamido/api-core`

- [x] `dependencies` is `{}`, verified by the tarball audit rather than by inspection
- [x] `request` works against a stub `fetch` for all five `ReadMode`s, including a non-JSON
      error body and a 204
- [x] A caller-supplied `init` reaches `fetch` intact — asserted for `{ next: { tags: […] } }`
      and for `{ signal }` — and cannot overwrite `Authorization`
- [x] `JSON.stringify(client)`, `String(client)`, `util.inspect(client)` and
      `JSON.stringify(caughtError)` contain no substring of the API key
- [x] `verifySignedBody` passes every pinned fixture, including a non-ASCII body and one case
      per `VerifyFailure`
- [x] Verification runs green on Node 18, Node 20, and a simulated edge environment where
      `node:crypto` and `Buffer` are undefined
- [x] A wrong-by-one-byte signature is rejected, and the comparison path is double-HMAC
- [x] `assertServerOnly` throws for `csk_`/`isk_`/`pmk_` when `window` is defined, and does not
      throw for `cpk_`
- [x] `collectAll` terminates correctly in all four cases, and throws rather than truncating at
      `maxPages`
- [x] `idempotencyKey("")` and a 256-character key both throw; no export returns a key without
      an argument
- [x] Core exports no host, no default base URL, and no service-specific error code

---

## ⬜ Phase 3 — `@lamido/content` (next)

- [ ] Every website-tier and client-tier consumer endpoint is callable. Admin endpoints absent
- [ ] `getPage` on an unpublished slug returns `null`; a 401 from the same call throws
- [ ] `page.section("nope")` returns an empty section, not `null`, and does not throw
- [ ] `asText` returns `""` for both an absent key and a stored `""`, and a test asserts a
      stored `""` is not replaced by a default
- [ ] `prepareValues` drops a key absent from the descriptor, returns `{}` when nothing changed,
      preserves a stored option outside `options`, and rejects a bad `url` with a per-field error
- [ ] No exported method writes a whole document or a whole list — grep-asserted
- [ ] `reorderItems` throws locally on an incomplete array, before any request
- [ ] `createRecord` reports `created: false` on a replay rather than throwing
- [ ] `getHealth` returns the degraded body on a 503 instead of throwing
- [ ] `verifyRevalidationWebhook` passes fixtures covering `slug: null` and `version: null`
- [ ] `createContentClient` throws in a browser with a `csk_`; `createWebsiteClient` with a
      `cpk_` does not
- [ ] `tryCreateContentClient()` with no env returns `null`, and a site built on it renders

## ⬜ Phase 4 — `@lamido/invoice`

- [ ] All six client-tier endpoints plus `/api/health` callable; no admin endpoint
- [ ] `createInvoice` reports `replayed: true` on a 200 and `false` on a 201, with no overload
      that omits the idempotency key
- [ ] `invoice.stornoNumber` is a compile error from `getInvoice`, type-checks from `cancelInvoice`
- [ ] `isoDate("2026-13-45")` and `isoDate("25/07/2026")` both throw locally
- [ ] `listInvoices(...).total` is a type error; `listAllInvoices()` terminates on a short page
      with no `total`
- [ ] `getInvoicePdf` returns bytes and a filename; the cancelled-invoice case is a named error
- [ ] `getHealth()` returns `{ status: "ok" }` and is not run through a `data` unwrapper
- [ ] `grossAmount` is `number | null`, with no helper converting to payment's minor-unit string
- [ ] No `mode` is set on any request — grep-asserted
- [ ] `provider_error` is `retryable: true`, and its doc comment states the new-key rule

## ⬜ Phase 5 — `@lamido/payment`

- [ ] All seven merchant endpoints callable. No admin endpoint, no `/v1/providers/*`
- [ ] `createPayment({ amount_minor: "25.00" })` is a type error; `minorUnits("25.00")`,
      `("1e3")`, `(" 1")`, `("01")`, `("0")` all throw
- [ ] `huf(1000)` → `"1000"`; `eurCents(1000)` → `"1000"`; `huf(10.5)` throws
- [ ] No exported function performs arithmetic on `MinorUnits` — grep-asserted
- [ ] No exported conversion between `MinorUnits` and invoice's `grossAmount`
- [ ] `createPayment` and `createRefund` have no overload lacking an `IdempotencyKey`
- [ ] A 502 for each of the four `detail` shapes classifies correctly; an unrecognised `detail`
      yields `"unclassified"` with `retryable: false`; a reworded message never classifies as
      `"rejected"`
- [ ] A 422 is `retryable: true`; a 409 is `retryable: false` except the in-flight-lease case
- [ ] `isFulfillable("pending")` and `isFulfillable("authorized")` are both `false`
- [ ] `getPayment` throws on 404 and names the wrong-tenant possibility
- [ ] `verifyPaymentWebhook` passes the service repo's own pinned fixtures, non-ASCII included
- [ ] `parsePaymentWebhookEvent` handles `refund.*` extras; `payment.id` is not renamed
- [ ] A request body containing an array keeps its order — reordering breaks the body hash
- [ ] `reconcilePayments` skips terminal payments, serialises per id, surfaces `retry_after`
- [ ] `createPaymentClient` throws in a browser, with rotation named in the message
- [ ] No request sets `mode` — grep-asserted

## ⬜ Phase 6 — Framework adapters *(needs 3 and 5)*

- [ ] Both packages install cleanly with no `next` present and no peer warning; the main entry
      imports nothing from `next` — asserted by a fixture project in CI
- [ ] Mode A sets `{ next: { tags: [tag] } }`, mode B `{ next: { revalidate: 10 } }`, mode C
      `{ cache: "no-store" }`
- [ ] No way to obtain a `no-store` read from `published` or `live` — type-level assertion
- [ ] Gateway tag and handler tag come from one exported constant, asserted equal by default
- [ ] Revalidation handler verifies before parsing; `400` stale, `401` bad signature, `200` +
      `revalidateTag` valid; survives `slug: null` and `version: null`; does not compare `site`
- [ ] The payment handler cannot be constructed without `alreadyProcessed` and `markProcessed`
- [ ] A duplicate `X-Event-Id` answers `200` without calling `onEvent`
- [ ] `markProcessed` is not called when `onEvent` throws, and the response is `500`
- [ ] A body mutated after signing yields `401` naming the edge-runtime cause
- [ ] `asSaveResult` never throws, and maps `validation_error` details into `fields`
- [ ] End-to-end fixture: an App Router app renders through mode A, receives a signed
      revalidation POST, and busts the tag its reads set

## ⬜ Phase 7 — Verification *(needs 2–6)*

- [ ] Unit suite covers every exported function in all four packages; the four credential-leak
      tests pass in each *(done for `api-core`)*
- [x] HMAC fixtures pass under Node 18, Node 20, and a stripped environment with no
      `node:crypto`, `Buffer` or `process` *(satisfied in phase 2)*
- [ ] Every JSON example in the three doc folders parses into its declared SDK type
- [ ] Type-level tests pass, including every "must be a compile error" case
- [ ] `audit-tarballs` passes on all four packages, and its negative tests prove it still
      detects each forbidden pattern
- [ ] `pnpm test:live` passes against sandbox/dev tenants for all three services
- [ ] Both example projects build, and both build with an empty environment
- [ ] `examples/next-site` shows `x-vercel-cache: HIT` on a second `curl -sI` of a mode-A route
- [ ] CI green with zero runtime dependencies per `pnpm why`, except the `@lamido/api-core` edge

## ⬜ Phase 8 — Release & drift *(needs 7)*

- [ ] The `@lamido` npm organisation exists and owns the scope; 2FA on; automation token in
      GitHub Actions secrets and in no file
- [ ] Changesets configured for independent versioning; breaking-change table in `CONTRIBUTING.md`
- [ ] A dry-run release produces exactly four tarballs with the expected file lists
- [ ] The release workflow runs the leak audit and the live suite before publishing, and cannot
      be skipped by a manual dispatch flag
- [ ] All four packages publish with provenance, visible in `npm view`
- [ ] A fresh project outside the monorepo can `pnpm add @lamido/content`, set two env vars, and
      read a page
- [ ] The weekly drift job opens an issue when `CONTRACTS.json` is behind the knowledge base
- [ ] Each `CHANGELOG.md` entry names the KB commit and the three `source_commit` values
- [ ] The knowledge-base PR updating the "no SDK package" row is open or merged

---

## Carried-forward items

Things outside any phase's exit criteria that still need a decision or an action.

- [ ] **Push the knowledge-base fix.** Branch `fix/openapi-yaml-scalars` in `../knowledge-base`
      (commit `b428f53`) quotes two `description` scalars that made
      `content-service/openapi.yaml` and `payment-service/openapi.yaml` unparseable as YAML.
      Committed locally, never pushed. Until it merges, a fresh KB clone cannot generate types.
- [ ] **Push this repository's work.** Two commits sit on `phase-1-foundations` with no remote
      branch, so CI has never actually run — every step has been verified locally instead.
- [x] **Licence confirmed:** MIT, `Copyright (c) 2026 Lamido`.
