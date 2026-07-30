import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Repository-level suites (the guardrails in scripts/lib) live in test/;
    // each package keeps its own flat test/ directory alongside its src/.
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
