/**
 * The assertions phase 1 §5.2 makes about a packed tarball, as pure functions over an
 * already-extracted file list. Kept separate from the script that packs so they are
 * directly testable without a `pnpm pack` round trip.
 */

/** The parts of a packed `package.json` these rules care about. */
export interface PackedManifest {
  readonly name?: string;
  readonly version?: string;
  readonly files?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
}

/** One extracted tarball, described. */
export interface TarballContents {
  /** Workspace directory the tarball was built from, for error messages. */
  readonly packageDir: string;
  /** Every file path in the tarball, relative to the package root, using `/`. */
  readonly files: readonly string[];
  readonly manifest: PackedManifest;
}

/** A failed assertion. */
export interface Violation {
  readonly rule: string;
  readonly detail: string;
}

/**
 * The only runtime dependency any published package may declare.
 * @see docs/plans/phase-1-foundations.md §2
 */
const allowedDependency = "@lamido/api-core";

/**
 * Files npm includes whatever `"files"` says, so they are not evidence of a broken
 * allowlist. Matched case-insensitively against the first path segment.
 */
const alwaysIncluded = [/^package\.json$/i, /^readme(\..+)?$/i, /^licen[cs]e(\..+)?$/i];

/**
 * The `"files"` allowlist every published package must declare, exactly.
 *
 * @remarks
 * Checked against a fixed expectation rather than against whatever the manifest happens to
 * say. Comparing a tarball to its own `"files"` field proves nothing — npm built the tarball
 * *from* that field, so the check could never fail. Widening what ships therefore takes a
 * deliberate edit here, which is a reviewable diff.
 */
const requiredFilesField = ["dist", "README.md", "LICENSE"];

/** Top-level entries a tarball may contain, besides the ones npm force-includes. */
const expectedEntries = new Set(["dist"]);

/** Paths that must never be packed, whatever the allowlist happens to permit. */
const forbiddenArtifacts: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /(^|\/)\.env($|\.)/i, why: "an environment file" },
  { pattern: /(^|\/)\.npmrc$/i, why: "an npm config that can carry an auth token" },
  { pattern: /^contracts\//i, why: "a pinned upstream contract" },
  { pattern: /(^|\/)(test|tests|__tests__|fixtures)\//i, why: "a test or fixture directory" },
  { pattern: /\.test\.[cm]?[jt]sx?$/i, why: "a test file" },
  // Matched by name wherever it sits, not only under `contracts/`. `servers:` is stripped on import, so
  // a packed contract is not automatically a leak — but the document has no business shipping either
  // way, and the rule that catches it must not depend on which directory someone copied it into.
  {
    pattern: /\.(openapi|swagger)\.ya?ml$|(^|\/)(openapi|swagger)\.(ya?ml|json)$/i,
    why: "an OpenAPI document, which no consumer needs and which carries upstream host templates",
  },
  // A tsconfig names paths on the machine that built it and is not part of a published surface.
  { pattern: /(^|\/)tsconfig(\..+)?\.json$/i, why: "a TypeScript config" },
];

/** True when a first path segment is one npm force-includes. */
function isAlwaysIncluded(segment: string): boolean {
  return alwaysIncluded.some((pattern) => pattern.test(segment));
}

/**
 * Check one extracted tarball against every phase 1 §5.2 rule except the string scan,
 * which needs file contents and lives in {@link ../lib/forbidden-strings.ts}.
 *
 * @param contents - The extracted tarball.
 * @returns One violation per problem; empty means the tarball is publishable.
 */
export function checkTarball(contents: TarballContents): Violation[] {
  const violations: Violation[] = [];
  const { files, manifest } = contents;

  // An .npmignore fails open — a new directory ships unless someone remembers to exclude
  // it. Declaring "files", and declaring exactly this, is what makes the boundary fail closed.
  const declared = [...(manifest.files ?? [])].sort();
  if (JSON.stringify(declared) !== JSON.stringify([...requiredFilesField].sort())) {
    violations.push({
      rule: "files-allowlist-declared",
      detail: `"files" must be exactly [${requiredFilesField.join(", ")}]; found [${declared.join(", ")}]`,
    });
  }

  for (const file of files) {
    const segment = file.split("/")[0] ?? file;
    if (!expectedEntries.has(segment) && !isAlwaysIncluded(segment)) {
      violations.push({
        rule: "expected-contents",
        detail: `${file} is not something a published package should contain`,
      });
    }
  }

  for (const file of files) {
    const match = forbiddenArtifacts.find((artifact) => artifact.pattern.test(file));
    if (match) {
      violations.push({
        rule: "no-forbidden-artifacts",
        detail: `${file} is ${match.why} and must never be packed`,
      });
    }
  }

  const dependencies = Object.keys(manifest.dependencies ?? {});
  const unexpected = dependencies.filter((name) => name !== allowedDependency);
  if (unexpected.length > 0) {
    violations.push({
      rule: "dependency-policy",
      detail: `dependencies must be empty or exactly ${allowedDependency}; found ${unexpected.join(", ")}`,
    });
  }

  // A wildcard subpath makes every internal module part of the public API, so a refactor
  // becomes a breaking change for whoever deep-imported it.
  const wildcardSubpaths = exportSubpaths(manifest.exports).filter((subpath) =>
    subpath.includes("*"),
  );
  if (wildcardSubpaths.length > 0) {
    violations.push({
      rule: "no-wildcard-exports",
      detail: `exports must name every entry point; found ${wildcardSubpaths.join(", ")}`,
    });
  }

  return violations;
}

/** The subpath keys of an `exports` map, or an empty list for any other shape. */
function exportSubpaths(exportsField: unknown): string[] {
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) return [];
  return Object.keys(exportsField).filter((key) => key.startsWith("."));
}
