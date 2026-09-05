# lamido-api-sdk

[![CI](https://github.com/lazslov/lamido-api-sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lazslov/lamido-api-sdk/actions/workflows/ci.yml?query=branch%3Amain)

A consumer-side TypeScript SDK for the seven services documented in the `knowledge-base`
repository, published to npm as nine packages and installed into client-website projects.

| Package | Version | What it is |
|---|---|---|
| `@lazslov/api-core` | `2.0.0` | transport, errors, HMAC verification, paging — shared, depends on nothing |
| `@lazslov/auth` | `1.0.0` | auth-service: browser sign-in, the authorization decision, entitlements, customers |
| `@lazslov/booking` | `1.0.0` | booking-service: availability, holds, the booking lifecycle |
| `@lazslov/content` | `2.0.1` | content-service: pages, sections, collections, datasets, assets |
| `@lazslov/email` | `1.0.0` | email-service: template-only transactional mail |
| `@lazslov/invoice` | `2.0.1` | invoice-service: Hungarian invoicing |
| `@lazslov/payment` | `1.0.2` | payment-service: Stripe and Barion behind one merchant API |
| `@lazslov/webshop` | `1.0.0` | webshop-service: the public catalog, carts, checkout, orders |
| `@lazslov/telemetry` | `1.1.3` | the estate's log envelope, batched sink, alert channel and request middleware |

Every service package ships only its **consumer** tiers — the browser-safe publishable key where
the service has one, and the server-only secret key — never the operator tier. Each one that
receives webhooks ships a verifier and a `Request → Response` route handler on its `./next` subpath.

| Package | Browser tier | Server tier |
|---|---|---|
| `@lazslov/auth` | `createAuthPublicClient` (`apk_`) | `createAuthClient` (`ask_`) |
| `@lazslov/booking` | `createBookingPublicClient` (`bpk_`) | `createBookingClient` (`bsk_`) |
| `@lazslov/content` | `createWebsiteClient` (`cpk_`) | `createContentClient` (`csk_`) |
| `@lazslov/email` | — | `createEmailClient` (`esk_`) |
| `@lazslov/invoice` | — | `createInvoiceClient` (`isk_`) |
| `@lazslov/payment` | — | `createPaymentClient` (`pmk_`) |
| `@lazslov/webshop` | `createWebshopPublicClient` (`wpk_`) | `createWebshopClient` (`wsk_`) |

Every constructor has a `tryCreate…` twin that answers `null` when nothing is configured, so a
project boots and renders with an empty environment.

`@lazslov/telemetry` is the odd one out: it is consumed by the **services**, not by a client site,
and it depends on the other packages not at all. It lives here because it is published from the same
release, under the same provenance.

The build plan, and the reasoning behind several packages rather than one, is in
[docs/plans/](docs/plans/). Phases 1–8 built the first three service packages and published them;
phase 9 added the other four, one plan document per package. `@lazslov/api-core` carries the
transport, error base, configuration, HMAC verifier, paginator and idempotency plumbing every
service package shares.

**All nine published — `v3.0.0` on 2026-09-05, each with an npm provenance attestation.** The
versions in the table above are what is on npm today: the four phase 9 packages at `1.0.0`,
`@lazslov/api-core` at `2.0.0`, and the rest moved by the contract re-pin.

A tag matching `v*` is the only thing that publishes: the workflow runs the full gate, a
generated-types check and the live contract suite against real tenants before it ships anything, and
waits on a required reviewer first. Live status per phase is in
[docs/plans/PROGRESS.md](docs/plans/PROGRESS.md); how to cut the next release is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Working on it

```sh
pnpm install
pnpm verify        # lint, leak guard, type-check, test, build, tarball audit
```

| Command | What it does |
|---|---|
| `pnpm contracts:import [kb-path]` | re-pin the seven OpenAPI contracts from a knowledge-base checkout |
| `pnpm contracts:drift [kb-path]` | report when a pinned contract or its provenance has gone stale; `--report=<file>` writes the issue body |
| `pnpm generate:types` | regenerate `packages/*/src/generated/schema.ts`; output is committed |
| `pnpm check:leaks` | fail on a deployment host, credential or tenant slug in anything packable |
| `pnpm audit:tarballs` | pack every package and inspect what npm would actually ship |
| `pnpm test:node-baseline` | run the built artifact on the minimum supported runtime (needs `pnpm build` first) |
| `pnpm changeset` | record a version bump and its changelog entry — required for every change to a published package |
| `pnpm release:dry-run` | pack and list what a publish would push, without pushing it |

The knowledge base is a separate repository and deliberately not a submodule. Scripts that
need it take a path, fall back to `LAMIDO_KB_PATH`, then to a `knowledge-base` sibling
directory.

## The rule that shapes everything here

> No host, no key and no tenant identifier appears anywhere in a published tarball — not in
> code, not in a default, not in a test fixture, not in a README example, not in a generated
> `.d.ts`.

Every base URL comes from the consuming project's own environment, and there is no fallback:
a missing base URL is a configuration error the SDK reports. Documentation examples use
`https://content.example.com` and `csk_YOUR_SECRET_KEY`. Two guardrails enforce it — a
string scan that runs on every commit, and an audit of the packed tarballs.

## Licence

MIT.
