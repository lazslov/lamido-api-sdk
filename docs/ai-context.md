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

## Phase 4 decisions, and where they deviate from the plan

Phase 4 is complete: `@lamido/invoice` ships the six client-tier endpoints plus `/api/health`, the
`IsoDate` type, the outbound checks and the `stornoNumber` split.

- **`InvoiceNotDownloadableError` is an exported subclass**, which the plan's Public API surface block
  does not list. §6 requires the cancelled-invoice case to surface as "a named error", and the two
  alternatives were a subclass or a flag on `InvoiceApiError`. The subclass won: `instanceof` reads
  better at the call site than `error.notDownloadable === true`, and it carries `invoiceStatus`.
  *(Confirmed with the user before implementing.)* It is raised on **both** `/pdf` and
  `/download-link`, because client-api §5 says they share the state requirement.
- **Detection of that error is path-based, not message-based.** A `400 bad_request` on `/pdf` or
  `/download-link` is the only way the service expresses it, and those are the only two endpoints
  with that requirement. `invoiceStatus` *is* lifted out of the message (`"(status: cancelled)"`),
  which is the one place this package reads prose — exposed as a hint, never branched on, and `null`
  when the wording changes. A test asserts `errors.ts` is the only module that reads it.
- **`vatRate` is validated by pattern, not against a closed list.** The docs name `"27"`/`"5"`/
  `"18"`/`"0"` and the codes `"AAM"`/`"TAM"`/`"EU"`, then say "other codes" pass through. An
  allowlist would reject a legitimate rate with no workaround, which is the worse direction to be
  wrong in; the pattern still catches every documented mistake (`"27%"`, `" 27"`, `"27.0"`, `"aam"`,
  a bare number). *(Also confirmed with the user.)*
- **`CancelledInvoice.stornoNumber` is `readonly stornoNumber?: string`, not the plan's
  `readonly stornoNumber: string`.** client-api §6 says the key may be **absent** when the provider
  returned none, and that the cancel still succeeded — so a non-optional `string` would be a type
  that lies. The exit criterion ("type-checks from `cancelInvoice`") is satisfied either way.
- **The request types are hand-written; the response types are aliases.** `openapi-typescript` marks
  a *defaulted* property required, so the generated `CreateInvoiceRequest` demands `paymentMethod`,
  `currency`, `language`, `eInvoice`, `items[].unit` and `partner.address.country` — six values the
  service is happy to choose. Aliasing it would force all six on every caller. `test/type-safety.test.ts`
  asserts a populated `CreateInvoiceInput` still `satisfies` the generated type once those defaults
  are supplied, so a renamed or retyped wire field fails the type-check the way an alias would.
- **`InvoiceList` omits `total` rather than declaring `total?: undefined`.** The plan's §5 wording
  says the latter, but `total?: undefined` makes `.total` legal (of type `undefined`), and the exit
  criterion requires reading it to be a **type error**. Omitting the key is what achieves that, and
  the type is still assignable to core's `Page<T>` for `collectAll`.
- **`listAllInvoices` is a client method taking `pageSize` / `maxPages`.** The exit criterion writes
  it as `listAllInvoices()` with no arguments, which rules out payment's standalone-function shape.
  The two `CollectAllOptions` fields are forwarded because `collectAll` *throws* at its loop breaker
  rather than truncating — without them a tenant with more than 10 000 invoices has no way past it.
- **`getHealth` returns the degraded `503` body instead of throwing**, which phase 4's plan does not
  ask for but phase 3's did. The same endpoint shape, the same trap, and invoice-service's own README
  lists "the `degraded` health body still arrives with a `503` that most clients throw on" under what
  still bites. Same private-error-subclass detour as `@lamido/content`, for the same reason: the
  alternative is a second `fetch` call in the package.
- **`getInvoicePdf` reduces the provider's filename to its last path segment.** The value originates
  at szamlazz or Billingo and ends up in a consumer's own `Content-Disposition` or on disk; a `../`
  in it would be a traversal, and nothing upstream promises it is clean. `filename*=UTF-8''…` is
  preferred over `filename=` when both are present, and the fallback is `invoice-<id>.pdf`.
- **`INVOICE_SERVICE_CLIENT_KEY` is the SDK's proposal.** The knowledge base documents
  `INVOICE_SERVICE_BASE_URL` and leaves the key's variable name to the integrator; this is the name
  the plan proposes and the package reads.
