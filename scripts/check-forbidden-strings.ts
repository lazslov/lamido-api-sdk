/**
 * Fail on anything deployment-specific in a file that could reach a tarball.
 *
 * Usage: `pnpm check:leaks`
 *
 * Runs on every commit, not only at release: catching a real host or key at release time
 * means rewriting history. Phase 1 §5.1.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type Finding,
  formatFindings,
  loadTenantSlugs,
  scanText,
} from "./lib/forbidden-strings.js";
import { contractsDir, repoRoot } from "./lib/paths.js";
import { isTextFile, listFiles } from "./lib/walk.js";

/**
 * What gets scanned: everything that ships, plus the pinned contracts that sit one
 * `"files"` mistake away from shipping. `docs/` and `scripts/` are excluded — neither is
 * packed, and both quote the forbidden strings while explaining them.
 *
 * `test/fixtures/doc-examples/` is in scope for a different reason. Those files are
 * *derived from the knowledge base*, whose documents carry the real deployment hosts and
 * credential-shaped placeholders — the extractor rewrites both on the way in, and this is
 * what proves it did. They cannot reach a tarball (`"files"` names only `dist`), but this
 * repository is bound for a public remote, and a committed `content.lamido.hu` is exactly
 * what the guard exists to stop. The rest of `test/` stays out: several suites there quote
 * the forbidden patterns deliberately, as the data that proves the guard still matches them.
 */
const scanRoots = [
  path.join(repoRoot, "packages"),
  contractsDir,
  path.join(repoRoot, "test", "fixtures", "doc-examples"),
];

/** Single files worth scanning that fall outside those roots. */
const scanFiles = [path.join(repoRoot, "README.md")];

function main(): void {
  const tenantSlugs = loadTenantSlugs();
  const targets = [...scanRoots.flatMap(listFiles), ...scanFiles.filter(existsSync)].filter(
    isTextFile,
  );

  let total = 0;
  for (const file of targets) {
    const findings: Finding[] = scanText(readFileSync(file, "utf8"), { tenantSlugs });
    if (findings.length === 0) continue;
    total += findings.length;
    console.error(formatFindings(path.relative(repoRoot, file).replaceAll("\\", "/"), findings));
  }

  if (total > 0) {
    console.error(
      `\n${total} forbidden string(s) found. Nothing about a deployment — host, key or ` +
        "tenant — may appear in a published package. See docs/plans/README.md.",
    );
    process.exit(1);
  }

  const slugNote = tenantSlugs.length > 0 ? ` (${tenantSlugs.length} tenant slug(s) checked)` : "";
  console.log(`Scanned ${targets.length} file(s): clean${slugNote}.`);
}

main();
