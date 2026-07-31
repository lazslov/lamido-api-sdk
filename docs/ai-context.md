# AI context

Durable project context that is not obvious from the code or the git history. The build plan
itself lives in [plans/](plans/) — this file records decisions and facts that sit *outside*
it.

## Where things are

- **The knowledge base is a separate repository**, expected at `../knowledge-base` (override
  with `LAMIDO_KB_PATH`, or pass a path to `pnpm contracts:import` / `pnpm contracts:drift`).
  It is deliberately not a submodule. Contracts are pinned copies under `contracts/`, with
  provenance in `contracts/CONTRACTS.json`.
- The service *behaviour* — what a 404 means, when a retry is safe, what an omitted field
  means — lives only in that repository's Markdown. `contracts/*.openapi.yaml` is the
  authority on shapes. When the two disagree, the Markdown wins and the YAML is a bug.

## Phase 1 decisions, and where they deviate from the plan

Phase 1 is complete. Everything below was decided while implementing it and is not recorded
in `plans/phase-1-foundations.md`.

- **Sanitisation is broader than "strip `servers:`".** The plan's rule covers the `servers`
  block; the invariant it serves ("no host in a tarball") covers the whole document, so
  `scripts/lib/sanitize-contract.ts` also rewrites the deployment domain wherever else it
  appears, and normalises upstream's fictional `acme.hu` merchant domain to
  `acme.example.com`. Import and drift-check share one sanitiser, so drift reports contract
  changes rather than host-template noise.
- **The tenant-slug deny list is not committed.** A real client's slug in a tracked deny list
  would itself leak the tenant identity the rule protects, so slugs come from an untracked
  `.leakguard-slugs` file or `LEAKGUARD_TENANT_SLUGS`.
- **The tarball audit checks a fixed expectation, not the manifest's own `"files"`.**
  Comparing a tarball to the field npm packed it *from* can never fail. `requiredFilesField`
  and `expectedEntries` in `scripts/lib/tarball-rules.ts` are the expectation; widening what
  ships means editing them, which is a reviewable diff.
- **Subpath exports arrive with the phase that builds them.** The plan's §3 example shows
  `./fields` and `./next` on `@lamido/content`; declaring them before the files exist would
  fail `publint` and `attw`, so each package ships only `.` for now.
- **`exports` names types per condition** (`import.types` / `require.types`) rather than one
  shared `types` key, plus top-level `main`/`types` for the legacy resolver. This is what
  makes `attw` clean on all four resolution modes, which the plan's own exit criteria require.
- **No sourcemaps in published tarballs.** They embed original source text and are the
  likeliest leak vector. The audit still scans any `.map` it finds.
- **Build runs `tsdown --config-loader tsx`.** The shared options in `tsdown.base.ts` are
  imported through a NodeNext `.js` specifier, which tsdown's default native config loader
  cannot resolve.
- **TypeScript is pinned to 5.9, not 7.** Declaration emit for four published packages is not
  the place to be first onto the native rewrite. Revisit once `rolldown-plugin-dts` states
  support.
- **Dev tooling beyond the plan's list:** `tsx` (runs the `.ts` scripts on Node 20, which has
  no native type stripping) and `@types/node`. Both are dev-only and never packed.
- **`biome.jsonc`, not `biome.json`** — Biome will not parse comments in a `.json` config, and
  the ignore entries need their reasons stated.

## Phase 2 decisions, and where they deviate from the plan

Phase 2 is complete: `@lamido/api-core` exports the eight primitives its plan lists.

- **`ServiceConfig` fields are all optional.** The plan's snippet shows `baseUrl` and `apiKey`
  as required, but the same section calls `createContentClient(config?)` with no argument, which
  only works if a partial config can fall back to the environment. Explicit values still win.
- **`ReadMode` is `{ kind; withMeta? }`, not a five-member union.** Same semantics, and the
  plan's own text says every mode accepts `withMeta`, which a union would have to repeat.
- **`request` is overloaded on `withMeta`** so the return type narrows to `ResponseMeta<T>`
  without a cast at the call site.
- **`resolveConfig` throws; there is no `tryResolveConfig`.** The plan lists one core helper, so
  each package's `tryCreate…` catches `NotConfiguredError` and returns `null`.
- **`assertServerOnly` takes an optional `envVar`.** The plan's rationale requires the message to
  name the variable to move, which its two-option signature could not do.
- **`details` on `LamidoApiError` is a `declare` field.** A plain optional class field emits
  `details = undefined` under ES2022 semantics, making `"details" in error` true on every error;
  absence is the honest signal that the service sent no detail.
- **Node 18 is verified by `node:test`, not Vitest.** Vitest 4 requires Node ^20.19 || >=22.12,
  so it cannot run on the 18.17 floor the packages declare. `packages/*/test/node-baseline.mjs`
  runs against `dist/` on 18.17, 20 and 22 in a CI matrix job — which also means what is checked
  there is the artifact a consumer installs, not the source.
