import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageDirs, packagePath } from "../scripts/lib/paths.js";
import { checkTarball, type PackedManifest } from "../scripts/lib/tarball-rules.js";

/**
 * The published shape of all four packages, checked from source. `publint`, `attw` and
 * `audit-tarballs` check the built artefact; this suite catches a bad manifest before a
 * build has to happen, and is the one place the four packages are compared to each other.
 */

/** Read one package's manifest. */
function manifestOf(dir: string): PackedManifest & Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(packagePath(dir), "package.json"), "utf8"));
}

/** Import a package's entry point straight from source. */
async function entryOf(dir: string): Promise<{ VERSION?: unknown }> {
  return await import(
    /* @vite-ignore */ path.join(packagePath(dir), "src", "index.ts").replaceAll("\\", "/")
  );
}

describe.each(packageDirs)("packages/%s", (dir) => {
  const manifest = manifestOf(dir);

  it("declares a files allowlist rather than relying on an ignore list", () => {
    expect(manifest.files).toEqual(["dist", "README.md", "LICENSE"]);
  });

  it("passes the tarball rules on its declared shape", () => {
    // Files npm would produce from this manifest; the real audit packs and re-checks.
    expect(
      checkTarball({
        packageDir: dir,
        files: ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"],
        manifest,
      }),
    ).toEqual([]);
  });

  it("depends on nothing but api-core", () => {
    const dependencies = Object.keys(manifest.dependencies ?? {});
    const expected = dir === "api-core" ? [] : ["@lamido/api-core"];
    expect(dependencies).toEqual(expected);
  });

  it("supports the documented minimum runtime", () => {
    expect(manifest.engines).toEqual({ node: ">=18.17" });
  });

  it("is tree-shakeable and ESM-first", () => {
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.type).toBe("module");
  });

  it("exports types for both module systems", () => {
    expect(manifest.exports).toEqual({
      ".": {
        import: { types: "./dist/index.d.ts", default: "./dist/index.js" },
        require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
      },
    });
  });

  it("exports a VERSION matching its package.json", async () => {
    // A release must not ship a constant that disagrees with the tarball it came from.
    const entry = await entryOf(dir);
    expect(entry.VERSION).toBe(manifest.version);
  });
});
