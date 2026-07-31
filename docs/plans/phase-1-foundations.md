# Phase 1 — Foundations

**Goal:** a repository that can build, type-check, test and publish four packages, with the
guardrails that keep hosts and credentials out of every tarball in place *before* any API
code is written.

**Depends on:** nothing.

**Why first:** the leak guard and the type-generation pipeline are cheap now and expensive to
retrofit. Writing them before the transport means no phase can accidentally establish a
pattern they later forbid.

---

## 1. Repository and workspace

New repository: **`lazslov/lamido-api-sdk`**. Private until phase 8 says otherwise; the
*packages* are public, the repo does not have to be.

```
lamido-api-sdk/
├── package.json              # private root, workspace only, no publishable content
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .github/workflows/ci.yml
├── contracts/                # pinned copies of the KB's openapi.yaml — see §4
│   ├── content-service.openapi.yaml
│   ├── invoice-service.openapi.yaml
│   ├── payment-service.openapi.yaml
│   └── CONTRACTS.json        # which KB commit each was taken from
├── scripts/
│   ├── generate-types.ts
│   ├── check-contract-drift.ts
│   └── audit-tarballs.ts
└── packages/
    ├── api-core/
    ├── content/
    ├── invoice/
    └── payment/
```

**pnpm**, for workspaces and for `pnpm publish --filter`. Node 20 LTS as the development
runtime; Node 18 as the minimum supported (`engines.node: ">=18.17"`) because that is the
first version with a stable global `fetch` and a global `crypto`.

The root `package.json` is `"private": true`. It must never be publishable — a root publish
is how a monorepo leaks its scripts and its contract copies.

---

## 2. Dependency policy

> **RULE — a published package's `dependencies` block is either empty or contains exactly
> `@lazslov/api-core`. Nothing else, ever.**

Justification for each thing we do *not* depend on, so the argument does not have to be had
again:

