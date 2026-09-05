# Progress

Live status of the nine phases in [README.md](README.md). Each phase's boxes are its own
exit criteria, verbatim — so this file is a checklist, not a summary that can drift from one.

**Where we are: five packages published, four built and waiting.** `v1.0.0` shipped on 2026-08-15
— the original five, each carrying an npm provenance attestation. Phase 9 added `@lazslov/auth`,
`@lazslov/booking`, `@lazslov/email` and `@lazslov/webshop` on 2026-09-04; **none of the four is on
npm yet.**

`pnpm verify` is green across all nine: 1749 unit tests in 108 files, 48 Node 20.19 baseline tests
against the built artefacts, the plain-Node consumer smoke, `publint` + `attw` on every package and
subpath, nine clean tarballs, and zero transitive runtime dependencies.

**What's next, and it blocks the release:** the four new services have no scratch tenants, so eleven
live-suite secrets are unset on the `release` environment. `LIVE_REQUIRE_CONFIGURED` turns that into
a failed release rather than an unverified one, which is the gate working. See
[docs/live-testing.md §3b](../live-testing.md). After that, the items in
[Carried-forward items](#carried-forward-items) below — chiefly that the weekly drift job still
needs a `KNOWLEDGE_BASE_TOKEN` before it can open an issue.

> **The packages are `@lazslov/*`, not `@lamido/*`.** The plan assumed a `@lamido` organisation would
> be created; the registry already resolves `@lamido` to an account that may not be ours, and the
> maintainer publishes from a personal account. A user scope needs no organisation and no paid plan,
> so every package was renamed — before a publish, which is the only time that rename is cheap.
> `Lamido` stays where it names the **project**: the repository, `LAMIDO_KB_PATH`, and the services
> themselves.

| # | Phase | State |
|---|---|---|
| 1 | [Foundations](phase-1-foundations.md) | ✅ done |
| 2 | [`@lazslov/api-core`](phase-2-api-core.md) | ✅ done |
| 3 | [`@lazslov/content`](phase-3-content.md) | ✅ done |
| 4 | [`@lazslov/invoice`](phase-4-invoice.md) | ✅ done |
| 5 | [`@lazslov/payment`](phase-5-payment.md) | ✅ done |
| 6 | [Framework adapters](phase-6-next-adapters.md) | ✅ done |
| 7 | [Verification](phase-7-verification.md) | 🟡 one criterion open — `x-vercel-cache: HIT` needs a deployed site |
| 8 | [Release & drift](phase-8-release-and-drift.md) | ✅ published — all five packages at `1.0.0`, with provenance |
| 9 | [`@lazslov/auth`](phase-9-auth.md) · [`@lazslov/booking`](phase-9-booking.md) · [`@lazslov/email`](phase-9-email.md) · [`@lazslov/webshop`](phase-9-webshop.md) | 🟡 built 2026-09-04 — unpublished; the four live suites need scratch tenants |

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
- [x] CI green on an `@lazslov/api-core` that exports nothing but a version constant

## ✅ Phase 2 — `@lazslov/api-core`

- [x] `dependencies` is `{}`, verified by the tarball audit rather than by inspection
- [x] `request` works against a stub `fetch` for all five `ReadMode`s, including a non-JSON
      error body and a 204
- [x] A caller-supplied `init` reaches `fetch` intact — asserted for `{ next: { tags: […] } }`
      and for `{ signal }` — and cannot overwrite `Authorization`
- [x] `JSON.stringify(client)`, `String(client)`, `util.inspect(client)` and
      `JSON.stringify(caughtError)` contain no substring of the API key
- [x] `verifySignedBody` passes every pinned fixture, including a non-ASCII body and one case
      per `VerifyFailure`
- [x] Verification runs green on Node 20.19, Node 22, and a simulated edge environment where
      `node:crypto` and `Buffer` are undefined *(criterion said "Node 18, Node 20" and was ticked
      without ever having run on 18 — the CI leg died at module resolution first. On Node 18
      `globalThis.crypto` needs `--experimental-global-webcrypto`, so it would have failed. The
      floor moved to 20.19 and this now runs green as written.)*
- [x] A wrong-by-one-byte signature is rejected, and the comparison path is double-HMAC
- [x] `assertServerOnly` throws for `csk_`/`isk_`/`pmk_` when `window` is defined, and does not
      throw for `cpk_`
- [x] `collectAll` terminates correctly in all four cases, and throws rather than truncating at
      `maxPages`
- [x] `idempotencyKey("")` and a 256-character key both throw; no export returns a key without
      an argument
- [x] Core exports no host, no default base URL, and no service-specific error code

---

## ✅ Phase 3 — `@lazslov/content`

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

## ✅ Phase 4 — `@lazslov/invoice`

- [x] All six client-tier endpoints plus `/healthz` callable; no admin endpoint
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
- [x] `getHealth()` returns `{ status: "ok", db: "ok" }` and is not run through a `data` unwrapper
- [x] `grossAmount` is `number | null`, with no helper converting to payment's minor-unit string
- [x] No `mode` is set on any request — grep-asserted
- [x] `provider_error` is `retryable: true`, and its doc comment states the new-key rule

## ✅ Phase 5 — `@lazslov/payment`

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
      `@lazslov/payment/next` is imported from `dist/` on the floor runtime with nothing but core installed. The
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

## 🟡 Phase 7 — Verification *(built; one criterion still needs a deployment)*

Its §5 also carried phase 6's two fixture-project criteria, and both are now met: `examples/node-script`
proves the packages resolve through the `require` condition with an empty environment, and
`examples/next-site` is a real App Router app rendering through mode A with the revalidation route and a
server action.

**What is left, and why:** only `x-vercel-cache: HIT`, which needs a deployed Next site because that
header is produced by Vercel's edge and by nothing else. The live suite is no longer among the gaps —
see below. [../live-testing.md](../live-testing.md) is the checklist, including the part that bit us:
the *contract* suite runs fine against `localhost` while developing, but the release runs it from a
GitHub runner, which cannot reach a laptop.

- [x] Unit suite covers every exported function in all five packages; the four credential-leak
      tests pass in each *(891 tests, subpaths included)*
- [x] HMAC fixtures pass under Node 20.19, Node 22, and a stripped environment with no
      `node:crypto`, `Buffer` or `process` *(satisfied in phase 2 — see the correction there: the
      Node 18 half of the original criterion was never true)*
- [x] Every JSON example in the three doc folders parses into its declared SDK type — *128 extracted by
      `pnpm examples:import` into committed, sanitised fixtures. Key lists are verified **by the
      compiler** against each SDK type, divergence is checked in **both** directions, and every example
      must be claimed by a type or by a stated out-of-scope reason — so a new upstream example fails
      until somebody says what it is. Both assertion directions were mutation-tested.*
- [x] Type-level tests pass, including every "must be a compile error" case *(each is a
      `@ts-expect-error`, so `pnpm typecheck` is what runs them; plus the three error unions'
      exhaustive `switch` in `test/error-codes.test.ts`)*
- [x] `audit-tarballs` passes on all five packages, and its negative tests prove it still
      detects each forbidden pattern *(`test/audit-detects.test.ts` plants each one and asserts it is
      caught, then asserts a clean package still passes)*
- [x] `pnpm test:live` passes against sandbox/dev tenants for all three services — **run, and it
      gated the release.** It passed inside the `v1.0.0` workflow, with `LIVE_REQUIRE_CONFIGURED=true`
      so an unconfigured service would have failed rather than skipped. It also earned its keep first
      time: the initial tag died here on `ECONNREFUSED 127.0.0.1:3302`, because the environment's base
      URLs still named `localhost`. Nothing published — the suite runs before the publish step.
- [x] Both example projects build, and both build with an empty environment *(`examples/node-script`
      runs in `pnpm verify`; `examples/next-site` builds in CI, and its `/` comes out prerendered —
      asserted from the build's own prerender manifest, not by grepping output)*
- [ ] `examples/next-site` shows `x-vercel-cache: HIT` on a second `curl -sI` of a mode-A route —
      **blocked:** that header is produced by Vercel's edge and by nothing else, so it needs a
      deployment. The build-time half (the route is still prerendered) *is* asserted in CI.
- [x] CI green with zero runtime dependencies per `pnpm why`, except the `@lazslov/api-core` edge —
      **proven on a runner.** `pnpm deps:audit` walks the resolved graph in the `verify` job, and run
      [`30631999335`](https://github.com/lazslov/lamido-api-sdk/actions/runs/30631999335) passed it
      along with every other gate. See the carried-forward note below for the three toolchain faults
      between here and the first green run.

## ✅ Phase 8 — Release & drift *(published 2026-08-15 — `v1.0.0`, all five packages)*

- [x] The npm scope exists and is ours; 2FA on; automation token in GitHub Actions secrets and in
      no file — **done.** No organisation was needed: the packages are `@lazslov/*`, the maintainer's
      own npm username. The token is an **Automation** token on the `release` environment, which is
      the kind that matters: a Publish token prompts for 2FA and a workflow cannot answer it.
- [x] Changesets configured for independent versioning; breaking-change table in `CONTRIBUTING.md`
      *(`linked`/`fixed` empty, `access: public`, `privatePackages: false` so `examples/*` are never
      versioned, and `updateInternalDependencies: "minor"` so a core **patch** reaches consumers
      through the caret range without re-releasing three service packages)*
- [x] A dry-run release produces the expected tarballs with the expected file lists —
      `pnpm release:dry-run` emits **five**, core first; `pnpm audit:tarballs` is what checks the
      contents, against a fixed expectation rather than against each manifest's own `"files"`.
      It was four until `@lazslov/telemetry` was added to `packageDirs`, which is the whole of the
      note below
- [x] The release workflow runs the leak audit and the live suite before publishing, and cannot
      be skipped by a manual dispatch flag *(and `test/release-workflow.test.ts` asserts exactly
      that — the ordering, the absence of `workflow_dispatch`, the `--provenance`, and that
      `LIVE_REQUIRE_CONFIGURED` makes a missing secret fail the release rather than skip every case)*
- [x] All **five** packages publish with provenance, visible in `npm view` — **done, 2026-08-15.**
      `@lazslov/api-core`, `content`, `invoice`, `payment` and `telemetry`, all `1.0.0`, each with a
      `dist.attestations` entry. Provenance needed the repository to be **public**, which is why it
      went public before the first tag: npm signs the attestation against a public source repo, and
      the same change unblocked a required reviewer, which GitHub does not offer on a private
      repository outside a paid plan
- [x] A fresh project outside the monorepo can `pnpm add @lazslov/content`, set two env vars, and
      read a page — **done, end to end.** Installed from the registry outside the workspace: three
      packages resolved, so the caret dependency on `@lazslov/api-core` came from npm rather than a
      workspace link. `tryCreateContentClient()` built a client from `CONTENT_SERVICE_BASE_URL` and
      `CONTENT_SERVICE_SECRET_KEY` and nothing else, then `getMe()`, `listPages()` and
      `getRenderedPage()` all answered against the `sdk_live` tenant.

      Two things this shook out. The **deployed** tenant refused the key in `.env.live` with
      `401 Invalid site key`, because a `csk_` is a row in one database and the deployed service
      does not share the local one — so the check ran against `localhost:3302` instead, which the
      criterion allows: it asks for a fresh project and two env vars, not a deployed host. And
      `sdk_live` had **no page**, so one was created through the admin API rather than by an insert,
      to keep validation and the audit entry in the path.
- [ ] The weekly drift job opens an issue when `CONTRACTS.json` is behind the knowledge base —
      **half proven.** The detector ran and found real drift on its first run (see the carried-forward
      note below), and `pnpm contracts:drift --report=…` produced the issue body. The
      *issue-opening* half needs the job to run on GitHub with a `KNOWLEDGE_BASE_TOKEN`.
- [x] Each `CHANGELOG.md` entry names the KB commit and the three `source_commit` values —
      enforced by `test/changelog-provenance.test.ts`, which reads them from `CONTRACTS.json` rather
      than restating them, so a release that forgets the line fails before it ships
- [x] The knowledge-base PR updating the "no SDK package" row is open or merged — **merged.**
      `0bca8b0` is `origin/main` in `../knowledge-base`. One line of `content-service/conventions.md`
      §9; front matter untouched, because the service did not move.

---

## 🟡 Phase 9 — The four remaining services *(built 2026-09-04; unpublished, live suite unrun)*

One plan per package: [phase-9-auth.md](phase-9-auth.md), [phase-9-booking.md](phase-9-booking.md),
[phase-9-email.md](phase-9-email.md), [phase-9-webshop.md](phase-9-webshop.md). Each carries its own
exit criteria; this section holds only what is shared.

- [x] Seven contracts pinned at knowledge base `714f2ee`; `pnpm contracts:drift` passes.
- [x] `packageDirs`, the leak guard, the doc-example sanitiser, the CI link step, the consumer smoke
      and the live config know the four packages. `test/package-shape.test.ts` compares `packageDirs`
      against the workspace, so the telemetry omission cannot recur.
- [x] Every new package ships `.` and `./next`, declares only `@lazslov/api-core`, and imports nothing
      from `next`.
- [x] The five existing packages carry a patch entry naming the new pins, so the provenance test
      holds across all nine.
- [x] Every one of the **405** documented JSON examples across the seven folders is claimed by a
      classifier, and the ones the SDK declares a type for are key-checked in both directions.
- [x] `pnpm verify` green: 1753 unit tests in 108 files, 48 Node 20.19 baseline cases against
      `dist/`, nine clean tarballs, zero transitive runtime dependencies.
- [x] Scratch tenants for auth, booking, email and webshop. Provisioned 2026-09-05 through each
      service's own admin tier, using the admin keys the local `lamido-mcp` checkout holds. One
      tenant per service, named `SDK live probe` / slug `sdk_live`, on production — the estate has
      no second environment, and `live-testing.md` asks for tenants a GitHub runner can reach.
- [x] `pnpm test:live` run against those tenants. **All seven services report `✓` and the four new
      files contribute 19 passing cases** — every documented refusal the packages encode, verified
      against the real services rather than against a stub.
- [ ] The eleven secrets on the `release` environment. `.env.live` holds them; pushing them with
      `./scripts/push-release-secrets.sh` is deliberately left to the maintainer. **The next release
      fails on `LIVE_REQUIRE_CONFIGURED` until that runs.**
- [ ] Published, with each of the four at `1.0.0`.

## Carried-forward items

Things outside any phase's exit criteria that still need a decision or an action.

- [x] **`v1.0.0` shipped, and the first tag failed — on `localhost`.** The `release` environment's
      three base-URL secrets were filled from `.env.live`, which had been filled for local work, so
      the runner dialled `ECONNREFUSED 127.0.0.1:3302` and all fifteen live cases died in
      milliseconds. **Nothing published**, because the live suite runs before the publish step — the
      gate behaving exactly as designed. Fixed by pointing the three URLs at deployed scratch
      tenants and re-running the same run; the tag was never moved, because a moved tag is how a
      published artefact stops matching its provenance attestation. `.env.live.example` and
      [../live-testing.md](../live-testing.md) now both say this out loud.
- [x] **`@lazslov/telemetry` was publishing through gates that never saw it.** `packageDirs` named
      four packages while the workspace publishes five, so `audit:tarballs`, `deps:audit` and three
      shape suites skipped it — `check:leaks`, `publint` and `attw` did not, because they walk the
      workspace rather than the list. Adding it surfaced two real gaps: no `VERSION` export, and a
      dependency assertion that assumed every non-core package depends on `api-core`, which
      telemetry deliberately does not (OB-7 lets a service vendor it as one import-free file).
- [x] **The telemetry package ships at `1.0.0`, not `0.x`.** A caret range does not cross a minor
      below `1.0.0`, so `^0.2.0` refuses `0.3.0` — every rule the package gained would have cost
      each service a bump of its own, which is how three services end up on three envelopes. This
      contradicts the `0.x` paragraph in [CONTRIBUTING.md § Versioning](../../CONTRIBUTING.md#versioning),
      **Reconciled in phase 9:** that section now reads `1.0.0` as the semver contract rather than a
      maturity badge, and the breaking-change table plus the deprecation policy carry what the `0.x`
      rule was protecting.
- [ ] **payment-service still vendors telemetry rather than depending on it.**
      `src/lib/telemetry.ts` is pinned by SHA-256 to SDK commit `6fc776c`, and the SDK has moved
      ~112 lines past it — no flag vocabulary, a bare `LogMeta`, no `correlation_id` binding. Now
      that `@lazslov/telemetry@1.0.0` is on npm the vendored file and its pin test can retire, but
      it is an **upgrade, not a substitution**: `LogMeta` changes shape and the flag vocabulary
      changes what log lines carry, which is what alert rules read. Its own branch and PR, there.
- [ ] **`pnpm publish` logged `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE` before every package.**
      Harmless here — that is pnpm's *trusted publishing* token exchange, not the provenance
      signature, and every package carries an attestation. Worth knowing before someone reads it as
      a provenance failure.
- [x] **Three of the five 404'd on npm for several minutes after a successful publish.** Registry
      replication lag on the read path: `npm access get status` already reported `public` while
      `GET https://registry.npmjs.org/@lazslov%2fcontent` still answered `404`. Not a partial
      publish. Check `npm access get status` before concluding anything from a 404.

- [x] **The knowledge-base fix is merged.** `fix/openapi-yaml-scalars` (commit `b428f53`) is now
      `origin/main` in `../knowledge-base`, so a fresh clone can generate types again. Note that
      the local clone's `main` is *behind* that — it sits at `184f7a0`, which predates
      `content-service/` existing at all. Run `git pull` there before `pnpm contracts:drift`.
- [x] **The work is pushed** — `origin/phase-1-foundations` matches local HEAD. The earlier note here
      was stale.
- [x] **CI is green — all four jobs, and the reason it never had been was the toolchain, not the code.**
      Run [`30631999335`](https://github.com/lazslov/lamido-api-sdk/actions/runs/30631999335) on `main`
      (`4edf718`) passed `verify`, `examples` and `runtime-baseline` on `20.19` and `22` in 2m23s. Three
      pushes and three unrelated faults, each masked by the one before it: (1) every run since phase 3
      died in ~25 s because `pnpm@11.18.0` requires Node ≥22.13 and the workflow pinned Node 20, so
      `actions/setup-node`'s `cache: pnpm` step crashed before a script ran — both pnpm jobs now use
      Node 22 and the root `engines` says `>=22.13`; (2) with that fixed, `verify` and `examples` went
      green at once and all three `runtime-baseline` legs failed on `ERR_MODULE_NOT_FOUND`, because that
      job runs no `pnpm install` and three built entry points import `@lazslov/api-core` as a bare
      specifier — a hand-linking step fixed it; (3) the `18.17` leg then failed on `globalThis.crypto`
      not being a default global below Node 19, which moved the packages' floor to `20.19`.
      **One caveat:** the "Documented examples match the knowledge base" step is conditional on a
      `../knowledge-base` checkout and therefore skips on a runner, so that guard stays local-only.
- [x] **Node 22 in CI builds the `.mjs` tsdown configs.** `pnpm build` runs on Node 22 in both `verify`
      and `examples` in the green run above; the earlier verification was on Node 24 here.
- [x] **The knowledge-base write-back is merged, and the pin follows it.** `docs/content-service-sdk-pointer`
      fast-forwarded into `origin/main` as `0bca8b0`; `CONTRACTS.json` and all four changelogs now name
      that commit. Re-pinning changed no contract byte and no generated type — `0bca8b0` touched one
      line of prose — so the only thing that moved is the provenance, which is the point: one commit
      answers "which knowledge base is this SDK built from", with nothing to reconcile at release time.
- [x] **The pinned contracts were behind, and are now re-pinned.** The new drift reporter found it on
      its first run: the knowledge base had moved past `b428f53` to `82198f7`, where content-service's `importSite`
      operation was lifted out from under the `/export` path onto its own `/api/admin/sites/{id}/import`.
      Admin tier, so no SDK surface changed — but `CONTRACTS.json` claimed `b428f53`, and the four
      changelogs would have shipped 0.1.0 naming a contract the knowledge base no longer held. Both
      services' `source_commit` values are unchanged, so the *services* did not move; only the
      documentation was corrected.
- [x] **Both env-var names the plan called *proposed* are already documented.**
      `CONTENT_SERVICE_PUBLISHABLE_KEY` and `INVOICE_SERVICE_CLIENT_KEY` both appear in the knowledge
      base, so [phase 8 §4](phase-8-release-and-drift.md#4-writing-back-to-the-knowledge-base)'s second
      write-back row needs no PR. Only the "no SDK package" row does.
- [x] **Licence confirmed:** MIT, `Copyright (c) 2026 Lamido`.
