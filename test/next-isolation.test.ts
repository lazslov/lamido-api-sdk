import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageDirs, packagePath } from "../scripts/lib/paths.js";
import { listFiles } from "../scripts/lib/walk.js";

/**
 * `next` is an **optional** peer dependency, so installing any of these packages in an Astro, Remix or
 * plain-Node project must neither warn nor break.
 *
 * @remarks
 * The mechanism is that only the `./next` subpath imports it. That is an invariant about the import
 * graph, and this is where it is checked — by source text, across all four packages at once, because it
 * is the kind of thing one convenient import in a shared module quietly undoes.
 *
 * Phase 7's `examples/node-script` fixture proves the same thing the other way round: a plain CJS
 * `require` of every main entry, in a project with no `next` installed. This suite is what fails first,
 * on the commit that introduces the import, rather than at the end of the phase.
 */

/** Every hand-written source file of one package, with its repo-relative path. */
function sourcesOf(dir: string): { file: string; text: string }[] {
  const src = path.join(packagePath(dir), "src");
  return listFiles(src)
    .filter((file) => file.endsWith(".ts") && !file.includes(`${path.sep}generated${path.sep}`))
    .map((file) => ({
      file: path.relative(packagePath(dir), file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8"),
    }));
}

/** Any `import`/`export … from` or `require()` of a bare `next` specifier. */
const importsNext = /(?:from\s*|require\(\s*)["']next(?:\/[^"']*)?["']/;

describe.each(packageDirs)("packages/%s", (dir) => {
  const sources = sourcesOf(dir);

  it("imports next only from inside a next/ directory", () => {
    const offenders = sources
      .filter(({ file, text }) => !file.startsWith("src/next/") && importsNext.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("keeps the main entry's own module free of it", () => {
    const entry = sources.find(({ file }) => file === "src/index.ts");
    expect(entry, `packages/${dir} has no src/index.ts`).toBeDefined();
    expect(entry?.text).not.toMatch(importsNext);
    // Nor may the main entry re-export the subpath, which would drag it into every consumer's graph.
    expect(entry?.text).not.toMatch(/from\s+"\.\/next\//);
  });
});

describe("the subpaths that do import next", () => {
  it("is @lamido/content/next, and only for next/cache", () => {
    // The whole surface: one namespace import and one named import, both of `next/cache`. A wider
    // reach — `next/headers`, `next/navigation` — would make the adapter care about routing, which is
    // the site's job and not a transport's.
    const specifiers = new Set(
      sourcesOf("content")
        .filter(({ file }) => file.startsWith("src/next/"))
        .flatMap(({ text }) => [...text.matchAll(/from\s*"(next(?:\/[^"]*)?)"/g)].map((m) => m[1])),
    );
    expect([...specifiers]).toEqual(["next/cache"]);
  });

  it("is not @lamido/payment/next, whose handler is a plain Request → Response", () => {
    // Which is why that package declares no peer dependency at all.
    for (const { file, text } of sourcesOf("payment")) {
      expect(text, file).not.toMatch(importsNext);
    }
  });
});
