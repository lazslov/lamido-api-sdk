# Contributing

Four packages, one repository, published independently. This file covers versioning, releasing
and the drift protocol. The rules about *how the code is written* are in [CLAUDE.md](CLAUDE.md);
the decisions behind what exists are in [docs/ai-context.md](docs/ai-context.md).

```bash
pnpm install
pnpm verify     # lint, leak guard, type-check, test, build, baselines, package audit
```

`pnpm verify` is the gate. It is also exactly what the release workflow runs, composed rather
than restated — so a check added here is a check the release gains.

**Node 22.13+** to develop. That is the toolchain's floor, not the packages': they declare
`>=18.17` and the CI matrix proves it against the built artefact on 18.17, 20 and 22. The
toolchain needs 22.13 because pnpm 11 does.

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

Everything stays in `0.x` until at least two real client sites are running on it. In `0.x` a
minor may break, which is honest; `1.0.0` is a statement that the shape has survived contact
with a second project.

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

### `@lamido/api-core` is never pinned

Service packages depend on it as `workspace:^`, which publishes as `^<version>`. A patch to core
— the HMAC-verifier fix — then reaches every consumer through `pnpm update`, without three
coordinated releases. Pinning it would undo the only reason core is a published package.
`.changeset/config.json` sets `updateInternalDependencies: "minor"` for the same reason.

### Every release records the contract it believes in

Each package's `CHANGELOG.md` entry names the knowledge-base commit and all three services'
`source_commit`, copied from [contracts/CONTRACTS.json](contracts/CONTRACTS.json):

```md
## 0.2.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.
```

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
pnpm release:dry-run         # four tarballs, core first
git commit && git push       # through a pull request, as always
git tag v0.2.0 && git push --tags
```

The tag is what publishes. [`.github/workflows/release.yml`](.github/workflows/release.yml) then
runs the full gate, the generated-types check and the **live contract suite** against the sandbox
tenants, and only then `pnpm publish -r --access public --provenance`. Core publishes first: a
service package published against an unpublished core installs broken.

There is deliberately **no manual dispatch and no skip flag**. npm's unpublish window is narrow
and mirrors are fast, so a release that needs a gate skipped is a release that should not happen.
`test/release-workflow.test.ts` asserts that — including that the live suite runs *before* the
publish step, and that `LIVE_REQUIRE_CONFIGURED` is set so a missing secret fails the release
instead of silently skipping every case and reporting the same green as a full pass.

The **first** release is the exception: all four packages already declare `0.1.0` and already have a
`0.1.0` changelog entry, so there is no changeset to apply and `pnpm release:version` has nothing to
do. Tagging `v0.1.0` is the whole step. Every release after that follows the flow above.

### Before the first publish

None of this can be done from the repository, and all of it must be true before a tag is pushed.

- [ ] **Confirm who owns the `@lamido` scope.** As of 2026-07-31 the npm registry resolves
      `@lamido` to an existing *account* scope — `/-/org/lamido/user` answers `{"lamido":"owner"}`,
      the shape a user account returns, not the `{}` an organisation returns — with **zero
      packages published** under it. Log in and check:

      ```bash
      npm whoami
      npm access list packages @lamido
      ```

      If that account is not yours, the four packages need a different scope, and renaming them
      is a repository-wide change best made before anything is published, not after.
- [ ] **2FA on the npm account**, with a granular automation token as the CI path.
- [ ] **A granular access token** scoped to the `@lamido` packages, with publish permission,
      stored as the `NPM_TOKEN` secret of the `release` GitHub environment. Never in a committed
      `.npmrc` — [.npmrc](.npmrc) exists to hold the registry URL and nothing else.
- [ ] **The `release` environment exists** and has a required reviewer. Publishing is the one
      irreversible action this repository can take; a human approving it is proportionate.
- [ ] **The live-suite secrets are in that environment** — base URL and key for all three
      services. Base URLs are secrets here too: no deployment host belongs in this repository.
- [ ] **Sandbox tenants are provisioned.** [docs/live-testing.md](docs/live-testing.md) is the
      checklist, including which calls are safe to point at a live tenant and which are not.

`--access public` is not optional: a scoped package defaults to *private*, and the failure on
first publish looks like an auth error.

---

## Deprecation

- A removed export gets **one minor release** where it is still present, marked `@deprecated`
  with the replacement named in the tag.
- A **security fix to the HMAC verifier** ships as a patch to `@lamido/api-core` immediately,
  with no deprecation window. Every service package's README then names the minimum core
  version, and the affected core versions are `npm deprecate`d with a message naming the fixed
  one.
- A `0.x` breaking change may ship in a minor, but the changeset must say **what breaks and how
  to migrate** — in the changelog, not only in a commit message.

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
