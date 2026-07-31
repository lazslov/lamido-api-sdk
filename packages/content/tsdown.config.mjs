import { defineConfig } from "tsdown";
import { sharedOptions } from "../../tsdown.base.mjs";

/**
 * Two entry points. `./fields` is a leaf that must stay importable from a client component, so it
 * is built separately rather than being reachable only through the main entry, which pulls in the
 * transport and the credential handling.
 */
export default defineConfig({
  ...sharedOptions,
  entry: ["src/index.ts", "src/fields/index.ts"],
});
