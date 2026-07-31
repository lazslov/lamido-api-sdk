/**
 * Assert the zero-runtime-dependency claim against the **resolved graph**, not against each manifest.
 *
 * Usage: `pnpm deps:audit`
 *
 * `test/package-shape.test.ts` already checks that every `dependencies` block is empty or exactly
 * `@lamido/api-core`. That is a claim about what was *declared*. This is a claim about what a consumer
 * would actually install: it walks each package's production dependency graph transitively, so a
 * dependency arriving *through* api-core — or a `dependencies` entry added to api-core itself — fails
 * here and nowhere else.
 *
 * Phase 7 §exit: "CI is green with zero runtime dependencies reported by `pnpm why` for every package
 * except the single `@lamido/api-core` edge."
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { packageDirs, packagePath, repoRoot } from "./lib/paths.js";

/** The one runtime edge the policy allows, and only from a service package to core. */
const allowedDependency = "@lamido/api-core";

/** One node of `pnpm list --json`'s dependency tree. */
interface ListedPackage {
  readonly from?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, ListedPackage>>;
}

/**
 * What `pnpm list --json` prints for one workspace project.
 *
 * @remarks
 * Note what is deliberately **not** read: `unsavedDependencies`. pnpm reports every package merely
 * *reachable* from the directory there, which in this workspace means the root's own devDependencies —
 * `tsdown`, `publint`, `openapi-typescript` — because Node resolution walks up into the root
 * `node_modules`. They are not declared dependencies of anything and a consumer installs none of them.
 */
interface ListEntry {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, ListedPackage>>;
}

/** One package's manifest, as far as this audit reads it. */
interface Manifest {
  readonly name: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Read one workspace directory's manifest. */
function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(packagePath(dir), "package.json"), "utf8")) as Manifest;
}

/**
 * Resolve one package's production dependency graph.
 *
 * @param dir - Workspace directory under `packages/`.
 * @returns Every package name a consumer would install, transitively.
 * @remarks
 * Run from the repository root with `--filter`, not from the package directory: inside a workspace, an
 * unfiltered `pnpm list` reports the whole workspace and the audit passes or fails for the wrong reason.
 *
 * `--prod` excludes devDependencies and `--depth Infinity` makes the transitive set real rather than one
 * level deep.
 *
 * **A declared peer and everything under it are excluded.** `pnpm list --prod` *does* report a resolved
 * peer — `next` is satisfied here by the repository's own devDependency, and reporting it drags in fifty
 * packages of Next's tree. But an **optional** peer is by definition something the consumer chooses to
 * install: `@lamido/content` in an Astro project pulls in none of it. Counting it would make this audit
 * fail on precisely the arrangement phase 6 was designed to produce.
 */
function resolvedDependencies(dir: string): string[] {
  const manifest = manifestOf(dir);
  const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));

  const raw = execFileSync(
    "pnpm",
    ["list", "--json", "--prod", "--depth", "Infinity", "--filter", manifest.name],
    { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" },
  );

  const entries = JSON.parse(raw) as ListEntry[];
  const found = new Set<string>();

  const walk = (tree: Readonly<Record<string, ListedPackage>> | undefined): void => {
    for (const [name, node] of Object.entries(tree ?? {})) {
      // A cycle is impossible in a resolved tree, but a diamond is not: the guard keeps the walk linear.
      if (found.has(name)) continue;
      // Not descended into either: whatever a peer needs is installed alongside the peer, by the
      // consumer who asked for it.
      if (peers.has(name)) continue;
      found.add(name);
      walk(node.dependencies);
    }
  };

  for (const entry of entries) walk(entry.dependencies);
  return [...found].sort();
}

let failed = false;

for (const dir of packageDirs) {
  const dependencies = resolvedDependencies(dir);
  const unexpected = dependencies.filter((name) => name !== allowedDependency);

  const label = `@lamido/${dir}`.padEnd(20);
  if (unexpected.length > 0) {
    console.error(`${label} ${unexpected.length} unexpected runtime dependency:`);
    for (const name of unexpected) console.error(`  ${name}`);
    failed = true;
    continue;
  }

  console.log(
    `${label} ${dependencies.length === 0 ? "no runtime dependencies" : `only ${allowedDependency}`}.`,
  );
}

if (failed) {
  console.error(
    "\nA published package may depend on nothing but @lamido/api-core, which itself depends on nothing.\n" +
      "Every dependency is a supply-chain edge a consumer inherits without choosing it.",
  );
  process.exit(1);
}

console.log("\nZero runtime dependencies, transitively, across all four packages.");
