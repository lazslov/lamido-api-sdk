/**
 * What changed between a pinned contract and the knowledge base's current one.
 *
 * @remarks
 * The drift *detector* only needs to answer yes or no, and `check-contract-drift.ts` did that
 * with a string comparison long before this file existed. What an issue needs is the next
 * question: **which** operations and schemas moved, so that whoever reads it knows which
 * Markdown to re-read.
 *
 * That distinction is the whole point of the protocol. A regenerated `schema.ts` with unchanged
 * hand-written wrappers is the most likely way this SDK becomes subtly wrong — the types compile,
 * the tests pass, and the *behaviour* the wrappers encode is now a quarter out of date. Naming the
 * operations is what turns "regenerate the types" into "go and read `client-api.md §6`".
 *
 * @see docs/plans/phase-8-release-and-drift.md §3
 */
import { parse } from "yaml";

/** The HTTP verbs OpenAPI treats as operations. Anything else under a path is metadata. */
const httpMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** Added, removed and modified names in one category. */
export interface NameChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/** Everything that moved between two versions of one contract. */
export interface ContractDiff {
  readonly operations: NameChanges;
  readonly schemas: NameChanges;
}

/** True when a diff found nothing — the two documents describe the same API. */
export function isUnchanged(diff: ContractDiff): boolean {
  return [diff.operations, diff.schemas].every(
    (category) => category.added.length + category.removed.length + category.changed.length === 0,
  );
}

/** An OpenAPI document, reduced to the two maps this comparison reads. */
interface Indexed {
  readonly operations: Map<string, unknown>;
  readonly schemas: Map<string, unknown>;
}

/**
 * Index one document by operation and by schema name.
 *
 * @param yaml - A full OpenAPI document.
 * @returns `GET /api/pages/{slug}` → its operation object, and each `components.schemas` entry.
 * @throws If the document does not parse. A contract that cannot be read is drift worth failing on.
 */
function index(yaml: string): Indexed {
  const document = parse(yaml) as {
    paths?: Record<string, Record<string, unknown>>;
    components?: { schemas?: Record<string, unknown> };
  };

  const operations = new Map<string, unknown>();
  for (const [route, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (httpMethods.has(method)) operations.set(`${method.toUpperCase()} ${route}`, operation);
    }
  }

  return { operations, schemas: new Map(Object.entries(document.components?.schemas ?? {})) };
}

/** Compare two name→definition maps. */
function compare(pinned: Map<string, unknown>, upstream: Map<string, unknown>): NameChanges {
  const added = [...upstream.keys()].filter((name) => !pinned.has(name));
  const removed = [...pinned.keys()].filter((name) => !upstream.has(name));

  // Structural equality by serialisation. The two documents come through the same parser and the
  // same sanitiser, so key order is the upstream author's in both — a reordered object is a real
  // edit to the file, and reporting it is the safe direction to be wrong in.
  const changed = [...upstream.keys()].filter(
    (name) =>
      pinned.has(name) && JSON.stringify(pinned.get(name)) !== JSON.stringify(upstream.get(name)),
  );

  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/**
 * Diff a pinned contract against the knowledge base's current one.
 *
 * @param pinnedYaml - The copy under `contracts/`.
 * @param upstreamYaml - The knowledge base's, sanitised the same way — otherwise the host
 * template shows up as a change on every run and the report becomes noise nobody reads.
 */
export function diffContracts(pinnedYaml: string, upstreamYaml: string): ContractDiff {
  const pinned = index(pinnedYaml);
  const upstream = index(upstreamYaml);

  return {
    operations: compare(pinned.operations, upstream.operations),
    schemas: compare(pinned.schemas, upstream.schemas),
  };
}

/** One category as Markdown list items, or nothing when it is empty. */
function section(title: string, changes: NameChanges): string[] {
  const lines: string[] = [];
  for (const [label, names] of [
    ["Added", changes.added],
    ["Removed", changes.removed],
    ["Changed", changes.changed],
  ] as const) {
    if (names.length === 0) continue;
    lines.push(`**${title} — ${label.toLowerCase()}**`, "");
    lines.push(...names.map((name) => `- \`${name}\``));
    lines.push("");
  }
  return lines;
}

/**
 * Render one service's diff as the body of a drift issue.
 *
 * @param service - Knowledge-base folder name, used as the heading.
 * @param diff - What moved.
 * @returns Markdown, ending without a trailing blank line.
 */
export function formatDiff(service: string, diff: ContractDiff): string {
  const body = [...section("Operations", diff.operations), ...section("Schemas", diff.schemas)];
  if (body.length === 0) {
    return `### ${service}\n\nThe contract is byte-different but no operation or schema moved — a\ndescription, an example or a comment changed.`;
  }
  return [`### ${service}`, "", ...body].join("\n").trimEnd();
}