- **A 502 outside a create gets different advice from one on a create.** The new-key rule applies
  only where a key was spent, so a `502` from `cancelInvoice` says the provider was reached and
  refused and that nothing changed here. Advice is attached for `500` and `502` only — the two the
  plan's §8 names — and every other code carries the service's message verbatim.

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

## Phase 6 decisions, and where they deviate from the plan

Phase 6 is complete: `@lamido/content/next` ships the three cache modes, the revalidation handler and
the server-action error shape; `@lamido/payment/next` ships the webhook handler.

- **`next` is a root devDependency, and the subpaths import `next/cache` statically.** The alternative
  considered was injecting `revalidateTag` as a parameter, which would have needed no dependency at
  all — rejected because phase 1 §3 declares the peer, and phase 7's `examples/next-site` needs Next
  installed anyway. *(Confirmed with the user before implementing.)* It sits at the **root** rather
  than in `packages/content`, matching how `@types/node` and `vitest` already reach the packages, so
  the published manifests carry only `dependencies` and `peerDependencies`.
- **`next/cache` needs a `paths` mapping to type-check, and `external` to build.** Next ships no
  `exports` map, so a NodeNext resolver cannot find an extension-less subpath — a Next project's own
  tsconfig uses `moduleResolution: "bundler"`, which can. The root tsconfig maps `next/cache` to
  Next's `cache.d.ts`; `packages/content/tsdown.config.mjs` then has to mark `next` **external**,
  because otherwise rolldown follows the same mapping and emits
  `import … from "next/cache.d.ts"` — which resolves nowhere in a consumer's project. Importing
  `next/cache.js` instead would have avoided both, and was rejected: `next/cache` is the specifier
  every Next codebase writes and the one that survives Next adding an `exports` map later.
- **Only `@lamido/content` declares the peer dependency.** `@lamido/payment/next` imports nothing from
  `next` — its handler takes a `Request` and answers a `Response` — so claiming a peer there would be
  a warning a consumer cannot act on. `test/next-isolation.test.ts` asserts the whole import graph:
  `next` appears only under a `src/next/` directory, only in content, and only as `next/cache`.
- **`revalidateAfterWrite` checks for `updateTag` rather than importing it.** `updateTag` arrived in
  **Next 16** while the declared peer range is `>=14`, so a static named import would make the entire
  subpath unimportable on 14 and 15. The check is `"updateTag" in cache` before the property read —
  `in` is also what the question really is, and a bare read is what trips a test runner's mocked-module
  proxy. The `revalidateTag` fallback passes `"max"`, Next 16's now-required cache-life profile, which
  is an ignored extra argument on the versions that lack it. Confirmed against Next 16.2.12's own
  implementation, which warns on the one-argument form and throws from `updateTag` outside a server
  action — so the plan's "not interchangeable" is enforced by Next, not just documented.
- **Both handlers resolve their secret per request, not at construction.** A route module that threw on
  import would take the whole route tree down, and would stop a site building with an empty
  environment — which phase 7 requires and is how a new contributor runs a client project. An unset
  secret is a `500` on delivery, with the variable named.
- **The payment handler answers `500` itself when `onEvent` throws** rather than re-throwing. The exit
  criterion asks for a `500`; relying on the framework's error boundary would only produce one in
  Next, and this handler is a plain Web handler. `markProcessed` stays unreached either way.
- **`SaveResult.error` is a `ContentErrorCode`, not free prose.** The plan's snippet types it
  `error: string`; a code is assignable to that and strictly more useful, because the sentences belong
  in each site's own voice and language. `NotConfiguredError` is checked separately from
  `ContentApiError` — it is core's class, so an `instanceof ContentApiError` test alone collapsed it to
  `internal_error` and lost the whole point of the `status: 0` sentinel.
- **`asSaveResult` maps only `validation_error` into `fields`.** A publish `conflict`'s
  `details.missing` entries are `"<section>.<field>"` paths across a whole page rather than fields of
  the form just submitted, and each one wants to be a link — so the site reads them off the caught
  error. That is what the exit criterion asks for, and widening it would have been a guess.
- **The gateway declares its own `NextFetchInit`.** Next augments the global `RequestInit` only inside
  a Next project's compilation, and this package is built outside one. The three inits are named locals
  rather than inline literals, which is what keeps assigning them to `defaultInit: RequestInit` legal
  without a cast.
