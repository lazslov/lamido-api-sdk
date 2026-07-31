/**
 * Extract the knowledge base's JSON examples into committed fixtures.
 *
 * Usage: `pnpm examples:import [kb-path]`
 *
 * The output is committed, and CI re-runs this and asserts the tree is clean — the same guard
 * `generate:types` gets. That is what makes an upstream doc change a *failing build* rather than a
 * fixture set that quietly describes last month's API.
 *
 * Why commit them rather than read the knowledge base at test time: it is not a submodule and its
 * location is a local fact (phase 1 §4), so a suite that needed it could not run in CI or from a clean
 * clone. And the examples must be **sanitised** before they land here at all — the docs carry the real
 * deployment hosts and credential-shaped placeholders that this repository's leak guard rejects on sight.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type DocExample, extractFromHttp, extractFromMarkdown } from "./lib/doc-examples.js";
import { repoRoot, resolveKnowledgeBase, services } from "./lib/paths.js";

/** Where the fixtures live. Flat, one file per service. */
const fixturesDir = path.join(repoRoot, "test", "fixtures", "doc-examples");

/** The knowledge-base checkout, from argv, the environment, or the sibling directory. */
const knowledgeBase = resolveKnowledgeBase(process.argv[2]);

let total = 0;

for (const service of services) {
  const folder = path.join(knowledgeBase, service.id);
  const examples: DocExample[] = [];

  // Sorted, so the committed file is stable across filesystems and the diff means something.
  for (const entry of readdirSync(folder).sort()) {
    const source = () => readFileSync(path.join(folder, entry), "utf8");

    if (entry.endsWith(".md")) examples.push(...extractFromMarkdown(source(), entry));
    else if (entry === "examples.http") examples.push(...extractFromHttp(source(), entry));
  }

  const outputPath = path.join(fixturesDir, `${service.id}.json`);
  writeFileSync(outputPath, `${JSON.stringify(examples, null, 2)}\n`, "utf8");

  total += examples.length;
  console.log(`${service.id.padEnd(16)} ${String(examples.length).padStart(3)} examples`);
}

console.log(`\n${total} examples written to test/fixtures/doc-examples/.`);
