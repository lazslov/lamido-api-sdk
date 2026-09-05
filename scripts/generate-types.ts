/**
 * Generate `src/generated/schema.ts` for each service package from its pinned contract.
 *
 * Usage: `pnpm generate:types`
 *
 * The output is committed: a consumer's install must not run a generator, a contract update
 * must be reviewable as a diff, and CI must be able to prove the committed types still
 * match the contract (phase 1 §4, §6).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contractPath, generatedSchemaPath, repoRoot, services } from "./lib/paths.js";

/** Prepended to every generated file, above openapi-typescript's own banner. */
function header(serviceId: string): string {
  return [
    "/*",
    ` * Generated from contracts/${serviceId}.openapi.yaml by \`pnpm generate:types\`.`,
    " * Do not edit: CI regenerates this file and fails on any diff.",
    " *",
    " * These are SHAPES only. Behaviour — what a 404 means, when a retry is safe, what an",
    " * omitted field means — is hand-written from the knowledge base's Markdown and lives in",
    " * each package's curated type aliases. Where the two disagree the Markdown wins.",
    " */",
    "",
  ].join("\n");
}

function main(): void {
  for (const service of services) {
    const output = generatedSchemaPath(service);
    mkdirSync(path.dirname(output), { recursive: true });

    execFileSync(
      "pnpm",
      ["exec", "openapi-typescript", contractPath(service), "--output", output],
      { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" },
    );

    // openapi-typescript writes CRLF-agnostic content; normalise so the committed file is
    // identical on every platform and `git diff --exit-code` means what it says in CI.
    const generated = readFileSync(output, "utf8").replace(/\r\n/g, "\n");

    writeFileSync(output, header(service.id) + generated, "utf8");

    console.log(`${service.id.padEnd(16)} → packages/${service.pkg}/src/generated/schema.ts`);
  }
}

main();