- **The two fixture-project exit criteria are deferred to phase 7**, which already owns
  `examples/next-site` and `examples/node-script` in its §5. *(Confirmed with the user.)* What stands in
  for them meanwhile: `test/next-isolation.test.ts` for the import graph, an end-to-end Vitest case
  driving gateway → signed POST → busted tag against a stubbed `revalidateTag`, and a Node 18 baseline
  case that imports `@lamido/payment/next` from `dist/` and runs it.
- **`sharp: false` in `pnpm-workspace.yaml`.** It arrives with `next` and its native build is dead
  weight here — nothing in this repository runs Next or optimises an image.

## Phase 7 decisions, and where they deviate from the plan

Phase 7 is built but not fully proven — three criteria need a sandbox tenant, a Vercel deployment and a
push. [live-testing.md](live-testing.md) is the operator checklist for the first two.

- **The live suite is written and has never run.** 22 cases, gated on env, skipping *loudly*: the report
  is a `globalSetup` rather than a `beforeAll`, because a `beforeAll` inside a skipped suite never runs
  and Vitest intercepts console output from inside tests — so with no credentials the warning would have
  been exactly as silent as the thing it exists to warn about.
- **`failure()` rather than `.catch(e => e)`.** Every negative case goes through a helper that **throws
  when the call succeeds**. A `.catch` that returns the error compares `undefined` to `undefined` and
  passes on a `200`, which for a suite whose whole job is asserting *which* refusal arrives would be
  worthless.
- **Writes are off by default (`LIVE_ALLOW_WRITES`).** Not because a sandbox key is unsafe — mode is a
  property of the credential and `PAYMENT_PROVIDERS_ALLOW_LIVE` is `false` outside production — but
  because **payment-service's preview and production share one `DATABASE_URL` and one
  `PUBLIC_BASE_URL`.** A payment created from a preview is a real production row. "It looked like a
  sandbox" is not a guard.
- **No live case publishes, and no live case issues an invoice.** A publish makes every unpublished draft
  on that page live; an invoice create is a real document reported to NAV. The content write case reads a
  value and patches it back **unchanged** — and only a *string* value, because an image reads as the
  resolved `{ url, alt, width, height }` and writes as `{ assetId, alt }`, so patching a read image back
  is not a round trip at all. The compiler caught that one.
- **`tryCreateNextContentGateway` was added here, not in phase 6.** Phase 7's "both examples build with an
  empty environment" is unsatisfiable without it: a gateway is idiomatically constructed at *module scope*
  in one `lib/content.ts`, and a Next build imports that module while prerendering — so the strict
  constructor's throw is a failed build, not a degraded page.
- **`examples/node-script` cannot prove "next is not installed".** The first version asserted
  `require("@lamido/content/next")` throws. It does not: pnpm hoists the repository's own `next`
  devDependency to the root and Node's resolution walks up into it, so no project inside this workspace
  can simulate its absence. The assertion now checks the *built artifact* — no main entry's shipped CJS
  contains a `require("next…")` — which is the thing that actually matters to an Astro consumer. The real
  isolation proof is phase 8's `pnpm add` smoke, outside the monorepo.
- **`pnpm deps:audit` must exclude declared peers, and must run from the root with `--filter`.** Two
  findings, both non-obvious: an unfiltered `pnpm list` inside a workspace package reports the *whole
  workspace*, and `pnpm list --prod` **does** report a resolved peer — `next` is satisfied by the root
  devDependency, which dragged fifty packages of Next's tree into `@lamido/content`'s graph. An optional
  peer is by definition the consumer's choice, so it and its subtree are skipped by name.
- **The static-route check reads `prerender-manifest.json`, not the build's console output.** The manifest
  is the build's own record of what it prerendered. Grepping `○ (Static)` out of stdout would break on any
  reporter change, on a route whose name wraps, and on a colour setting.
- **Two new tarball rules:** an OpenAPI document matched **by name wherever it sits** rather than only
  under `contracts/`, and a `tsconfig`. Neither has any business shipping, and a rule that depends on
  which directory someone copied a file into is not a rule.
- **The doc-example fixtures check *key sets*, not value types, and the key lists are compiler-verified.**
  "Does this JSON parse into that type?" is a question about a compile-time type and a runtime value, and
  a `json as Invoice` cast answers it by fiat. The mechanism that makes it real is a mapped type plus
  `satisfies`: a hand-written key list annotated `satisfies AllKeys<Invoice>` is checked in both
  directions by `tsc` — a missing key makes it unassignable, an extra key trips the excess-property
  check — and is *also* an ordinary object a test can iterate. Writing the first drafts by hand and
  letting the compiler reject them is how every list here was arrived at. Value types are deliberately
  not checked: a runtime check deep enough to mean anything would be a second hand-maintained copy of
  every type, and it would be the copy that drifted.
