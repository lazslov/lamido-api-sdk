# Progress

Live status of the eight phases in [README.md](README.md). Each phase's boxes are its own
exit criteria, verbatim — so this file is a checklist, not a summary that can drift from one.

**Where we are:** every build phase — 1 through 6 — is complete. Phase 7 is mostly built: `pnpm verify`
is green (727 unit tests, 21 Node-18 baseline tests, 9 consumer smoke checks, `publint` + `attw` on all
four packages and all four subpaths, four clean tarballs, zero transitive runtime dependencies), both
example projects exist and build, and the live suite is written. Nothing is published and nothing is
pushed.

**What's next:** three of phase 7's criteria are **blocked on things outside this repository** —
sandbox credentials, a Vercel deployment, and a first push. [../live-testing.md](../live-testing.md) is
the checklist for the first two. One unblocked item remains: the doc-example fixtures.

| # | Phase | State |
|---|---|---|
| 1 | [Foundations](phase-1-foundations.md) | ✅ done |
| 2 | [`@lamido/api-core`](phase-2-api-core.md) | ✅ done |
| 3 | [`@lamido/content`](phase-3-content.md) | ✅ done |
| 4 | [`@lamido/invoice`](phase-4-invoice.md) | ✅ done |
| 5 | [`@lamido/payment`](phase-5-payment.md) | ✅ done |
| 6 | [Framework adapters](phase-6-next-adapters.md) | ✅ done |
| 7 | [Verification](phase-7-verification.md) | 🟡 built, partly unproven |
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

## ✅ Phase 3 — `@lamido/content`

- [x] Every website-tier and client-tier consumer endpoint is callable. Admin endpoints absent
- [x] `getPage` on an unpublished slug returns `null`; a 401 from the same call throws
- [x] `page.section("nope")` returns an empty section, not `null`, and does not throw
- [x] `asText` returns `""` for both an absent key and a stored `""`, and a test asserts a
      stored `""` is not replaced by a default
- [x] `prepareValues` drops a key absent from the descriptor, returns `{}` when nothing changed,
      preserves a stored option outside `options`, and rejects a bad `url` with a per-field error
- [x] No exported method writes a whole document or a whole list — grep-asserted
- [x] `reorderItems` throws locally on an incomplete array, before any request
- [x] `createRecord` reports `created: false` on a replay rather than throwing
- [x] `getHealth` returns the degraded body on a 503 instead of throwing
- [x] `verifyRevalidationWebhook` passes fixtures covering `slug: null` and `version: null`
- [x] `createContentClient` throws in a browser with a `csk_`; `createWebsiteClient` with a
      `cpk_` does not
- [x] `tryCreateContentClient()` with no env returns `null`, and a site built on it renders
      *(the `null` and the degraded read are covered; "a site renders" waits for the example
      project in [phase 7](phase-7-verification.md))*

## ✅ Phase 4 — `@lamido/invoice`

- [x] All six client-tier endpoints plus `/api/health` callable; no admin endpoint
- [x] `createInvoice` reports `replayed: true` on a 200 and `false` on a 201, with no overload
      that omits the idempotency key
- [x] `invoice.stornoNumber` is a compile error from `getInvoice`, type-checks from `cancelInvoice`
      *(typed `stornoNumber?: string` there — the provider may return none and the cancel still
      succeeded, so a required `string` would be a type that lies; see ../ai-context.md)*
- [x] `isoDate("2026-13-45")` and `isoDate("25/07/2026")` both throw locally
- [x] `listInvoices(...).total` is a type error; `listAllInvoices()` terminates on a short page
      with no `total`
- [x] `getInvoicePdf` returns bytes and a filename; the cancelled-invoice case is a named error
      *(`InvoiceNotDownloadableError`, on `/download-link` too — it shares the state requirement)*
- [x] `getHealth()` returns `{ status: "ok" }` and is not run through a `data` unwrapper
- [x] `grossAmount` is `number | null`, with no helper converting to payment's minor-unit string
- [x] No `mode` is set on any request — grep-asserted
- [x] `provider_error` is `retryable: true`, and its doc comment states the new-key rule

## ✅ Phase 5 — `@lamido/payment`

- [x] All seven merchant endpoints callable. No admin endpoint, no `/v1/providers/*`
- [x] `createPayment({ amount_minor: "25.00" })` is a type error; `minorUnits("25.00")`,
      `("1e3")`, `(" 1")`, `("01")`, `("0")` all throw
- [x] `huf(1000)` → `"1000"`; `eurCents(1000)` → `"1000"`; `huf(10.5)` throws
- [x] No exported function performs arithmetic on `MinorUnits` — grep-asserted
- [x] No exported conversion between `MinorUnits` and invoice's `grossAmount`
- [x] `createPayment` and `createRefund` have no overload lacking an `IdempotencyKey`
- [x] A 502 for each of the four `detail` shapes classifies correctly; an unrecognised `detail`
      yields `"unclassified"` with `retryable: false`; a reworded message never classifies as
      `"rejected"`
