import { describe, expect, it } from "vitest";
import {
  checkTarball,
  type PackedManifest,
  type TarballContents,
} from "../scripts/lib/tarball-rules.js";

/** The allowlist every package must declare. Kept here so the expectation is spelled out. */
const requiredFiles = ["dist", "README.md", "LICENSE"];

/** A tarball that passes every rule, as the baseline each case deviates from. */
function cleanTarball(overrides: Partial<TarballContents> = {}): TarballContents {
  const manifest: PackedManifest = {
    name: "@lamido/content",
    version: "0.1.0",
    files: requiredFiles,
    dependencies: { "@lamido/api-core": "0.1.0" },
    exports: { ".": { import: "./dist/index.js" } },
  };
  return {
    packageDir: "content",
    files: ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"],
    manifest,
    ...overrides,
  };
}

/** Rule ids of every violation. */
function ruleIds(contents: TarballContents): string[] {
  return checkTarball(contents).map((violation) => violation.rule);
}

describe("the tarball audit", () => {
  it("passes on a well-formed package", () => {
    expect(checkTarball(cleanTarball())).toEqual([]);
  });

  it("fails on a stray file", () => {
    const contents = cleanTarball();
    const withStray = cleanTarball({ files: [...contents.files, "scratch.txt"] });
    expect(ruleIds(withStray)).toContain("expected-contents");
  });

  it("fails on a stray file even when the manifest declares it", () => {
    // Comparing a tarball to its own "files" field proves nothing — npm built the tarball
    // from that field. Both rules must fire, or widening what ships goes unnoticed.
    const contents = cleanTarball();
    const declared = cleanTarball({
      files: [...contents.files, "scratch.txt"],
      manifest: { ...contents.manifest, files: [...requiredFiles, "scratch.txt"] },
    });
    expect(ruleIds(declared)).toEqual(
      expect.arrayContaining(["files-allowlist-declared", "expected-contents"]),
    );
  });

  it("fails when no allowlist is declared, because an ignore list fails open", () => {
    const contents = cleanTarball();
    const noAllowlist = cleanTarball({
      manifest: { ...contents.manifest, files: undefined },
    });
    expect(ruleIds(noAllowlist)).toContain("files-allowlist-declared");
  });

  it("tolerates the files npm always includes", () => {
    expect(checkTarball(cleanTarball({ files: ["package.json", "README", "LICENCE"] }))).toEqual(
      [],
    );
  });

  it.each([
    [".env", "dist/.env"],
    [".npmrc", ".npmrc"],
    ["a pinned contract", "contracts/content-service.openapi.yaml"],
    ["a fixture directory", "dist/fixtures/page.json"],
    ["a test file", "dist/index.test.js"],
  ])("fails on %s", (_label, file) => {
    const contents = cleanTarball();
    const withArtifact = cleanTarball({ files: [...contents.files, file] });
    expect(ruleIds(withArtifact)).toContain("no-forbidden-artifacts");
  });

  it("fails on a runtime dependency other than api-core", () => {
    const contents = cleanTarball();
    const withZod = cleanTarball({
      manifest: { ...contents.manifest, dependencies: { zod: "^3.0.0" } },
    });
    expect(ruleIds(withZod)).toContain("dependency-policy");
  });

  it("passes on an empty dependencies block, as api-core has", () => {
    const contents = cleanTarball();
    expect(
      checkTarball(cleanTarball({ manifest: { ...contents.manifest, dependencies: {} } })),
    ).toEqual([]);
  });

  it("fails on a wildcard export subpath", () => {
    const contents = cleanTarball();
    const withWildcard = cleanTarball({
      manifest: { ...contents.manifest, exports: { ".": "./dist/index.js", "./*": "./dist/*.js" } },
    });
    expect(ruleIds(withWildcard)).toContain("no-wildcard-exports");
  });
});