- **Every extracted example must be *claimed*.** By a type, or by an explicit out-of-scope reason —
  admin tier, an elided snippet, a structure definition only staff can write. Without that rule the
  suite reports green over examples nobody has looked at, which is worse than an open checkbox. A new
  example upstream now fails until someone classifies it.
- **Elided examples are dropped at extraction.** The docs abbreviate long objects with a literal ellipsis
  key — `"…": "all other Invoice fields"` — which is unhelpfully **valid JSON**. It parses, and checking
  it would fail on every field the author left out, permanently. That is a documentation choice, not a
  contract change. Seven were dropped, including the only `CancelledInvoice` example upstream has.
- **The extractor rewrites every host the leak guard would reject, not a named list.** Running it the
  first way turned up a **real client's domain** in the documents' examples, plus a PSP sandbox host and
  a Vercel Blob host. None is a secret, but a tenant's identity is not ours to commit and this repository
  is bound for a public remote. `isAllowedHost` is imported from the guard rather than restated: two
  copies would drift, and the one that drifted would be the sanitiser, which fails **open**.
- **`test/fixtures/doc-examples/` was added to the leak guard's scan roots.** It only scanned `packages/`
  and `contracts/` before. The rest of `test/` stays out, because several suites there quote the
  forbidden patterns deliberately — as the data proving the guard still matches them.

## Phase 8 decisions, and where they deviate from the plan

Phase 8's machinery is built. Nothing is published: the four criteria that need an npm account, a
token or a registry round trip cannot be met from here.

- **The `@lamido` scope is a user account, not an organisation.** The plan's first exit criterion says
  "the `@lamido` npm organisation must exist and own the scope before the first publish". The registry
  says something already owns it: `/-/org/lamido/user` answers `{"lamido":"owner"}` — the shape a *user*
  scope returns, where an organisation (`vercel`, `okeoke`) returns `{}` and an unclaimed name 404s —
  with zero packages published. Whether that account is ours is not answerable from this machine: the
  local npm token is a legacy read-limited one that 403s even on `okeoke`, an organisation the account
  demonstrably belongs to. So the criterion is not "create an organisation" but "confirm who owns the
  scope", and it is the first item of `CONTRIBUTING.md`'s pre-publish checklist. If the answer is *not
  ours*, four packages need renaming — cheap now, expensive after a publish.
- **CI had never been green, for a reason unrelated to any phase.** `pnpm@11.18.0` refuses to run below
  Node 22.13, and the workflow pinned Node 20 — so `actions/setup-node`'s `cache: pnpm` step crashed on
  every run since phase 3, ~25 seconds in, before a single script executed. Both pnpm jobs are now on
  Node 22 and the root `engines` says `>=22.13`. The **packages** still declare `>=18.17`, and the
  runtime-baseline matrix still proves 18.17/20/22 against `dist/` — that job runs `node --test`
  directly and never touches pnpm, which is why it was unaffected and why it stays as it is.
- **`updateInternalDependencies: "minor"`, not the default `"patch"`.** With `"patch"`, a patch to
  `@lamido/api-core` re-releases all three service packages — which is exactly the coordination the
  plan says publishing core separately exists to avoid. With `"minor"`, a core patch ships alone and
  reaches consumers through the `^` range; a core **minor** still bumps the three, because `^0.1.0`
  does not admit `0.2.0` in 0.x semver.
- **`CHANGELOG.md` ships inside the tarball**, so `"files"` and the tarball audit's expectation both
  grew a fourth entry. The plan's stated goal — a consumer can answer "which version of the contract
  does my installed SDK believe in?" without reading the SDK's git history — is only true if the file
  is in `node_modules`. *(Confirmed with the user before widening the allowlist.)*
- **The provenance line is enforced, not documented.** `changeset version` prepends a bare `## x.y.z`
  heading, so `test/changelog-provenance.test.ts` fails until a human adds the line naming the
  knowledge-base commit and the three `source_commit` values — read from `CONTRACTS.json` rather than
  restated, because the restated copy is the one that would drift.
