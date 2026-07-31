import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Repository-level suites (the guardrails in scripts/lib) live in test/;
    // each package keeps its own flat test/ directory alongside its src/.
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // A service package's tests import it through its own source, which imports @lamido/api-core
      // by name. Aliased to core's source so the suite runs from a clean clone and exercises what
      // is written; the built artefact is what `test:node-baseline` checks instead.
      "@lamido/api-core": fileURLToPath(
        new URL("./packages/api-core/src/index.ts", import.meta.url),
      ),
    },
  },
});
