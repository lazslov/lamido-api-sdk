# Contributing

Nine packages, one repository, published independently. This file covers versioning, releasing
and the drift protocol. The rules about *how the code is written* are in [CLAUDE.md](CLAUDE.md);
the decisions behind what exists are in [docs/ai-context.md](docs/ai-context.md).

```bash
pnpm install
pnpm verify     # lint, leak guard, type-check, test, build, baselines, package audit
```

`pnpm verify` is the gate. It is also exactly what the release workflow runs, composed rather
than restated — so a check added here is a check the release gains.

**Node 22.13+** to develop. That is the toolchain's floor, not the packages': they declare
`>=20.19` and the CI matrix proves it against the built artefact on 20.19 and 22. The
toolchain needs 22.13 because pnpm 11 does.

The packages' floor is 20.19 rather than 18.17 because Node 18 exposes `globalThis.crypto` only
under `--experimental-global-webcrypto`, which makes every HMAC path throw. Raising it also puts
the floor inside Vitest 4's range (`^20.19 || >=22.12`).

---

## Versioning

[Changesets](https://github.com/changesets/changesets), with **independent versioning**. Every
change to a published package needs one:

```bash
pnpm changeset
```

Pick the packages, pick the bump, describe the change in the changelog's voice — a consumer
reading it should learn what to do, not what was refactored. Commit the generated file in
`.changeset/`.

**Every package starts at `1.0.0`, and none is below it.** This rule used to say everything stays in `0.x` until two
real client sites run on it — that `1.0.0` is a statement the shape has survived contact with a
second project. The `0.x` half did not survive contact with the estate:

**below `1.0.0`, a caret range does not cross a minor.** `^0.2.0` refuses `0.3.0`. So every minor
of `@lazslov/api-core` or `@lazslov/telemetry` would cost each service package, and each client
site, a bump of its own. For packages whose entire purpose is that every consumer shares one
transport and one log envelope, that turns the routine case — a rule added, a verdict narrowed —
into a pull request per consumer, and drift into the path of least resistance. `1.0.0` is what lets a patch
or a minor reach a consumer through `pnpm update`, which is the same reason
[api-core is never pinned](#lazslovapi-core-is-never-pinned).

So read `1.0.0` here as **the semver contract, not a maturity badge**: a breaking change gets a
major, and the table below defines breaking narrowly and unsentimentally. It does not claim the
shape is settled. What the old rule was protecting — *do not promise stability you have not
earned* — is now carried by that table and by the deprecation policy, which are the parts a
consumer can actually rely on.

### What counts as a breaking change

Worth reading rather than guessing. Three of these are counter-intuitive:

| Change | Semver |
|---|---|
| Removing or renaming an export | major |
| Adding a required parameter | major |
| A response type **gaining** a field | **minor** — the service added it; consumers are not broken |
| A response type **losing** a field | major |
| **Widening a `retryable` verdict** (false → true) | **major.** It changes what a caller's retry loop does with money. |
| **Narrowing a `retryable` verdict** (true → false) | minor — strictly safer |
| **Tightening a validator** (rejecting something previously sent) | major — even though the service would have rejected it anyway; code that compiled now throws |
| A new endpoint method | minor |
| A doc-comment or README change | patch |

The two `retryable` rows are the ones to slow down on. A verdict is not documentation: a caller's
retry loop branches on it, and widening one turns a payment that failed once into a payment
attempted twice.

### `@lazslov/api-core` is never pinned

Service packages depend on it as `workspace:^`, which publishes as `^<version>`. A patch to core
— the HMAC-verifier fix — then reaches every consumer through `pnpm update`, without three
coordinated releases. Pinning it would undo the only reason core is a published package.
`.changeset/config.json` sets `updateInternalDependencies: "minor"` for the same reason.

### Every release records the contract it believes in

Each package's `CHANGELOG.md` entry names the knowledge-base commit and every pinned service's
`source_commit`, copied from [contracts/CONTRACTS.json](contracts/CONTRACTS.json) — seven services
today, and the test derives the list from the manifest rather than counting:

```md
## 1.0.0

Verified against knowledge base `5191225`: content-service `ecf20fd`, invoice-service `3aa099f`,
payment-service `62a1799`.
```

That is the real line from the `1.0.0` release, not a sketch — copy the shape, and take the values
from `CONTRACTS.json` as it stands when you release.

`changeset version` writes a bare heading, so **add the line by hand** after running it.
`test/changelog-provenance.test.ts` fails until you do. The changelog ships inside the tarball,
which is what lets a consumer answer *"which version of the contract does my installed SDK
believe in?"* from `node_modules`, without this repository.

---

## Releasing

```bash
pnpm release:version         # applies the changesets: bumps versions, writes changelogs
# add the provenance line to each changed CHANGELOG.md
pnpm verify
pnpm release:dry-run         # five tarballs, core first
git commit && git push       # through a pull request, as always
git tag v1.1.0                      # LIGHTWEIGHT — see below. Any v* tag; never move a published one
git push origin v1.1.0
```

The tag is what publishes. [`.github/workflows/release.yml`](.github/workflows/release.yml) then
runs the full gate, the generated-types check and the **live contract suite** against the sandbox
tenants, and only then `pnpm publish -r --access public --provenance`. Core publishes first: a
service package published against an unpublished core installs broken.

> **Use a lightweight tag — `git tag v3.0.0`, not `git tag -a`.** `v3.0.0` was annotated, and the
> release reported failure *after* publishing all nine packages: `actions/checkout` resolves an
> annotated tag to its commit, so the local `v3.0.0` no longer matched the remote tag object, and
> the final `git push --tags` was refused on that one ref. Every package and every per-package tag
> had already landed. **The workflow no longer pushes `--tags`** — it names `refs/tags/@lazslov/*`,
> so the trigger tag is never offered back and the step can only fail for a reason that matters.
> A lightweight tag is still the right thing to create: it is what the annotation was worth.

There is deliberately **no manual dispatch and no skip flag**. npm's unpublish window is narrow
and mirrors are fast, so a release that needs a gate skipped is a release that should not happen.
`test/release-workflow.test.ts` asserts that — including that the live suite runs *before* the
publish step, and that `LIVE_REQUIRE_CONFIGURED` is set so a missing secret fails the release
instead of silently skipping every case and reporting the same green as a full pass.

The **first** release of a package needs no changeset of its own: it already declares `1.0.0` with a
changelog entry carrying its provenance line, so `pnpm release:version` has nothing left to apply.
That was true of the original five at `v1.0.0`, and it is true of the four phase 9 added — tagging
is the whole step for them. Every release after a package's first follows the flow above.

**The four phase 9 packages are not published yet**, and the release that ships them fails until
their live-suite secrets exist on the `release` environment. That is `LIVE_REQUIRE_CONFIGURED`
doing its job; [docs/live-testing.md §3b](docs/live-testing.md) says what to provision.

### Before the first publish — all done, kept as the standing account checklist

**This was completed for `v1.0.0` on 2026-08-15.** It stays here because every item is also what a
*replacement* maintainer, a rotated token or a fresh sandbox has to satisfy — and because two of
them were discovered the hard way, noted inline.

- [x] **`npm whoami` says `lazslov`.** `@lazslov` is a *user* scope, not an organisation — the
      maintainer's own npm username — so there is no organisation to create and no membership to
      grant. A free account publishes as many public packages under its own scope as it likes;
      only *private* packages need a paid plan, and none of these are private. That is the whole
      of the account setup.
- [x] **2FA on the npm account**, with a granular **automation** token as the CI path. The token
      kind matters: a *Publish* token prompts for 2FA, and a workflow cannot answer a prompt.
- [x] **A granular access token** with publish permission on the five `@lazslov/*` packages,
      stored as the `NPM_TOKEN` secret of the `release` GitHub environment. Never in a committed
      `.npmrc` — [.npmrc](.npmrc) exists to hold the registry URL and nothing else.
- [x] **The `release` environment exists** and has a required reviewer. Publishing is the one
      irreversible action this repository can take; a human approving it is proportionate.

      Two things this turned out to require. Environment protection rules need **GitHub Pro or
      above on a private repository** — the API answers `422` naming the billing plan. And npm
      provenance needs a **public** repository, because the attestation names a public source. So
      the repository went public, which satisfied both at once.
- [x] **The live-suite secrets are in that environment** — base URL and key for every service
      the suite covers. Base URLs are secrets here too: no deployment host belongs in this repository.
      **Phase 9 added four services, and their secrets are not set yet** — the release fails with
      `LIVE_REQUIRE_CONFIGURED` naming them until they are (see
      [docs/live-testing.md](docs/live-testing.md)).

      Fill in [`.env.live.example`](.env.live.example) once, then
      `./scripts/push-release-secrets.sh` sets every one of them from it. Values go to
      `gh secret set` on stdin, so none reaches the process table or the shell history, and the
      script prints names only. Re-running it is how a single value is rotated.

      > **The URLs must be reachable from a GitHub runner.** `.env.live` is usually filled for
      > local work, and a `localhost` base URL fails every live case with `ECONNREFUSED` — loudly,
      > because the suite still counts the service as *configured*. The first `v1.0.0` tag failed
      > exactly here. Nothing published: the live suite runs before the publish step.
- [x] **Sandbox tenants are provisioned.** [docs/live-testing.md](docs/live-testing.md) is the
      checklist, including which calls are safe to point at a live tenant and which are not.

`--access public` is not optional: a scoped package defaults to *private*, and the failure on
first publish looks like an auth error.

---

## Deprecation

- A removed export gets **one minor release** where it is still present, marked `@deprecated`
  with the replacement named in the tag.
- A **security fix to the HMAC verifier** ships as a patch to `@lazslov/api-core` immediately,
  with no deprecation window. Every service package's README then names the minimum core
  version, and the affected core versions are `npm deprecate`d with a message naming the fixed
  one.
- A breaking change ships in a **major**, and its changeset must say **what breaks and how to
  migrate** — in the changelog, not only in a commit message. That sentence used to grant `0.x`
  the right to break in a minor; at `1.0.0` no such right exists, and the migration note is the
  part that was always doing the work.

---

## The drift protocol

The SDK consumes a knowledge base that itself consumes three service repositories, so there are
two independent ways for it to go stale:

```
service repo  ──drift A──▶  knowledge-base docs  ──drift B──▶  SDK
```

**Drift B** is mechanical. [`.github/workflows/drift.yml`](.github/workflows/drift.yml) runs
weekly, compares the pinned contracts and their front-matter provenance against the knowledge
base at `main`, and opens one issue listing the operations and schemas that moved. Run it by
hand — `workflow_dispatch`, optionally against an older ref — to check the detector still works.
Locally:

```bash
pnpm contracts:drift                    # ../knowledge-base, or $LAMIDO_KB_PATH
pnpm contracts:drift --report=drift.md  # the issue body
```

The issue is a prompt to read the **Markdown** that changed, not just to regenerate types. Every
behavioural rule this SDK encodes lives in prose that no generator can see, so a regenerated
`schema.ts` with unchanged wrappers is the likeliest way the SDK becomes subtly wrong.

**Drift A** is not the SDK's to detect, but it is usually where it surfaces — as a failing live
contract test.

> **RULE — when a live test fails because the service changed, the knowledge base is updated
> first, in its own pull request, and the SDK change follows.** Fixing the SDK alone leaves the
> documentation wrong for every other consumer and for every agent reading it, and next quarter
> nobody can tell which of the two was right.

### Writing back to the knowledge base

Building against these services produces knowledge that belongs there rather than here:

| Discovery | Goes to |
|---|---|
| A documented example that does not match the real response | a PR against that service's `*.md` and `examples.http` |
| An environment-variable name this SDK proposed (`CONTENT_SERVICE_PUBLISHABLE_KEY`, `INVOICE_SERVICE_CLIENT_KEY`) | a PR adding it to that service's `operations.md` / `conventions.md`, so the SDK and the docs agree on one name |
| A consumer-side pattern the SDK now encapsulates | a note in that service's integration guide pointing at the package, so the next integrator does not hand-roll a gateway |

Every change there goes through a pull request. Never a direct push to `main` — in either
repository.