- **The HMAC fixtures were generated with `node:crypto`**, deliberately a different
  implementation from the `crypto.subtle` one under test. `test/fixtures/hmac/generate.mjs`
  regenerates them; the committed JSON is the pinned artifact.
- **Core is 430 lines of code plus 404 of TSDoc.** The plan's 600–800 guide is about
  service-specific behaviour leaking in; `test/public-surface.test.ts` asserts none has, and the
  overage is the doc-comment density CLAUDE.md requires.
- **`lib` now includes `DOM.Iterable`**, for `Headers.entries()` when merging request headers.

## Phase 3 decisions, and where they deviate from the plan

Phase 3 is complete: `@lamido/content` ships both consumer tiers, the field-descriptor layer on a
`./fields` subpath, and the revalidation verifier.

- **`FieldType` has all seven types the service has, not the plan's five.** The plan ports the type
  model from `site-integration §3` verbatim, where it is `text | richtext | url | image | list` —
  one site's subset. The service's contract has `number` and `boolean` too, and because
  `prepareValues` iterates the *descriptor*, a type the table cannot express is a field that can
  never be saved. Same reasoning extends `ListEntryDescriptor.type` to every type except `list`,
  which is exactly what the service's item schema accepts. *(Confirmed with the user before
  implementing.)*
- **`prepareValues` parses the string forms of `number` and `boolean`.** `"1500"` and `"true"`
  become `1500` and `true`; anything else is a per-field error. A `FormData` submission has no
  other shape to offer, and the strict patterns mean `""` is an error rather than a silent `0`.
- **`reorderItems` takes the complete set as a required argument.** Its exit criterion — throws
  locally on an incomplete array, before any request — is unsatisfiable otherwise: the SDK cannot
  know what "complete" means without either being told or making the round trip the check exists to
  save. The caller passes the list it just rendered from. *(Also confirmed with the user.)*
- **`getCollectionItem` exists, though the plan's §2 table omits it.** The exit criterion asks for
  *every* website-tier endpoint, and `GET /api/content/collections/:key/items/:idOrSlug` is one of
  the six the tier documents.
- **Only a documented `404` becomes `null`.** `getPage`, `getCollection`, `getCollectionItem`,
  `getRecord` and the *website* aggregate answer `null`; every client-tier read of a page, an item
  or a dataset aggregate throws, because there a `404` means a wrong slug or key rather than absent
  content. The plan's sentence about the aggregate returning `null` "when the read failed" is
  deliberately not implemented — swallowing a `500` would hide an outage, and the plan's own rule
  says a `404` maps to `null` only where the documentation calls it normal.
- **An `image` key in a submission always counts as a change.** A read document carries the
  resolved `{ url, alt, width, height }` and never the `assetId`, so equality cannot be proven.
  Documented on `prepareValues`, with the service's own advice: give an image its own save action.
- **A never-set field submitted as `""` is not a change.** Otherwise opening a form and pressing
  Save would write a blank draft for every field nobody has ever filled in — and arm a publish
  across the whole page, which is the exact accident the empty-diff rule exists to prevent.
- **`getHealth` smuggles a `503` back through the transport's error path.** A private error
  subclass carries the degraded body and is caught immediately. The alternative was a second
  `fetch` call in the package — a second place the credential is attached — which is a worse trade
  than the detour.
- **`buildQuery` in `@lamido/api-core` now serialises an array as a repeated parameter.** Needed by
  content-service's `eq` filter (`?eq=a:1&eq=b:2`, at most three), and phase 2 had no shape for it.
  Backwards compatible; `metrics` stays comma-joined because that is what the service wants.
- **`parseContentError` is typed as returning `ContentApiError`, not core's `ErrorParser`.** It
  still satisfies that type where it is used, and a caller reading `details.unknownKeys` at the one
  place the shape is known should not need a cast.
- **Client methods are flat, not namespaced.** `content.getPage("home")`, not
  `content.pages.get("home")` — the plan names every method that way. Two examples in `api-core`'s
  doc comments used the namespaced form and were corrected.
- **`typesVersions` maps the `./fields` subpath.** A pre-`exports` TypeScript resolution reads
  nothing else, so without it `attw`'s node10 column reports the subpath as resolving to no types.
  A cross-package test in `test/package-shape.test.ts` now requires a mapping for every declared
  subpath.

## Phase 5 decisions, and where they deviate from the plan

Phase 5 is complete: `@lamido/payment` ships the seven merchant endpoints, the money type, RFC 7807
triage, the webhook verifier and the reconciliation helper.

