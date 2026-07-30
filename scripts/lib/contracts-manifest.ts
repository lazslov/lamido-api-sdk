import { readFileSync, writeFileSync } from "node:fs";
import { contractsManifest } from "./paths.js";

/**
 * Provenance of one pinned contract. `sourceCommit` and `verified` are copied verbatim
 * from the knowledge-base document's YAML front matter; phase 8's drift check compares
 * against them.
 */
export interface ContractProvenance {
  /** Commit of the knowledge-base repository the copy was taken from. */
  readonly kbCommit: string;
  /** Commit of the *service* repository the documentation describes. */
  readonly sourceCommit: string;
  /** Date a human last confirmed the documentation matches the service, `YYYY-MM-DD`. */
  readonly verified: string;
}

/** `contracts/CONTRACTS.json`. */
export interface ContractsManifest {
  readonly knowledgeBaseRepo: string;
  readonly contracts: Readonly<Record<string, ContractProvenance>>;
}

/** Read `contracts/CONTRACTS.json`. */
export function readContractsManifest(): ContractsManifest {
  return JSON.parse(readFileSync(contractsManifest, "utf8")) as ContractsManifest;
}

/** Write `contracts/CONTRACTS.json` with a trailing newline, so diffs stay clean. */
export function writeContractsManifest(manifest: ContractsManifest): void {
  writeFileSync(contractsManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Extract a field from a knowledge-base document's YAML front matter.
 *
 * @param markdown - Full file contents, front matter first.
 * @param field - Key to read, e.g. `source_commit`.
 * @returns The trimmed, unquoted value.
 * @throws If the field is absent — provenance we cannot read is provenance we cannot pin.
 */
export function readFrontMatterField(markdown: string, field: string): string {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  if (!frontMatter) throw new Error("document has no YAML front matter");

  const value = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(frontMatter)?.[1];
  if (!value) throw new Error(`front matter has no "${field}" field`);

  return value.trim().replace(/^["']|["']$/g, "");
}
