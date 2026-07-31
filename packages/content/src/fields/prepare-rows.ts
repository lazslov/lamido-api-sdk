/**
 * The `list` half of the write preparer: turning submitted rows into the array the service
 * stores, one declared column at a time.
 *
 * @remarks
 * Separate from {@link ./prepare-values.js} because a list carries every rule a scalar field has
 * plus four of its own — fixed row sets, locked columns addressed by value from code, closed
 * option sets, and a stored option this build has never heard of that must survive a save anyway.
 */

import { type Normalised, normaliseScalar, sameValue } from "./normalise.js";
import type { FieldDescriptor, ListEntryDescriptor } from "./types.js";

/** The service stores at most this many entries per `list` field. */
const maxRows = 200;

/**
 * Validate and normalise a `list` field's submitted rows.
 *
 * @param field - The field descriptor. Its `entry` columns are what gets picked.
 * @param submitted - What the form sent, expected as an array of flat objects.
 * @param stored - The current value, used to decide what counts as a change.
 * @returns The array to send, or a sentence naming the first row and column at fault.
 * @throws `TypeError` when the descriptor itself is malformed — a `list` with no `entry`, or
 * `rowKeys` with no `locked` column. That is a build-time mistake in the site's own table, and
 * reporting it as an editor's validation error would send someone looking in the wrong place.
 */
export function normaliseRows(
  field: FieldDescriptor,
  submitted: unknown,
  stored: unknown,
): Normalised {
  const entry = field.entry;
  if (!entry || entry.length === 0) {
    throw new TypeError(`field "${field.key}" is a list but declares no entry columns`);
  }

  const locked = entry.find((column) => column.locked);
  if (field.rowKeys && !locked) {
    throw new TypeError(`field "${field.key}" declares rowKeys but no locked column to match them`);
  }

  if (!Array.isArray(submitted)) return { ok: false, error: "must be a list of rows" };
  if (submitted.length > maxRows) {
    return { ok: false, error: `has more than the ${maxRows} rows allowed` };
  }

  const storedRows = Array.isArray(stored) ? stored.filter(isRecord) : [];
  const rows: Record<string, unknown>[] = [];

  for (const [index, row] of submitted.entries()) {
    if (!isRecord(row)) return { ok: false, error: `row ${index + 1} is not a set of columns` };

    // Matched by its locked key where there is one: a row's identity is its key, not its index,
    // which is the entire reason `locked` exists.
    const storedRow = locked
      ? storedRows.find((candidate) => candidate[locked.key] === row[locked.key])
      : storedRows[index];

    const picked = pickColumns(entry, row, storedRow, index);
    if (!picked.ok) return picked;
    rows.push(picked.row);
  }

  if (field.rowKeys && locked) {
    const submittedKeys = rows.map((row) => row[locked.key]);
    if (!sameValue(submittedKeys, [...field.rowKeys])) {
      return {
        ok: false,
        error: `must contain exactly these rows, in this order: ${field.rowKeys.join(", ")}`,
      };
    }
  }

  return { ok: true, value: rows };
}

/** One row, reduced to the declared columns. */
type PickedRow =
  | { readonly ok: true; readonly row: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/**
 * Copy the declared columns out of one submitted row.
 *
 * @remarks
 * Iterates `entry`, never the row — so a column the schema gained but this build does not know
 * about cannot reach the wire, and the service's `400` for an unknown entry key is unreachable.
 */
function pickColumns(
  entry: readonly ListEntryDescriptor[],
  row: Record<string, unknown>,
  storedRow: Record<string, unknown> | undefined,
  index: number,
): PickedRow {
  const picked: Record<string, unknown> = {};

  for (const column of entry) {
    const where = `row ${index + 1}, ${column.label}`;
    const present = column.key in row;
    const raw = row[column.key];

    if (!present || raw === undefined || raw === null || raw === "") {
      if (column.required) return { ok: false, error: `${where} is required` };
      // A blank is a real value for prose and nothing else: an empty number, url or image is
      // absence, and the service has no null inside a list entry to express it with.
      if (present && (column.type === "text" || column.type === "richtext"))
        picked[column.key] = "";
      continue;
    }

    const normalised = normaliseScalar(column.type, raw);
    if (!normalised.ok) return { ok: false, error: `${where} ${normalised.error}` };

    // A value outside `options` is refused only when it is a CHANGE. A stored option this build
    // predates — a model that gained an icon — survives a save it was never edited in, instead of
    // being silently rewritten by a form that could not offer it.
    if (
      column.options &&
      !sameValue(normalised.value, storedRow?.[column.key]) &&
      !column.options.includes(String(normalised.value))
    ) {
      return { ok: false, error: `${where} is not one of: ${column.options.join(", ")}` };
    }

    picked[column.key] = normalised.value;
  }

  return { ok: true, row: picked };
}

/** A plain object, as distinct from an array or `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
