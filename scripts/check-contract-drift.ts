/**
 * Compare the pinned contracts against the knowledge base.
 *
 * Usage: `pnpm contracts:drift [path-to-knowledge-base] [--report=<file>]`
 *
 * Exits non-zero on any drift. With `--report`, also writes the findings as Markdown — the body
 * the weekly job opens an issue with. Requires a local knowledge-base checkout, so it is not part
 * of the default CI run.
 *
 * @see docs/plans/phase-8-release-and-drift.md §3
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type ContractDiff, diffContracts, formatDiff, isUnchanged } from "./lib/contract-diff.js";
import { readContractsManifest, readFrontMatterField } from "./lib/contracts-manifest.js";
import {
  contractPath,
  resolveKnowledgeBase,
  type ServiceDescriptor,
  services,
} from "./lib/paths.js";
import { sanitizeContract } from "./lib/sanitize-contract.js";

/** One service's findings. */
interface ServiceDrift {
  readonly service: string;
  /** One line per thing that moved, phrased for someone reading an issue. */
  readonly problems: readonly string[];
  /** Absent when the contract itself is unchanged. */
  readonly diff?: ContractDiff;
}

/** Compare one service, returning nothing when it is still in step. */
function checkService(service: ServiceDescriptor, kbPath: string): ServiceDrift | undefined {
  const pinnedProvenance = readContractsManifest().contracts[service.id];
  if (!pinnedProvenance) {
    return { service: service.id, problems: ["absent from CONTRACTS.json"] };
  }

  // Sanitise upstream the same way the import did, so the only differences that surface
  // are real contract changes rather than the host template.
  const upstream = sanitizeContract(
    readFileSync(path.join(kbPath, service.id, "openapi.yaml"), "utf8"),
    service.exampleHost,
  ).yaml;
  const pinned = readFileSync(contractPath(service), "utf8");

  const problems: string[] = [];
  let diff: ContractDiff | undefined;

  if (upstream !== pinned) {
    problems.push("the pinned contract differs from the knowledge base");
    diff = diffContracts(pinned, upstream);
  }

  const readme = readFileSync(path.join(kbPath, service.id, "README.md"), "utf8");
  const sourceCommit = readFrontMatterField(readme, "source_commit");
  const verified = readFrontMatterField(readme, "verified");

  if (sourceCommit !== pinnedProvenance.sourceCommit) {
    problems.push(
      `documentation now describes ${sourceCommit}, pinned at ${pinnedProvenance.sourceCommit}`,
    );
  }
  if (verified !== pinnedProvenance.verified) {
    problems.push(`verified date moved to ${verified}, pinned at ${pinnedProvenance.verified}`);
  }

  return problems.length > 0 ? { service: service.id, problems, diff } : undefined;
}

/**
 * The issue body.
 *
 * @remarks
 * The closing instruction is the point of the whole protocol, and it is deliberately not "run
 * `pnpm generate:types`". Regenerating is the mechanical half; the half that matters is in the
 * Markdown, which no generator reads.
 */
function report(drifted: readonly ServiceDrift[]): string {
  const lines = ["The pinned contracts are behind the knowledge base.", "", "## What moved", ""];

  for (const { service, problems } of drifted) {
    lines.push(`- **${service}** — ${problems.join("; ")}`);
  }

  for (const { service, diff } of drifted) {
    if (diff && !isUnchanged(diff)) lines.push("", formatDiff(service, diff));
  }

  lines.push(
    "",
    "## What to do",
    "",
    "1. `pnpm contracts:import && pnpm generate:types`, and review the diff.",
    "2. **Read the Markdown that changed, not only the regenerated types.** Every behavioural",
    "   rule this SDK encodes — what a `404` means, when a retry is safe, whether a field's",
    "   absence is normal — lives there and in nothing a generator can see. A regenerated",
    "   `schema.ts` with unchanged wrappers is the likeliest way this SDK becomes subtly wrong.",
    "3. If a live contract test is failing too, **update the knowledge base first, in its own",
    "   pull request**, then the SDK. Fixing the SDK alone leaves the documentation wrong for",
    "   every other consumer, and next quarter nobody can tell which of the two was right.",
  );

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const reportPath = args.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
  const kbPath = resolveKnowledgeBase(args.find((arg) => !arg.startsWith("--")));

  const drifted = services
    .map((service) => checkService(service, kbPath))
    .filter((drift): drift is ServiceDrift => drift !== undefined);

  if (drifted.length === 0) {
    console.log(`All ${services.length} pinned contracts match the knowledge base.`);
    return;
  }

  console.error("Contract drift detected:\n");
  for (const { service, problems } of drifted) {
    for (const problem of problems) console.error(`  ${service}: ${problem}`);
  }
  console.error("\nRun `pnpm contracts:import && pnpm generate:types` and review the diff.");

  if (reportPath) {
    writeFileSync(reportPath, report(drifted), "utf8");
    console.error(`Report written to ${reportPath}.`);
  }

  process.exit(1);
}

main();
