import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The live suite: a separate command and a separate config, so it can never gate a normal commit.
 *
 * @remarks
 * `pnpm test` collects the repository's `test/` and each package's own. This one collects `live/` only,
 * reads its credentials from `.env.live` (untracked), and is run on demand and before a release — never
 * on a PR from a fork, which would need the secrets.
 *
 * The packages are resolved through their **source** here, the same as in the unit config. What this
 * suite verifies is the SDK's understanding of the *services*, not the shape of the tarball — that is
 * `test:node-baseline`'s job.
 */
export default defineConfig({
  test: {
    include: ["live/**/*.test.ts"],
    // One service at a time. These make real requests, some of them rate-limited per resource, and a
    // parallel run turns a deliberate 429 assertion into a flake.
    fileParallelism: false,
    // A live request crosses a network; the unit suite's default is far too tight for that.
    testTimeout: 30_000,
    // Loads `.env.live` if present, so a local run needs no shell plumbing. An already-set variable
    // always wins, so a CI job's secrets are never overwritten by a file left on a runner.
    setupFiles: ["live/load-env.ts"],
    // Reports what is configured. A `globalSetup` because it must print even when every suite skips —
    // which is precisely the case worth warning about.
    globalSetup: ["live/global-setup.ts"],
  },
  resolve: {
    alias: Object.fromEntries(
      ["api-core", "auth", "booking", "content", "email", "invoice", "payment", "webshop"].map(
        (name) => [
          `@lazslov/${name}`,
          fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
        ],
      ),
    ),
  },
});