- [x] A 422 is `retryable: true`; a 409 is `retryable: false` except the in-flight-lease case
- [x] `isFulfillable("pending")` and `isFulfillable("authorized")` are both `false`
- [x] `getPayment` throws on 404 and names the wrong-tenant possibility
- [x] `verifyPaymentWebhook` passes pinned fixtures, non-ASCII included *(generated from the
      algorithm the service publishes; pinning against the service repo's **own** fixture file
      waits for [phase 7](phase-7-verification.md)'s live work — see ../ai-context.md)*
- [x] `parsePaymentWebhookEvent` handles `refund.*` extras; `payment.id` is not renamed
- [x] A request body containing an array keeps its order — reordering breaks the body hash
- [x] `reconcilePayments` skips terminal payments, serialises per id, surfaces `retry_after`
- [x] `createPaymentClient` throws in a browser, with rotation named in the message
- [x] No request sets `mode` — grep-asserted

## ✅ Phase 6 — Framework adapters

- [x] Both packages install cleanly with no `next` present and no peer warning; the main entry
      imports nothing from `next` *(the import graph is asserted in `test/next-isolation.test.ts`, and
      `@lamido/payment/next` is imported from `dist/` on Node 18 with nothing but core installed. The
      **fixture project** is phase 7's `examples/node-script` — see the note below)*
- [x] Mode A sets `{ next: { tags: [tag] } }`, mode B `{ next: { revalidate: 10 } }`, mode C
      `{ cache: "no-store" }`
- [x] No way to obtain a `no-store` read from `published` or `live` — type-level assertion
- [x] Gateway tag and handler tag come from one exported constant, asserted equal by default
- [x] Revalidation handler verifies before parsing; `400` stale, `401` bad signature, `200` +
      `revalidateTag` valid; survives `slug: null` and `version: null`; does not compare `site`
- [x] The payment handler cannot be constructed without `alreadyProcessed` and `markProcessed`
- [x] A duplicate `X-Event-Id` answers `200` without calling `onEvent`
- [x] `markProcessed` is not called when `onEvent` throws, and the response is `500`
- [x] A body mutated after signing yields `401` naming the edge-runtime cause
- [x] `asSaveResult` never throws, and maps `validation_error` details into `fields`
- [x] End-to-end fixture: an App Router app renders through mode A, receives a signed
      revalidation POST, and busts the tag its reads set *(the chain — gateway read → signed POST →
      the tag the read set, busted — runs in `packages/content/test/next-handler.test.ts` against a
      stubbed `revalidateTag`. The **real App Router app** is phase 7's `examples/next-site`)*

> **Two criteria above are satisfied by in-repo tests and handed to phase 7 for their fixture-project
> half,** which its §5 already owns. Confirmed with the user rather than assumed; the reasoning is in
> [../ai-context.md](../ai-context.md).

## 🟡 Phase 7 — Verification *(built; three criteria blocked outside this repository)*

Its §5 also carried phase 6's two fixture-project criteria, and both are now met: `examples/node-script`
proves the packages resolve through the `require` condition with an empty environment, and
`examples/next-site` is a real App Router app rendering through mode A with the revalidation route and a
server action.

**What cannot be finished here, and why:** the live suite needs sandbox credentials for three services;
`x-vercel-cache: HIT` needs a deployment; "CI green" needs a push. The first two have a checklist in
[../live-testing.md](../live-testing.md) — the short version is that the *contract* suite runs fine
against services on `localhost`, and only the caching claim genuinely needs Vercel.

- [x] Unit suite covers every exported function in all four packages; the four credential-leak
      tests pass in each *(727 tests, subpaths included)*
- [x] HMAC fixtures pass under Node 18, Node 20, and a stripped environment with no
      `node:crypto`, `Buffer` or `process` *(satisfied in phase 2)*
- [ ] **Every JSON example in the three doc folders parses into its declared SDK type** — *the one
      unblocked item still outstanding. Needs an extraction script over the knowledge base's fenced
      JSON blocks, sanitised into committed fixtures, plus a per-example type assertion. Not started;
      deliberately not half-done, because a partial version would report green over unchecked examples.*
- [x] Type-level tests pass, including every "must be a compile error" case *(each is a
      `@ts-expect-error`, so `pnpm typecheck` is what runs them; plus the three error unions'
      exhaustive `switch` in `test/error-codes.test.ts`)*
- [x] `audit-tarballs` passes on all four packages, and its negative tests prove it still
      detects each forbidden pattern *(`test/audit-detects.test.ts` plants each one and asserts it is
      caught, then asserts a clean package still passes)*
- [ ] `pnpm test:live` passes against sandbox/dev tenants for all three services — **written, never
      run.** 22 cases across the three services, gated on env and skipping loudly with none set. Needs
      a provisioned sandbox: [../live-testing.md](../live-testing.md) is the checklist.
- [x] Both example projects build, and both build with an empty environment *(`examples/node-script`
      runs in `pnpm verify`; `examples/next-site` builds in CI, and its `/` comes out prerendered —
      asserted from the build's own prerender manifest, not by grepping output)*
- [ ] `examples/next-site` shows `x-vercel-cache: HIT` on a second `curl -sI` of a mode-A route —
      **blocked:** that header is produced by Vercel's edge and by nothing else, so it needs a
      deployment. The build-time half (the route is still prerendered) *is* asserted in CI.
- [ ] CI green with zero runtime dependencies per `pnpm why`, except the `@lamido/api-core` edge —
      `pnpm deps:audit` asserts the dependency half locally and is wired into CI. **"CI green" itself
      is blocked on the first push**, which is the carried-forward item below.

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

- [x] **The knowledge-base fix is merged.** `fix/openapi-yaml-scalars` (commit `b428f53`) is now
      `origin/main` in `../knowledge-base`, so a fresh clone can generate types again. Note that
      the local clone's `main` is *behind* that — it sits at `184f7a0`, which predates
      `content-service/` existing at all. Run `git pull` there before `pnpm contracts:drift`.
- [ ] **Push this repository's work.** The commits sit on a local branch with no remote, so CI has
      never actually run — every step has been verified locally instead.
- [ ] **Node 20 in CI has not built the `.mjs` tsdown configs.** The change below was verified on
      Node 24 here; the first push is what proves it on the version CI uses.
- [x] **Licence confirmed:** MIT, `Copyright (c) 2026 Lamido`.
