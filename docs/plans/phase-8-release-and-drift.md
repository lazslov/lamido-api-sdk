# Phase 8 — Release and drift

**Goal:** publish the four packages safely and repeatably, and establish the protocol that
keeps them honest as the three services move.

**Depends on:** [phase 7](phase-7-verification.md). Nothing publishes until the leak audit and
the live suite are green.

---

## 1. Versioning

`@changesets/cli`, with **independent versioning** — each package carries its own version and
its own changelog. That is the whole point of the four-package split
([index](README.md#why-not-one-package)): a payment contract change should not produce a
version bump that content consumers have to read a changelog to dismiss.

Start every package at **`0.1.0`** and stay in `0.x` until at least two real client sites are
running on it. In `0.x`, a minor bump may break — which is honest, and better than reaching
`1.0.0` before the API has met a second project. `1.0.0` is a statement that the shape has
survived contact.

`@lazslov/api-core` is depended on with a **caret range**, not `workspace:*` pinning, so a
consumer can take a core patch — the HMAC verifier fix scenario from
[phase 2](phase-2-api-core.md#why-core-is-a-published-package-rather-than-inlined) — without
waiting for three service releases.

### What counts as a breaking change

Worth writing down, because two of these are counter-intuitive:

| Change | Semver |
|---|---|
| Removing or renaming an export | major |
| Adding a required parameter | major |
| A response type gaining a field | **minor** — the service added it; consumers are not broken |
| A response type losing a field | major |
| **Widening a `retryable` verdict** (false → true) | **major.** It changes what a caller's retry loop does with money. |
| **Narrowing a `retryable` verdict** (true → false) | minor — strictly safer |
| **Tightening a validator** (rejecting something previously sent) | major — even though the service would have rejected it anyway; code that compiled now throws |
| A new endpoint method | minor |
| A doc-comment or README change | patch |

---

## 2. Publishing

```
tag pushed  →  install  →  full CI (lint, types, unit, fixtures)
                       →  build  →  publint + attw + audit-tarballs
                       →  test:live against sandbox tenants
                       →  pnpm publish -r --access public --provenance
```

Requirements:

- **npm provenance** via GitHub Actions OIDC (`--provenance`, `id-token: write`). A consumer
  can then verify the tarball was built from this repo at this commit — which matters more than
  usual for a package that handles payment credentials.
- **A granular npm automation token** scoped to the `@lazslov` packages, in GitHub Actions secrets.
  Never in a committed `.npmrc` ([phase 1 §5.3](phase-1-foundations.md#53-gitignore-and-npmrc)).
- **`--access public`** explicitly on the first publish of each package: a scoped package
  defaults to *private* and fails, and the failure looks like an auth error.
- **`audit-tarballs` runs in the release job too**, not just on PRs. Publishing the tarball the
  audit inspected is the only ordering that means anything.
- **2FA on the npm account**, with the automation token as the CI path.
- ~~The `@lamido` npm organisation must exist and own the scope before the first publish.~~
  **Superseded.** The packages publish under `@lazslov`, the maintainer's own npm username. A user
  scope needs no organisation, no membership and no paid plan — a free account publishes unlimited
  *public* packages under it, and none of these are private. See
  [../ai-context.md](../ai-context.md#phase-8-decisions-and-where-they-deviate-from-the-plan).

### Release order

Core first, then the three service packages. Changesets handles this, but the constraint is
worth stating: a service package published against an unpublished core version installs broken.

---

## 3. The drift protocol

This is the part that decides whether the SDK is still worth trusting in a year.

The SDK is a **consumer** of this knowledge base, which is itself a consumer of three service
repositories. Two independent drift risks:

```
service repo  ──drift A──▶  knowledge-base docs  ──drift B──▶  SDK
```

### Drift B — SDK vs docs

Mechanical, and CI-checkable. A weekly scheduled job:

1. Fetch the knowledge base at `main`.
2. Compare each doc folder's front-matter `source_commit` and `verified` against
   `contracts/CONTRACTS.json` ([phase 1 §4](phase-1-foundations.md#4-contract-pinning-and-type-generation)).
3. Diff the live `openapi.yaml` against the pinned copy, ignoring the stripped `servers:` block.
4. If either moved: open an issue listing the changed operations and schemas.

The issue is a prompt to read the **Markdown** diff, not just to regenerate types. Per this
repo's own rule, *"Markdown is the authority on behaviour; `openapi.yaml` is the authority on
shapes"* — and every high-value thing in phases 3–6 came from Markdown that no generator can
see. A regenerated `schema.ts` with unchanged wrappers is the most likely way this SDK becomes
subtly wrong.

### Drift A — docs vs service

Not the SDK's job to detect, but the SDK is often where it *surfaces*: a live contract test
failing ([phase 7 §4](phase-7-verification.md#the-drift-signal)) means either the SDK is wrong
or the docs are stale.

> **RULE — when a live test fails because the service changed, the knowledge base is updated
> first, in its own PR, and the SDK change follows.** Fixing the SDK alone leaves the docs
> wrong for every other consumer and for every agent reading them, and next quarter nobody can
> tell which of the two was right.

That ordering also matches this repository's own maintenance rule: *when a service's API
changes, update its docs, its spec, its example requests and its front-matter in the same pull
request* — and **every change goes through a pull request, never a direct push to `main`.**

### What each release records

Every package's `CHANGELOG.md` entry names the knowledge-base commit and each service's
`source_commit` it was verified against. So a consumer debugging an integration can answer
"which version of the contract does my installed SDK believe in?" without reading the SDK's
git history.

---

## 4. Writing back to the knowledge base

Building the SDK will produce knowledge that belongs here rather than in the SDK repo. Three
kinds, each with a home:

| Discovery | Goes to |
|---|---|
| A doc example that does not match the real response | a PR against the relevant `<service>/*.md` and `examples.http` |
| An env var name this plan proposed (`CONTENT_SERVICE_PUBLISHABLE_KEY`, `INVOICE_SERVICE_CLIENT_KEY`) | a PR adding it to that service's `operations.md` / `conventions.md`, so the SDK and the docs agree on one name |
| A consumer-side pattern the SDK now encapsulates | a note in the relevant `site-integration.md`-style file pointing at the SDK, so the next integrator does not hand-roll a gateway |

That last one is worth being specific about.
[content-service/conventions.md §9](../content-service/conventions.md#9-what-this-service-deliberately-does-not-do)
currently lists **"an SDK package"** under *what this service deliberately does NOT do*, with
the guidance *"write your own transport."* Once `@lazslov/content` is published and running on a
real site, that row is stale — the service still ships no SDK, but a consumer-side one now
exists and is the recommended path.

> **Deliverable:** a PR against content-service's `conventions.md` (and the equivalent lines in
> the other two folders) that keeps the "the service ships no SDK" fact and adds a pointer to
> the consumer package. Not a rewrite — the distinction between *the service publishes no
> client* and *a client exists* is exactly the thing to keep clear.

---

## 5. Deprecation policy

Small blast radius — the consumers are client sites this team builds — but the policy should
exist before it is needed:

- A removed export gets one minor release where it is still present, marked `@deprecated` with
  the replacement named in the tag.
- A **security** fix to the HMAC verifier ships as a patch to `@lazslov/api-core` immediately,
  with no deprecation window, and every published service package's README gains a line naming
  the minimum core version. Then `npm deprecate` the affected core versions with a message
  naming the fixed one.
- A `0.x` breaking change may ship in a minor, but the changeset must say what breaks and how
  to migrate, in the changelog, not only in a commit message.

---

## Exit criteria

- [ ] The npm scope is ours — `@lazslov`, a user scope, so no organisation is involved; 2FA is on; a granular automation token is in GitHub Actions secrets and in no file.
- [ ] Changesets configured for independent versioning; the breaking-change table above lives in `CONTRIBUTING.md`.
- [ ] A dry-run release (`pnpm publish -r --dry-run`) produces exactly four tarballs with the expected file lists.
- [ ] The release workflow runs the leak audit **and** the live suite before publishing, and cannot be skipped by a manual dispatch flag.
- [ ] `@lazslov/api-core@0.1.0` and the three service packages publish with provenance, and `npm view <pkg>` shows the provenance attestation.
- [ ] A fresh project can `pnpm add @lazslov/content`, set two env vars, and read a page — verified from outside the monorepo, not from a workspace link.
- [ ] The weekly drift job runs and opens an issue when `CONTRACTS.json` is behind the knowledge base. Verified by pointing it at an older commit deliberately.
- [ ] Each package's `CHANGELOG.md` entry names the KB commit and the three `source_commit` values.
- [ ] The knowledge-base PR updating the "no SDK package" row is open (or merged).

## Out of scope here

A public documentation site, a migration guide from hand-rolled gateways (the packages'
READMEs cover it), and any marketing of these packages. They exist to make the next client
site faster to build, not to acquire users.
