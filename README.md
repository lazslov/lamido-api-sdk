# lamido-api-sdk

[![CI](https://github.com/lazslov/lamido-api-sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lazslov/lamido-api-sdk/actions/workflows/ci.yml?query=branch%3Amain)

A consumer-side TypeScript SDK for the three services documented in the `knowledge-base`
repository, published to npm as five packages and installed into client-website projects.

| Package | Version | What it is |
|---|---|---|
| `@lazslov/api-core` | `1.0.0` | transport, errors, HMAC verification, paging — shared, depends on nothing |
| `@lazslov/content` | `1.0.0` | content-service: pages, sections, collections, datasets, assets |
| `@lazslov/invoice` | `1.0.0` | invoice-service: Hungarian invoicing |
| `@lazslov/payment` | `1.0.0` | payment-service: Stripe and Barion behind one merchant API |
| `@lazslov/telemetry` | `1.0.0` | the estate's log envelope, batched sink, alert channel and request middleware |

`@lazslov/telemetry` is the odd one out: it is consumed by the **services**, not by a client site,
and it depends on the other four not at all. It lives here because it is published from the same
release, under the same provenance.

The build plan, and the reasoning behind several packages rather than one, is in
[docs/plans/](docs/plans/). **All eight phases are complete.** `@lazslov/api-core` carries the
transport, error base, configuration, HMAC verifier, paginator and idempotency plumbing the three
service packages share; all three service surfaces are implemented; and the Next.js App Router
adapters ship on `@lazslov/content/next` and `@lazslov/payment/next`.

**Published 2026-08-15 — `v1.0.0`, all five packages, each with an npm provenance attestation.** A
tag matching `v*` is the only thing that publishes: the workflow runs the full gate, a
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
| `pnpm contracts:import [kb-path]` | re-pin the three OpenAPI contracts from a knowledge-base checkout |
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
