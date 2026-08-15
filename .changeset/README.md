# Changesets

Every change that reaches a published package needs a changeset: `pnpm changeset`, then commit
the Markdown file it writes here. [../CONTRIBUTING.md](../CONTRIBUTING.md#versioning) is the
authority on *which* bump to pick — two of the rules are counter-intuitive enough that guessing
gets them wrong.

## Why this config is not the default one

Four settings differ from `changeset init`, and each is a decision rather than a preference:

| Setting | Value | Why |
|---|---|---|
| `linked` / `fixed` | `[]` | **Independent versioning.** The whole reason for splitting the packages: a payment contract change must not produce a version bump that content consumers have to read a changelog to dismiss. |
| `access` | `public` | A scoped package defaults to *private*, and the first publish then fails with what looks like an auth error. |
| `updateInternalDependencies` | `minor` | A minor bump of `@lazslov/api-core` re-releases the three service packages, so their declared floor keeps naming a version that actually has what they use. A patch does not, because a patch needs no floor change to reach anyone. |
| `privatePackages` | `false` | `examples/*` are workspace members so a real consumer can resolve the packages, but they are not products. Nothing versions or tags them. |

> **The reason for `minor` changed at `1.0.0`, and the setting outlived it.** It used to read: a
> minor core bump *has* to re-release the service packages, because `^0.1.0` does not admit
> `0.2.0`. In `1.x` that is no longer true — `^1.0.0` admits `1.1.0`, so a consumer takes a core
> minor through `pnpm update` whether or not the service packages move. What the setting still buys
> is an accurate **floor**: a service package that starts calling a `1.1.0` API should not keep
> declaring `^1.0.0`. That is a weaker justification than the original one, and worth revisiting
> rather than inheriting.

`@lazslov/api-core` is depended on as `workspace:^`, which publishes as `^<version>`. Never pin it:
a pinned core is a core patch that three releases have to carry.