| Not used | Instead |
|---|---|
| `axios`, `node-fetch`, `undici`, `ky` | global `fetch`. Available on Node 18+, every edge runtime, and every browser. A `fetch` override is a constructor option, so a consumer can inject their own. |
| `zod` for runtime validation of responses | The services already validate; re-validating every response doubles the cost and turns a new optional field into a client-side crash. Types are compile-time. The one place we *do* validate is **outbound** (see phase 3 §4, phase 4 §3) — hand-written predicates, no library. |
| `node:crypto` | `globalThis.crypto.subtle` for HMAC, so the verifier runs on Node and on edge runtimes from the same code. Constant-time comparison via double-HMAC — see [phase 2 §5](phase-2-api-core.md#5-hmac-signature-verification). |
| `date-fns`, `dayjs` | ISO 8601 in and out. The one formatting need (invoice's `YYYY-MM-DD`) is nine characters of `toISOString().slice(0, 10)`. |
| `decimal.js`, `big.js` | payment amounts are decimal **strings** and are never arithmetic'd by the SDK. See [phase 5 §2](phase-5-payment.md#2-the-money-type). |
| `qs` | `URLSearchParams`. |
| `debug` | An optional `onRequest` hook a consumer can wire to their own logger. Core logs nothing. |

DevDependencies, and what each is for:

| Package | Purpose |
|---|---|
| `typescript` | type-check and declaration emit |
| `tsdown` | bundle to ESM + CJS with `.d.ts` for both. Chosen over `tsup` for smaller output and native `exports` map generation; either is acceptable. |
| `vitest` | tests, including the live-tenant suite in phase 7 |
| `openapi-typescript` | generate types from the pinned contracts |
| `@biomejs/biome` | lint + format in one binary, no plugin tree |
| `publint` + `@arethetypeswrong/cli` | verify the published shape of each tarball |
| `@changesets/cli` | versioning and changelogs — see [phase 8](phase-8-release-and-drift.md) |

---

## 3. Build output and package shape

Each package publishes **dual ESM + CJS** with correct types for both. ESM-only would be
simpler and is fine for Next.js App Router, but a client project on an older toolchain or a
CJS script in `scripts/` should not be a support conversation.

```jsonc
// packages/content/package.json
{
  "name": "@lazslov/content",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=18.17" },
  "exports": {
    ".":        { "types": "./dist/index.d.ts",  "import": "./dist/index.js",  "require": "./dist/index.cjs" },
    "./fields": { "types": "./dist/fields.d.ts", "import": "./dist/fields.js", "require": "./dist/fields.cjs" },
    "./next":   { "types": "./dist/next.d.ts",   "import": "./dist/next.js",   "require": "./dist/next.cjs" }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "dependencies": { "@lazslov/api-core": "workspace:^" },
  "peerDependencies": { "next": ">=14" },
  "peerDependenciesMeta": { "next": { "optional": true } }
}
```

Four things in there are load-bearing:

- **`"files"` is an allowlist, not `.npmignore`.** An ignore list fails open: a new
  directory ships unless someone remembers to exclude it. An allowlist fails closed. This is
  the primary defence against publishing `contracts/` or a `.env`.
- **`"sideEffects": false`** so a bundler can drop unused subpaths from a client bundle.
- **`peerDependenciesMeta.next.optional`** so installing `@lazslov/content` in an Astro
  project does not warn. The `./next` subpath is the only thing that imports `next`.
- **`"exports"` with no wildcard.** Three named entry points, nothing else reachable. A
  consumer cannot deep-import `@lazslov/content/dist/internal/transport.js` and then be
  broken by a refactor.

`@lazslov/api-core` has an empty `dependencies` block and one export path.

---

## 4. Contract pinning and type generation

The knowledge base is the source of shapes. It is a *different* repository, so the SDK keeps
**pinned copies** rather than a submodule — a submodule makes every clone slower and every
CI run depend on access to the docs repo.

`scripts/generate-types.ts` runs `openapi-typescript` over each pinned contract into
`packages/<pkg>/src/generated/schema.ts`, and the generated files **are committed**. Reasons
to commit them: a consumer's `npm install` must not run a generator, a diff on a contract
update is reviewable, and CI can prove the committed output matches the contract.

`contracts/CONTRACTS.json` records provenance:

```jsonc
{
  "knowledgeBaseRepo": "lazslov/knowledge-base",
  "contracts": {
    "content-service":  { "kbCommit": "…", "sourceCommit": "d7b5c46", "verified": "2026-07-28" },
    "invoice-service":  { "kbCommit": "…", "sourceCommit": "f5af0dc", "verified": "2026-07-25" },
    "payment-service":  { "kbCommit": "…", "sourceCommit": "586eede", "verified": "2026-07-28" }
  }
}
```

`sourceCommit` and `verified` are copied from each doc's YAML front-matter. They are what
phase 8's drift check compares against.

> **RULE — strip `servers:` from every pinned contract on import.** An OpenAPI document
> carries the deployment host in `servers[].url`, and `openapi-typescript` does not emit it
> into types — but the pinned YAML itself must not contain it either, because a future
> tool might, and because `contracts/` is one `"files"` mistake away from being published.
> The import script rewrites `servers:` to a single `{ url: "{baseUrl}" }` template with a
> required variable, and the drift check ignores that field.

### Generated types are shapes only

`schema.ts` is never part of a package's public API surface directly. Each package
re-exports **named, hand-curated aliases**:

```ts
// packages/content/src/types.ts
import type { components } from "./generated/schema.js";

/** A published page document as the website tier returns it. */
export type PublishedPage = components["schemas"]["PublishedPage"];
```

Two reasons. A consumer writing `components["schemas"]["…"]` is coupled to the generator's
output shape, which changes when the generator does. And a curated alias is the place to
attach the doc comment that carries the *behaviour* the YAML cannot express — the 404-means-
unpublished rule, the omitted-not-null rule, and so on.

---

## 5. Guardrails, in place before any API code

### 5.1 The forbidden-strings lint

A Biome rule (or a small `scripts/` check run in CI) that fails on any of these appearing in
`packages/*/src/**` or in any README:

| Pattern | Why |
|---|---|
| any `https?://` host that is not `*.example.com` / `*.example.org` / `localhost` | a real host in source |
| `lamido.hu` | the deployment domain, in any form |
| a key prefix (`cpk_`, `csk_`, `cad_`, `isk_`, `iad_`, `pmk_`, `pad_`, `whsec_`) followed by 12+ non-placeholder characters | a real credential. The bare prefixes **must** be allowed: phase 2 §6 matches on them deliberately. Placeholders like `csk_YOUR_SECRET_KEY` are allowed by an explicit allowlist of `_YOUR_`/`_EXAMPLE_` suffixes. |
| a tenant slug from any real client site | tenant identity |

This runs on every commit, not just at release. Catching it at release means rewriting
history.

### 5.2 The tarball audit

`scripts/audit-tarballs.ts`: `pnpm pack` each package, extract, and assert

1. no file outside the `"files"` allowlist,
2. the forbidden-strings scan passes over every extracted file **including `.d.ts` and
   sourcemaps** — a sourcemap embeds original source text and is the most likely leak
   vector,
3. `dependencies` is empty or exactly `@lazslov/api-core`,
4. no `.env`, `.npmrc`, `contracts/`, or test fixture is present.

Wired into CI now, and into the release job in phase 8. Details in
[phase 7 §3](phase-7-verification.md#3-leak-audit).

### 5.3 `.gitignore` and `.npmrc`

`.env*` ignored at the root and in every package. A committed `.npmrc` with
`registry=https://registry.npmjs.org` and **no auth token** — the token lives in CI secrets
and in the developer's user-level `~/.npmrc` only.

---

## 6. CI

One workflow, on push and PR:

```
install (frozen lockfile)
  ├─ biome check
  ├─ tsc --noEmit         (all packages)
  ├─ generate-types + git diff --exit-code   ← committed output matches contracts
  ├─ vitest run           (unit + fixture suites; the live suite is separate — phase 7)
  └─ build → publint + attw + audit-tarballs (all packages)
```

The `git diff --exit-code` step after regeneration is the one that prevents a hand-edited
generated file, which is how a type quietly stops matching the service.

---

## Exit criteria

- [ ] `lamido-api-sdk` repo exists with the four package directories and a root that cannot be published.
- [ ] `pnpm build` produces ESM + CJS + types for all four; `publint` and `attw` are clean on each.
- [ ] Three contracts pinned in `contracts/`, `servers:` stripped, `CONTRACTS.json` filled from the KB front-matter.
- [ ] `pnpm generate:types` is idempotent — running it leaves the working tree clean.
- [ ] The forbidden-strings lint **fails** on a deliberately planted `https://content.lamido.hu` and on a planted 30-character `csk_…`, and **passes** on `csk_YOUR_SECRET_KEY`.
- [ ] `audit-tarballs` fails on a deliberately added stray file, then passes once removed.
- [ ] CI green on an empty-but-valid `@lazslov/api-core` that exports nothing but a version constant.

## Out of scope here

No transport, no endpoints, no error classes. Phase 1 succeeds when there is a factory that
can safely build and ship nothing — so that phase 2 can only add correct things to it.
