# Changesets

Every change that reaches a published package needs a changeset: `pnpm changeset`, then commit
the Markdown file it writes here. [../CONTRIBUTING.md](../CONTRIBUTING.md#versioning) is the
authority on *which* bump to pick — two of the rules are counter-intuitive enough that guessing
gets them wrong.

## Why this config is not the default one

Four settings differ from `changeset init`, and each is a decision rather than a preference:

| Setting | Value | Why |
|---|---|---|
| `linked` / `fixed` | `[]` | **Independent versioning.** The whole reason for four packages: a payment contract change must not produce a version bump that content consumers have to read a changelog to dismiss. |
| `access` | `public` | A scoped package defaults to *private*, and the first publish then fails with what looks like an auth error. |
| `updateInternalDependencies` | `minor` | A patch to `@lazslov/api-core` — the HMAC-verifier-fix scenario — reaches consumers through the caret range on its own, without re-releasing three service packages. A **minor** core bump does re-release them, because `^0.1.0` does not admit `0.2.0`. |
| `privatePackages` | `false` | `examples/*` are workspace members so a real consumer can resolve the packages, but they are not products. Nothing versions or tags them. |

`@lazslov/api-core` is depended on as `workspace:^`, which publishes as `^<version>`. Never pin it:
a pinned core is a core patch that three releases have to carry.
