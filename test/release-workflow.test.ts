import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../scripts/lib/paths.js";

/**
 * The gates the release workflow must run, and must run *before* it publishes.
 *
 * @remarks
 * Every other suite in this repository protects the packages. This one protects the pipeline,
 * for the same reason `test/audit-detects.test.ts` exists: its failure mode is that it quietly
 * stops guarding and keeps reporting green. A `--provenance` dropped in an unrelated edit, a
 * `workflow_dispatch` input added to "just skip the live suite this once", a publish step moved
 * above the audit — none of those breaks anything that anyone would notice, and all three are
 * permanent once a tarball is on npm.
 *
 * Asserted against the file's text rather than a parsed YAML tree. The claims here are about
 * *ordering* and *absence*, which text answers directly, and it keeps a YAML parser out of the
 * dependency list for one test.
 *
 * @see docs/plans/phase-8-release-and-drift.md §2
 */

const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/**
 * The workflow with its comment lines removed.
 *
 * @remarks
 * The comments explain what is deliberately *absent*, so they name the very things these
 * assertions look for. Checking the raw text would make every such comment a false positive —
 * and the fix for that would be deleting the explanation, which is the wrong direction.
 */
const directives = workflow
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/** Where a command appears in the workflow, for ordering assertions. */
function positionOf(command: string): number {
  const index = directives.indexOf(command);
  expect(index, `the release workflow does not run \`${command}\``).toBeGreaterThan(-1);
  return index;
}

describe("the release workflow", () => {
  it("publishes only from a pushed tag", () => {
    expect(directives).toContain('tags: ["v*"]');
  });

  it("has no manual dispatch, and so no input that could skip a gate", () => {
    expect(directives).not.toContain("workflow_dispatch");
    expect(directives).not.toContain("inputs.");
  });

  it("requests the OIDC token that provenance is signed with", () => {
    expect(directives).toContain("id-token: write");
  });

  it("never cancels a publish half-way", () => {
    // A cancelled run can leave api-core published and the three service packages not.
    expect(directives).toContain("cancel-in-progress: false");
  });

  it("runs the full gate, then the live suite, then publishes — in that order", () => {
    expect(positionOf("pnpm verify")).toBeLessThan(positionOf("pnpm test:live"));
    expect(positionOf("pnpm test:live")).toBeLessThan(positionOf("pnpm release:publish"));
  });

  it("fails the release when the live suite has no credentials", () => {
    // Otherwise every case skips and the step reports the same green as a full pass.
    expect(directives).toContain('LIVE_REQUIRE_CONFIGURED: "true"');
  });

  it("does not let the live suite write", () => {
    // A release must not create a payment. payment-service's preview and production share a
    // database, so "it is only a sandbox" is not a guard.
    expect(directives).not.toContain("LIVE_ALLOW_WRITES");
  });
});

describe("the gate the release composes", () => {
  it("includes the leak audit and the tarball audit", () => {
    // Composed rather than restated in the workflow: a gate added to `verify` is one the release
    // gains automatically. This is the assertion that keeps that indirection honest.
    expect(rootManifest.scripts.verify).toContain("pnpm check:leaks");
    expect(rootManifest.scripts.verify).toContain("pnpm audit:tarballs");
  });

  it("publishes with provenance, and publicly", () => {
    // A scoped package defaults to private; the failure looks like an auth error.
    expect(rootManifest.scripts["release:publish"]).toContain("--provenance");
    expect(rootManifest.scripts["release:publish"]).toContain("--access public");
  });
});