- **`isFulfillable` is `succeeded` only.** The plan says "true only for statuses where money has
  actually moved", which could be read to include `partially_refunded`. It is not: merchant-api.md's
  own table marks `succeeded` as the single "fulfil? yes", and fulfilment is a decision made once,
  when the payment first succeeded. Asking the predicate again after money has come back is asking
  the wrong question, and the conservative answer is the right one where money is involved.
- **`reconcilePayments` returns a report, not `void`.** The plan's signature is `Promise<void>`, but
  its own exit criterion requires the helper to *surface* a `429`'s `retry_after` — which a `void`
  return cannot do, and swallowing it is how a reconciler turns into a poller. It also takes the
  client as its first argument, since the plan exports it as a standalone function rather than as a
  client method, and a standalone function has no other way to reach `getPayment`.
- **One error per id, not one thrown error per sweep.** A failed read or a thrown `onStatus` is
  recorded in that id's result and the sweep continues. One unreachable payment abandoning a
  reconciliation run would leave every later order unreconciled for the whole interval.
- **The `code` extension member is exposed as `conflictCode`.** Core's `LamidoApiError` already has
  `code` (the stable machine value, here the problem type URN). Two fields called `code` on one error
  would be a trap in exactly the place where money is involved.
- **`detail` is read in two places, not one.** The plan names the 502 triage as the single deliberate
  exception to "branch on `type`, never on `detail`". Telling an in-flight 409 from a key reused with
  a different body needs the same treatment, and the plan's own §6 requires it — the naive reading of
  a 409 is "use a new key", which here is a second payment. Both readers match a short stable
  substring and both fail **closed**: a miss means not retryable. A test asserts that only those two
  modules read `detail` at all.
- **No `/healthz`.** The plan lists seven endpoints and no health check, so the client has none.
  content-service's `getHealth` exists because its plan asks for it; monitoring this service is an
  operator's job against an unauthenticated route.
- **The webhook fixtures are generated, not copied from the service repo.** The plan asks for "the
  same fixtures the service repo pins its signer against". That repository is not available here, so
  `test/fixtures/webhook/generate.mjs` reproduces the algorithm merchant-api.md publishes — with
  `node:crypto`, deliberately a different implementation from the `crypto.subtle` one under test —
  including a non-ASCII body and the whsec-prefix-stripped case. Pinning against the service's own
  file is phase 7 work.
- **Type-level assertions live in `test/type-safety.test.ts` as `@ts-expect-error`.** `pnpm
  typecheck` is what runs them: an unnecessary directive is itself an error, so a rule that stops
  being enforced fails the build. Note that the directive applies to the **following line**, so
  those calls are kept short enough that the formatter cannot wrap them out from under it.

## Build tooling: the tsdown configs are `.mjs`

Phase 1 chose `tsdown --config-loader tsx` because tsdown's native loader cannot resolve
`../../tsdown.base.js` — the specifier NodeNext requires for a `.ts` file. **That loader breaks on
Node 24**: tsx's CJS hook fails to read `node:fs?tsx-namespace=…`, so `pnpm build` died before
compiling anything.

`tsdown.base.ts` and the four `tsdown.config.ts` files are therefore now `.mjs`, and the build
scripts are plain `tsdown`. Both files are loadable by Node itself on **every** version that builds
this repository, which a `.ts` config is not: it needs either Node's own type stripping (22.18+, so
not the Node 20 CI runs on) or a loader hook. The `@type` JSDoc on `sharedOptions` keeps the editor
hover; nothing else is lost, because a wrong option fails the build immediately. They are out of
`tsconfig.json`'s `include` as a result.

Two related workspace-resolution notes, both needed the moment a service package imported
`@lamido/api-core`:

- **`tsconfig.json` maps `@lamido/api-core` to its source** so `pnpm typecheck` runs from a clean
  clone. Deliberately *not* in each package's own `tsconfig.json`: tsdown reads those, and it must
  resolve core the way a consumer does, or the emitted `.d.ts` would inline a copy of core's types
  instead of importing them. Verified — `packages/content/dist/index.d.ts` imports from
  `"@lamido/api-core"`.
- **`vitest.config.ts` aliases the same specifier** to core's source, so the suites run without a
  build. `test:node-baseline` is the one that exercises `dist/`.

## Settled

- **Licence: MIT, `Copyright (c) 2026 Lamido`.** Confirmed 2026-07-30. Applies to all four
  packages; the same `LICENSE` file sits at the root and in each package.

## Open questions

- **The local knowledge-base clone is behind its own remote.** The YAML-scalar fix that phase 1
  needed is merged — `origin/main` is `b428f53`, the commit `contracts/CONTRACTS.json` pins — but the
  clone's local `main` sits at `184f7a0`, which predates `content-service/` existing in the
  repository at all. Phase 3 read its reference docs out of `origin/main` with `git show`. **Run
  `git pull` in `../knowledge-base` before `pnpm contracts:import` or `pnpm contracts:drift`**, or
  either will look at a tree with no content-service in it.
