# Lamido API SDK — build plan

A consumer-side TypeScript SDK for the three services documented in this repository,
published to npm and installed into client-website projects.

**Audience of the SDK:** a website being built for a client, and the editor UI that ships
with it. Not operator tooling.

**Status:** all eight phases built; nothing published. Live checklist: [PROGRESS.md](PROGRESS.md).

---

## The decision: four packages, one repository

The brief asked whether this should be one package or one per service. **One monorepo,
four published packages.**

```
lazslov/lamido-api-sdk             (new repo — pnpm workspace)
├── packages/api-core   → @lazslov/api-core    transport, errors, HMAC, paging
├── packages/content    → @lazslov/content     website + client tiers
├── packages/invoice    → @lazslov/invoice     client tier
├── packages/payment    → @lazslov/payment     merchant tier
└── packages/telemetry  → @lazslov/telemetry   added later — see below
```

Each service package depends on `@lazslov/api-core` and on **nothing else**. Core depends on
nothing. See [phase-1](phase-1-foundations.md) for the dependency policy.

> **A fifth package joined after this decision, and it is not a consumer SDK.**
> `@lazslov/telemetry` is the estate's shared log envelope, sink, alert channel and request
> middleware — consumed by the **services**, not by a client site, and depending on none of the
> four above. It lives here because it ships from the same release, under the same provenance and
> the same gates, not because it belongs to the same dependency graph. The reasoning below is
> about the four consumer packages; it applies to telemetry only where it happens to.

### Why not one package

The three services do not share a contract. Reading
[content-service/conventions.md](../content-service/conventions.md),
[invoice-service/conventions.md](../invoice-service/conventions.md) and
[payment-service/conventions.md](../payment-service/conventions.md) side by side:

| | content | invoice | payment |
|---|---|---|---|
| Success envelope | `{data}` + siblings | `{data}` + siblings, **3 exceptions** | RFC 7807; success is the bare resource |
| Branch on | `error.code` | `error.code` | `problem.type` |
| Money | — | JSON **number**, **major** units | decimal **string**, minor units, **HUF is zero-decimal** |
| Pagination | `limit`/`offset` | `limit`/`offset`; some lists omit `total`, and the unpaginated ones omit `limit`/`offset` entirely | merchant tier: **none**; admin tier: keyset cursor |
| Idempotency | none | required on 1 endpoint, **key consumed even on failure** | required on 2 endpoints, TTL 7d/24h, body-hashed |
| Browser tripwire | **none** — and the docs explicitly warn not to copy invoice's workaround here | admin tier only | **every** surface |
| Browser-safe tier | yes (`cpk_`) | no | no |

A single package would have to present these as one family, and the resemblance would be a
lie. Four concrete reasons to split:

1. **Bundle safety is a packaging problem.** content-service has a genuinely browser-safe
   tier (`cpk_`); payment-service must never reach a browser bundle at all. Separate
   packages make that boundary visible in `package.json` and in code review. A single
   barrel entry point invites `import { payments } from "@lazslov/sdk"` inside a React
   client component, which is exactly how a full-tenant key ships to every visitor.
2. **The install set should match the need.** Most client sites need content only. The
   content OpenAPI document alone is 4,542 lines; emitting all three services' types into
   every project is a cost paid by every site for code it never calls.
3. **Drift is per service.** Each doc folder carries its own `source_commit`
   (content `d7b5c46`, invoice `f5af0dc`, payment `586eede`). Independent versioning means
   a payment contract change does not produce a version bump that content consumers have to
   read a changelog to dismiss.
4. **Vocabulary should mirror the service.** `@lazslov/payment` should say `problem.type`
   and `amount_minor`; `@lazslov/content` should say `error.code` and `values`. Forcing one
   naming scheme over both means every user translates twice.

### Why core is a published package rather than inlined

Bundling core into each service package would make each one standalone, at the cost of
three copies of the **HMAC signature verifier**. That code is security-sensitive and is the
one thing that must exist in exactly one place: a fix to it should be
`pnpm update @lazslov/api-core`, not three coordinated releases plus every consumer noticing
they need all three.

The trade is one dependency edge per package. That is the whole dependency graph.

### Why a monorepo rather than four repos

One CI configuration, one release pipeline, one lint/test/build setup, and cross-package
changes land as one reviewable PR. Four repos buys independence that four packages already
provide.

---

## Cross-cutting invariants

These hold in every phase. They are the rules that make this package publishable.

### Nothing about the deployment ships in the package

> **RULE — no host, no key, no tenant identifier appears anywhere in a published tarball.**
> Not in code, not in a default, not in a test fixture, not in a README example, not in a
> generated `.d.ts`, not in an OpenAPI `servers:` block copied from this repo.

