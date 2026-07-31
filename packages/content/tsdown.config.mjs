import { defineConfig } from "tsdown";
import { sharedOptions } from "../../tsdown.base.mjs";

/**
 * Three entry points.
 *
 * `./fields` is a leaf that must stay importable from a client component, so it is built separately
 * rather than being reachable only through the main entry, which pulls in the transport and the
 * credential handling.
 *
 * `./next` is the only entry that imports `next`, which is an **optional** peer dependency — so it has
 * to be its own chunk, or installing this package in an Astro or plain-Node project would pull in a
 * module it has no reason to have. `next` is externalised rather than bundled, which is what declaring
 * it in `peerDependencies` already tells tsdown.
 */
export default defineConfig({
  ...sharedOptions,
  entry: ["src/index.ts", "src/fields/index.ts", "src/next/index.ts"],
  // Externalised explicitly, and not only because it is a peer dependency: the root tsconfig maps
  // `next/cache` to Next's declaration file so `pnpm typecheck` can resolve an extension-less subpath
  // of a package that ships no `exports` map. Without this, the bundler follows that mapping too and
  // emits `import … from "next/cache.d.ts"`, which resolves nowhere in a consumer's project. Marking
  // it external keeps the specifier exactly as written.
  external: [/^next(\/|$)/],
});
