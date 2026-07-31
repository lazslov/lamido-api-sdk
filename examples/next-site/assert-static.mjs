/**
 * Assert that `/` came out of the build **prerendered**.
 *
 * Run with `pnpm --filter @lazslov-examples/next-site verify:static`, after a build.
 *
 * This is the closest a build can get to the `x-vercel-cache: HIT` check, and it exists because the
 * regression it catches is uniquely invisible: a `cache: "no-store"` anywhere in a route's render path
 * opts the **whole route** out of static rendering, and the symptom in production is a latency and cost
 * regression rather than an error. No test fails. The diff looks fine. And a **keyless local build hides
 * it entirely**, because nothing fetches, so nothing goes dynamic — which is why this project builds with
 * an empty environment on purpose and checks the manifest rather than the page's behaviour.
 *
 * Read from `prerender-manifest.json` rather than by grepping the build's console output: the manifest is
 * the build's own record of what it prerendered, and its `routes` map is exactly "these are static".
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".next",
  "prerender-manifest.json",
);

/** The route whose staticness is the whole point of cache mode A. */
const modeARoute = "/";

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`could not read ${manifestPath} — run the build first.\n${error}`);
  process.exit(1);
}

const prerendered = Object.keys(manifest.routes ?? {});

if (!prerendered.includes(modeARoute)) {
  console.error(
    `\n  ${modeARoute} is NOT prerendered.\n\n` +
      `  Something opted this route out of static rendering. The usual cause is a\n` +
      `  \`cache: "no-store"\` reaching a read in its render path — which is what the\n` +
      `  gateway's mode B exists to make unnecessary. Other causes: cookies(), headers(),\n` +
      `  or an explicit \`dynamic = "force-dynamic"\`.\n\n` +
      `  Prerendered routes in this build: ${prerendered.join(", ") || "(none)"}\n`,
  );
  process.exit(1);
}

console.log(`\n  ✓ ${modeARoute} is prerendered as static content\n`);
