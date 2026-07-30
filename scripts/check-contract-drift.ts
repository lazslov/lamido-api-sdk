/**
 * Compare the pinned contracts against the knowledge base.
 *
 * Usage: `pnpm contracts:drift [path-to-knowledge-base]`
 *
 * Phase 8 owns the drift *protocol* — what to do when this fails. Phase 1 ships the
 * detector, because a pinned copy nobody compares is a copy that silently goes stale.
 * Requires a local knowledge-base checkout, so it is not part of the default CI run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { readContractsManifest, readFrontMatterField } from "./lib/contracts-manifest.js";
import { contractPath, resolveKnowledgeBase, services } from "./lib/paths.js";
import { sanitizeContract } from "./lib/sanitize-contract.js";

function main(): void {
  const kbPath = resolveKnowledgeBase(process.argv[2]);
  const manifest = readContractsManifest();
  const problems: string[] = [];

  for (const service of services) {
    const pinnedProvenance = manifest.contracts[service.id];
    if (!pinnedProvenance) {
      problems.push(`${service.id}: absent from CONTRACTS.json`);
      continue;
    }

    // Sanitise upstream the same way the import did, so the only differences that surface
    // are real contract changes rather than the host template.
    const upstream = sanitizeContract(
      readFileSync(path.join(kbPath, service.id, "openapi.yaml"), "utf8"),
      service.exampleHost,
    ).yaml;

    if (upstream !== readFileSync(contractPath(service), "utf8")) {
      problems.push(`${service.id}: pinned contract differs from the knowledge base`);
    }

    const readme = readFileSync(path.join(kbPath, service.id, "README.md"), "utf8");
    const sourceCommit = readFrontMatterField(readme, "source_commit");
    const verified = readFrontMatterField(readme, "verified");

    if (sourceCommit !== pinnedProvenance.sourceCommit) {
      problems.push(
        `${service.id}: documentation now describes ${sourceCommit}, pinned at ${pinnedProvenance.sourceCommit}`,
      );
    }
    if (verified !== pinnedProvenance.verified) {
      problems.push(
        `${service.id}: verified date moved to ${verified}, pinned at ${pinnedProvenance.verified}`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("Contract drift detected:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("\nRun `pnpm contracts:import && pnpm generate:types` and review the diff.");
    process.exit(1);
  }

  console.log(`All ${services.length} pinned contracts match the knowledge base.`);
}

main();
