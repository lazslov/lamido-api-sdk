/**
 * Pin the knowledge base's OpenAPI contracts into `contracts/`.
 *
 * Usage: `pnpm contracts:import [path-to-knowledge-base]`
 *
 * The knowledge base is a separate repository and deliberately not a submodule, so its
 * location is a local fact. Every copy is sanitised on the way in — see phase 1 §4.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type ContractProvenance,
  readFrontMatterField,
  writeContractsManifest,
} from "./lib/contracts-manifest.js";
import { contractPath, contractsDir, resolveKnowledgeBase, services } from "./lib/paths.js";
import { sanitizeContract } from "./lib/sanitize-contract.js";

/** The knowledge base's own repository, recorded for provenance. */
const knowledgeBaseRepo = "lazslov/knowledge-base";

/** Read the HEAD commit of the knowledge-base checkout, short form. */
function knowledgeBaseCommit(kbPath: string): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: kbPath,
    encoding: "utf8",
  }).trim();
}

function main(): void {
  const kbPath = resolveKnowledgeBase(process.argv[2]);
  const kbCommit = knowledgeBaseCommit(kbPath);
  console.log(`Knowledge base: ${kbPath} @ ${kbCommit}\n`);

  mkdirSync(contractsDir, { recursive: true });
  const contracts: Record<string, ContractProvenance> = {};

  for (const service of services) {
    const upstream = readFileSync(path.join(kbPath, service.id, "openapi.yaml"), "utf8");
    const readme = readFileSync(path.join(kbPath, service.id, "README.md"), "utf8");

    const sanitised = sanitizeContract(upstream, service.exampleHost);
    if (!sanitised.serversReplaced) {
      throw new Error(
        `${service.id}: no top-level servers: block found. The strip rule silently did ` +
          "nothing, which is exactly the failure it exists to prevent — check the contract.",
      );
    }

    writeFileSync(contractPath(service), sanitised.yaml, "utf8");

    contracts[service.id] = {
      kbCommit,
      sourceCommit: readFrontMatterField(readme, "source_commit"),
      verified: readFrontMatterField(readme, "verified"),
    };

    console.log(
      `${service.id.padEnd(16)} servers: templated, ${sanitised.hostRewrites} host(s) rewritten, ` +
        `source ${contracts[service.id]?.sourceCommit} verified ${contracts[service.id]?.verified}`,
    );
  }

  writeContractsManifest({ knowledgeBaseRepo, contracts });
  console.log("\nWrote contracts/CONTRACTS.json");
}

main();