Every base URL is supplied by the consuming project from its own environment. There is **no
fallback host** — a missing base URL is a configuration error the SDK reports, never a
silent default. This mirrors the rule each service's own docs already state
([content](../content-service/conventions.md#1-base-url),
[invoice](../invoice-service/conventions.md#1-base-url)).

Examples in documentation use `https://content.example.com` and `csk_YOUR_SECRET_KEY`.
Enforcement is a CI job that greps the packed tarball — see
[phase-7](phase-7-verification.md#3-leak-audit).

### Environment variables the consumer sets

Names marked **documented** already appear in this knowledge base and must not be renamed.
Names marked *proposed* are new and get written back into the relevant doc folder as part of
[phase-8](phase-8-release-and-drift.md).

| Variable | Package | Source |
|---|---|---|
| `CONTENT_SERVICE_BASE_URL` | content | **documented** ([conventions §1](../content-service/conventions.md#1-base-url)) |
| `CONTENT_SERVICE_SECRET_KEY` | content | **documented** ([site-integration §2](../content-service/site-integration.md#2-one-gateway-file-three-cache-modes)) |
| `CONTENT_REVALIDATE_SECRET` | content | **documented** ([website-api](../content-service/website-api.md#the-revalidation-webhook)) |
| `CONTENT_SERVICE_PUBLISHABLE_KEY` | content | *proposed* — the `cpk_` tier, browser-safe |
| `INVOICE_SERVICE_BASE_URL` | invoice | **documented** ([conventions §1](../invoice-service/conventions.md#1-base-url)) |
| `INVOICE_SERVICE_CLIENT_KEY` | invoice | *proposed* |
| `PAYMENT_SERVICE_URL` | payment | **documented** ([merchant-api](../payment-service/merchant-api.md#what-the-operator-gives-you)) — note: `_URL`, not `_BASE_URL`, unlike the other two |
| `PAYMENT_SERVICE_KEY` | payment | **documented** (same) |
| `PAYMENT_SERVICE_WEBHOOK_SECRET` | payment | **documented** ([merchant-api](../payment-service/merchant-api.md#nextjs-route-handler)) |

The SDK never reads these itself by hard-coded name in core. Each service package declares
its own names in one place, and a consumer may override them — so a site talking to two
tenants can construct two clients.

### Dependencies

**Zero runtime dependencies**, except `@lazslov/api-core` in each service package.

Everything needed is a platform API: `fetch`, `AbortController`, `URL`,
`globalThis.crypto.subtle`. Node 20.19+ or any modern edge runtime. Type generation, building,
testing and linting are devDependencies and never reach a consumer.

Full policy and the rationale for each tool choice: [phase-1](phase-1-foundations.md).

### The SDK does not invent behaviour

Where a service's documentation states a rule, the SDK **encodes** it and cites it. Where
the documentation says a thing is deliberately absent, the SDK does not add it. Three
consequences worth stating up front, because each is a thing an SDK author would otherwise
add by reflex:

- **No automatic retries.** [site-integration §2](../content-service/site-integration.md#2-one-gateway-file-three-cache-modes)
  records that the reference integration omitted retries on purpose: a failed read degrades
  to a placeholder, a failed write reports to a human. Retrying a write needs idempotency
  that the content endpoints do not have.
- **No generated idempotency keys.** payment-service says *"derive it from the operation,
  not from the clock"*, and a fresh UUID per retry is precisely how a double charge happens.
  The key is a required parameter. The SDK will not make one up.
- **No default timeout.** Also deliberately absent upstream. An `AbortSignal` is accepted
  and passed through, so a consumer who wants one has one.

### Markdown is behaviour, OpenAPI is shapes

Per [this repo's own rule](../README.md#how-to-use-this-repo-agents): request/response
**types** are generated from each `openapi.yaml`; **semantics** — what a 404 means, when a
retry is safe, what `null` means — are hand-written from the Markdown. When the two
disagree the Markdown wins and the YAML is a bug.

---

## Phases

Each file is self-contained and states its own dependencies and exit criteria.

| # | Phase | Depends on | Ships |
|---|---|---|---|
| 1 | [Foundations](phase-1-foundations.md) | — | repo, workspace, build, type generation, guardrails |
| 2 | [`@lazslov/api-core`](phase-2-api-core.md) | 1 | transport, error base, config, HMAC verifier, paginator |
| 3 | [`@lazslov/content`](phase-3-content.md) | 2 | website + client tiers, field descriptors, assets |
| 4 | [`@lazslov/invoice`](phase-4-invoice.md) | 2 | client tier, idempotency, PDF paths |
| 5 | [`@lazslov/payment`](phase-5-payment.md) | 2 | merchant tier, money type, 502 triage, webhooks |
| 6 | [Framework adapters](phase-6-next-adapters.md) | 3, 5 | `…/next` subpaths: cache modes, route handlers |
| 7 | [Verification](phase-7-verification.md) | 2–6 | live-tenant contract tests, HMAC fixtures, leak audit |
| 8 | [Release & drift](phase-8-release-and-drift.md) | 7 | versioning, publishing, the drift protocol |

Phases 3, 4 and 5 are independent of each other and can be built in any order or in
parallel. Phase 6 needs 3 and 5 (invoice has no webhook and no cache story —
[it never calls you](../invoice-service/conventions.md#10-what-this-service-does-not-do)).

**Suggested first cut:** phases 1, 2, 3 and 6, published as `0.1.0`. That is the package you
would actually install on the next client site. Invoice and payment follow once a project
needs them.

---

## What is deliberately out of scope for v1

| Excluded | Why, and what happens instead |
|---|---|
| Admin tiers (`cad_`, `iad_`, `pad_`) | ~100+ operations for operator tooling, not for a client website. A public package should not carry the operator API surface. Revisit as private siblings if `lamido-admin` ever wants them. |
| A CLI | The services already have their own CLIs; see each `operations.md`. |
| Caching, memoisation or a request cache inside the SDK | The framework owns caching. Core takes a pass-through options bag so `next: { tags }` works, and phase 6 ships the three modes as helpers. |
| Retries, circuit breakers, backoff | See above — deliberately absent upstream. |
| A React component library | The field-descriptor layer (phase 3) is types and validation only; rendering stays in each site. |
| Anything that stores a secret | The SDK holds a key in memory for the lifetime of a client object and puts it in one header. It never writes it anywhere. |
