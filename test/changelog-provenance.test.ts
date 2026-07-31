import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readContractsManifest } from "../scripts/lib/contracts-manifest.js";
import { packageDirs, packagePath } from "../scripts/lib/paths.js";

/**
 * Every released version says which contract it believes in.
 *
 * @remarks
 * A consumer debugging an integration needs to answer "which version of the contract does my
 * *installed* SDK believe in?" — from `node_modules`, without the repository and without its git
 * history. That is why `CHANGELOG.md` ships inside the tarball and why the top entry names the
 * knowledge-base commit and all three services' `source_commit`.
 *
 * This suite is also the forcing function. `changeset version` prepends a bare `## x.y.z` heading
 * with no provenance, so the release that forgets to add one fails here rather than shipping a
 * changelog that quietly describes nothing.
 *
 * @see docs/plans/phase-8-release-and-drift.md §3
 */

/** The top-most `## <version>` heading and everything under it, up to the next one. */
function latestEntry(changelog: string): { version: string; body: string } {
  // Split rather than match: a lookahead for "the next heading or the end of input" is the one
  // part of this that is easy to write subtly wrong, and a wrong body silently passes.
  const section = changelog.split(/^## /m)[1];
  if (section === undefined) throw new Error("changelog has no version heading");

  const firstBreak = section.indexOf("\n");
  return { version: section.slice(0, firstBreak).trim(), body: section.slice(firstBreak) };
}

const manifest = readContractsManifest();

/** Every commit a changelog entry must name: the knowledge base's, then each service's. */
const requiredCommits = [
  ...new Set(Object.values(manifest.contracts).map((contract) => contract.kbCommit)),
  ...Object.values(manifest.contracts).map((contract) => contract.sourceCommit),
];

describe.each(packageDirs)("packages/%s", (dir) => {
  const root = packagePath(dir);
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const manifestVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    .version as string;
  const entry = latestEntry(changelog);

  it("has an entry for the version it currently declares", () => {
    expect(entry.version).toBe(manifestVersion);
  });

  it.each(requiredCommits)("names %s", (commit) => {
    expect(entry.body).toContain(commit);
  });
});

describe("the provenance requirement", () => {
  it("reads the commits from CONTRACTS.json rather than restating them", () => {
    // Two copies would drift, and the copy that drifted would be this one — which fails open,
    // passing a changelog that names last quarter's contract.
    expect(requiredCommits).toHaveLength(4);
    expect(new Set(requiredCommits).size).toBe(4);
  });

  it("fails a changelog whose top entry has no provenance", () => {
    // What `changeset version` produces on its own, and what must not be publishable.
    const generated = "# @lamido/content\n\n## 0.2.0\n\n### Patch Changes\n\n- abc1234: a fix\n";
    const body = latestEntry(generated).body;
    expect(requiredCommits.some((commit) => body.includes(commit))).toBe(false);
  });
});
