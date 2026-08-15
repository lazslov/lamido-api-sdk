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
    expect(manifest.files).toEqual(["dist", "README.md", "LICENSE", "CHANGELOG.md"]);
  });

  it("passes the tarball rules on its declared shape", () => {
    // Files npm would produce from this manifest; the real audit packs and re-checks.
    expect(
      checkTarball({
        packageDir: dir,
        files: [
          "package.json",
          "README.md",
          "LICENSE",
          "CHANGELOG.md",
          "dist/index.js",
          "dist/index.d.ts",
        ],
        manifest,
      }),
    ).toEqual([]);
  });

  it("depends on nothing but api-core", () => {
    const dependencies = Object.keys(manifest.dependencies ?? {});
    // Two packages stand alone: api-core is the bottom of the graph, and telemetry is
    // deliberately import-free so a service can vendor it as one file (OB-7). The three
    // contract-backed packages take api-core and nothing else.
    const standalone = dir === "api-core" || dir === "telemetry";
    expect(dependencies).toEqual(standalone ? [] : ["@lazslov/api-core"]);
  });

  it("supports the documented minimum runtime", () => {
    expect(manifest.engines).toEqual({ node: ">=20.19" });
  });

  it("is tree-shakeable and ESM-first", () => {
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.type).toBe("module");
  });

  it("exports types for both module systems, on every subpath it declares", () => {
    // Named per condition rather than through one shared "types" key: that is what makes `attw`
    // clean on all four resolution modes. A subpath arrives with the phase that builds it, so the
    // expectation is derived from the declared keys rather than fixed at one entry.
    const entries = Object.entries(manifest.exports as Record<string, unknown>);
    expect(entries.length).toBeGreaterThan(0);

    for (const [subpath, conditions] of entries) {
      const stem = subpath === "." ? "index" : `${subpath.slice(2)}/index`;
      expect(conditions).toEqual({
        import: { types: `./dist/${stem}.d.ts`, default: `./dist/${stem}.js` },
        require: { types: `./dist/${stem}.d.cts`, default: `./dist/${stem}.cjs` },
      });
    }
  });

  it("declares only the subpaths its phase has built", () => {
    const subpaths: Record<string, string[]> = {
      content: [".", "./fields", "./next"],
      payment: [".", "./next"],
    };
    expect(Object.keys(manifest.exports as Record<string, unknown>)).toEqual(
      subpaths[dir] ?? ["."],
    );
  });

  it("declares next as an optional peer only where a subpath imports it", () => {
    // `@lazslov/content/next` imports `next/cache`. `@lazslov/payment/next` does not — its handler takes
    // a `Request` and answers a `Response` — so claiming a peer there would be a warning a consumer
    // cannot act on. Optional, so installing either package in an Astro or plain-Node project is quiet.
    const peers = manifest.peerDependencies as Record<string, string> | undefined;
    const meta = manifest.peerDependenciesMeta as
      | Record<string, { optional?: boolean }>
      | undefined;

    if (dir === "content") {
      expect(peers).toEqual({ next: ">=14" });
      expect(meta).toEqual({ next: { optional: true } });
    } else {
      expect(peers).toBeUndefined();
      expect(meta).toBeUndefined();
    }
  });

  it("maps every subpath for the legacy resolver too", () => {
    // A pre-`exports` TypeScript resolution reads "typesVersions" and nothing else, so a subpath
    // missing from it resolves to no types at all — which is what `attw`'s node10 column reports.
    const subpaths = Object.keys(manifest.exports as Record<string, unknown>).filter(
      (subpath) => subpath !== ".",
    );
    const mapped =
      (manifest.typesVersions as Record<string, Record<string, string[]>>)?.["*"] ?? {};

    for (const subpath of subpaths) {
      const name = subpath.slice(2);
      expect(mapped[name], `${subpath} is missing from typesVersions`).toEqual([
        `./dist/${name}/index.d.ts`,
      ]);
    }
    expect(Object.keys(mapped)).toEqual(subpaths.map((subpath) => subpath.slice(2)));
  });

  it("exports a VERSION matching its package.json", async () => {
    // A release must not ship a constant that disagrees with the tarball it came from.
    const entry = await entryOf(dir);
    expect(entry.VERSION).toBe(manifest.version);
  });
});
