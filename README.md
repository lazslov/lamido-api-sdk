# lamido-api-sdk

A consumer-side TypeScript SDK for the three services documented in the `knowledge-base`
repository, published to npm as four packages and installed into client-website projects.

| Package | What it is |
|---|---|
| `@lamido/api-core` | transport, errors, HMAC verification, paging — shared, depends on nothing |
| `@lamido/content` | content-service: pages, sections, collections, datasets, assets |
| `@lamido/invoice` | invoice-service: Hungarian invoicing |
| `@lamido/payment` | payment-service: Stripe and Barion behind one merchant API |

The build plan, and the reasoning behind four packages rather than one, is in
[docs/plans/](docs/plans/). **Every build phase — 1 through 6 — is complete:** the repository builds,
tests and audits four publishable packages, `@lamido/api-core` carries the transport, error base,
configuration, HMAC verifier, paginator and idempotency plumbing the three service packages share, all
three service surfaces are implemented, and the Next.js App Router adapters ship on
`@lamido/content/next` and `@lamido/payment/next`. Phase 8's release machinery is built too —
changesets, a tag-triggered release workflow and the weekly contract-drift job. **Nothing is
published yet:** what remains needs a sandbox tenant (phase 7) and an npm account (phase 8). Live
status per phase is in [docs/plans/PROGRESS.md](docs/plans/PROGRESS.md); how to release, and what must
be true first, is in [CONTRIBUTING.md](CONTRIBUTING.md).

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
