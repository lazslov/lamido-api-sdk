/**
 * Drop the repeated members an invalid upstream contract produces in `interface operations`.
 *
 * @remarks
 * **This exists for one upstream defect, and it is deliberately unable to hide a second one.**
 *
 * `booking-service/openapi.yaml` shares one operation object between a path's `get` and its `post`
 * through a YAML anchor — `get: &cronJobs … post: *cronJobs`. The alias copies the whole object,
 * `operationId` included, so the resolved document declares `cronDrainJobs`, `cronSyncCalendars`
 * and `cronMaintenance` **twice each**. OpenAPI requires `operationId` to be unique, so the
 * document is invalid, and `openapi-typescript` faithfully emits each member twice — which is
 * `TS2300: Duplicate identifier` and fails the repository's type-check.
 *
 * The three operations are `x-internal: true` cron routes that no consumer calls and no package
 * references. Nothing about the SDK's surface depends on them.
 *
 * Two rules keep this from becoming a place bugs go to die:
 *
 * - It removes a repeat only when the two blocks are **byte-identical**. A genuine collision —
 *   two different operations sharing an id — throws instead, because that is a contract error a
 *   human has to read.
 * - It reports what it removed, so a new duplicate appears in the generator's output rather than
 *   being absorbed in silence.
 *
 * The fix belongs upstream: give the aliased `post` its own `operationId`. Until that lands, the
 * pinned contract stays byte-faithful to the knowledge base and this rewrites only the generated
 * TypeScript.
 */

/** What {@link dedupeOperations} changed. */
export interface DedupeResult {
  /** The rewritten source. */
  readonly source: string;
  /** Each `operationId` whose repeated member was removed, in the order they were found. */
  readonly removed: readonly string[];
}

/** Opening line of the interface the duplicates live in. */
const operationsInterface = "export interface operations {";

/** A top-level member of that interface: four spaces, a name, then `: {`. */
const memberStart = /^ {4}([A-Za-z0-9_$]+): \{$/gm;

/**
 * Remove byte-identical repeats of an `operations` member.
 *
 * @param source - A generated schema module.
 * @returns The rewritten source, and the ids whose repeats were removed.
 * @throws When two members share an id and differ — a real contract collision, not an alias.
 */
export function dedupeOperations(source: string): DedupeResult {
  const interfaceAt = source.indexOf(operationsInterface);
  if (interfaceAt === -1) return { source, removed: [] };

  const head = source.slice(0, interfaceAt);
  const body = source.slice(interfaceAt);

  // Every member's name and where it starts. A member runs to the next member, or to the closing
  // brace of the interface — which is the last line of the file, since `operations` is emitted last.
  const marks = [...body.matchAll(memberStart)].map((match) => ({
    name: match[1] ?? "",
    at: match.index,
  }));
  if (marks.length === 0) return { source, removed: [] };

  // `operations` is the last interface openapi-typescript emits, so its closing brace is the last
  // line that starts at column zero.
  const closing = body.lastIndexOf("\n}");

  /**
   * One member's text, normalised to end in exactly one newline.
   *
   * @remarks
   * The last member runs to the interface's closing brace rather than to another member, so its raw
   * text ends differently from every other. Normalising is what makes "identical" mean the same
   * thing for the last member as for the rest — without it, a duplicate that happens to be last
   * always looks like a collision.
   */
  const blockOf = (index: number): string => {
    const next = index + 1 < marks.length ? marks[index + 1]?.at : closing;
    return `${body.slice(marks[index]?.at, next).trimEnd()}\n`;
  };

  const first = new Map<string, string>();
  const removed: string[] = [];
  const kept: string[] = [];

  for (let index = 0; index < marks.length; index += 1) {
    const name = marks[index]?.name ?? "";
    const block = blockOf(index);
    const earlier = first.get(name);

    if (earlier === undefined) {
      first.set(name, block);
      kept.push(block);
      continue;
    }
    if (earlier !== block) {
      throw new Error(
        `operations.${name} is declared twice with different shapes. That is a contract error, ` +
          "not a YAML alias — read the document rather than regenerating.",
      );
    }
    removed.push(name);
  }

  if (removed.length === 0) return { source, removed: [] };

  // `closing + 1` skips the newline the last kept block now supplies.
  return {
    source: head + body.slice(0, marks[0]?.at) + kept.join("") + body.slice(closing + 1),
    removed,
  };
}