- **The release workflow is asserted by a unit test.** `test/release-workflow.test.ts` checks the
  ordering (gate → live suite → publish), the absence of `workflow_dispatch` and of any `inputs.`
  reference, `id-token: write`, `cancel-in-progress: false`, and that `release:publish` carries
  `--provenance` and `--access public`. Same reasoning as `test/audit-detects.test.ts`: a pipeline's
  failure mode is that it quietly stops guarding and keeps reporting green, and every mistake it
  prevents is permanent once a tarball is on npm. The assertions read the file's **text** with comment
  lines stripped — the comments name the very things that must be absent, so checking raw text would
  make each explanation a false positive, and the fix for that would be deleting the explanation.
- **`LIVE_REQUIRE_CONFIGURED` was added to the live suite for the release to use.** The suite skips
  loudly when unconfigured, which is right for a developer and wrong for a gate: a release with a
  missing secret would skip every case and hand back the same green as a full pass. With the variable
  set, an unconfigured service throws from `globalSetup`. The release also leaves `LIVE_ALLOW_WRITES`
  unset, and the test asserts the string does not appear in the workflow at all.
- **The drift reporter needed a real YAML parser**, so `yaml` is a new devDependency — dev-only, never
  packed, and the audit enforces that. The alternative was an indentation-scanner over the pinned
  documents, which is a YAML parser with a shorter test suite. What it buys is the difference between
  "the contract differs" and "`POST /api/admin/sites/{id}/import` was added" — and an issue that says
  only the former gets closed unread.
- **The detector found real drift on its first run, and the contracts were re-pinned.** The knowledge
  base had moved from `b428f53` to `82198f7`, where content-service's `importSite` was lifted out from
  under the `/export` path onto its own. Admin tier, so no SDK surface changed, and all three
  `source_commit` values were unchanged — the services had not moved, only the documentation was
  corrected. Re-pinning was the right call rather than filing it: shipping `0.1.0` with a changelog
  naming a knowledge-base commit that no longer holds the contract is the precise failure the
  provenance line exists to prevent. The pin has since moved once more, to `0bca8b0` — the merged
  write-back below — which changed no contract byte and no generated type. That second re-pin was
  optional and taken deliberately: `kbCommit` names the commit a copy came *from*, so `82198f7` would
  have stayed true, but leaving the SDK one commit behind the knowledge base means every later reader
  has to work out whether the gap matters. One number is cheaper than that question.
- **The knowledge-base write-back is one row, not three.** [phase 8 §4](plans/phase-8-release-and-drift.md#4-writing-back-to-the-knowledge-base)
  asks for the "no SDK package" row "and the equivalent lines in the other two folders" — there are
  none; invoice-service and payment-service never claimed to ship a client, and payment's only SDK
  mentions are about Stripe's. Its second row is already satisfied too: both env-var names the plan
  marked *proposed* (`CONTENT_SERVICE_PUBLISHABLE_KEY`, `INVOICE_SERVICE_CLIENT_KEY`) are already in
  the knowledge base. The row names the **repository**, not an npm package, because nothing is
  published yet — the commit message says so, and flags the second pass.

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

- **Who owns the `@lamido` npm scope.** See the phase 8 note above. Everything else about publishing is
  ready; this is the one answer that could still require renaming four packages.
- **CI has never produced a green run**, and until the next push it never executed a gate at all — see
  the phase 8 note. Every gate has been verified locally instead. The `next` devDependency also makes a
  clean install ~150 MB heavier, which is worth knowing before the first real CI run.
- **A real client's domain appears in the knowledge base's own examples** — found by the leak guard once
  the doc-example fixtures brought those documents into scope. The SDK's extractor rewrites it, so nothing
  leaks from here, but the *knowledge base* still carries it. That is a fix for that repository, through
  its own PR flow, and it is not this repository's to make.

## Settled since

- **The knowledge-base clone is current.** `../knowledge-base` is at `b428f53` — `origin/main`, and the
  commit `contracts/CONTRACTS.json` pins — with `content-service/`, `invoice-service/` and
  `payment-service/` all present in the working tree. The earlier note about a local `main` at `184f7a0`
  is stale; phases 4, 6 and 7 read their reference docs straight from the working tree.
- **All three services are cloned on this machine** as siblings — `../content-service`,
  `../invoice-service`, `../payment-service` — which is what makes the live suite runnable against
  `localhost` rather than needing anything deployed. `../devora` is a candidate consumer site, currently
  with no service integration wired up.
