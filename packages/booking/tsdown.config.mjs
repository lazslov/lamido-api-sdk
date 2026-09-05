import { defineConfig } from "tsdown";
import { sharedOptions } from "../../tsdown.base.mjs";

/**
 * Two entry points. `./next` carries the webhook route handler, which imports nothing from `next` —
 * it takes a `Request` and answers a `Response` — so this package declares no peer dependency. The
 * subpath exists because that is where a consumer looks for a route handler, and it stays a separate
 * chunk so a project that never receives webhooks does not carry it.
 */
export default defineConfig({
  ...sharedOptions,
  entry: ["src/index.ts", "src/next/index.ts"],
});
