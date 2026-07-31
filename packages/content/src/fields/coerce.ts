/**
 * Read coercions: the boundary where a stored value becomes something a component can render
 * without a null check.
 *
 * @remarks
 * Every one of these encodes the same contract — **a half-published site degrades one section at
 * a time.** A field whose value is `null` is omitted by the service, so "absent" is the normal
 * state of a freshly provisioned site and the defaults here *are* the empty-value behaviour.
 *
 * The one thing they must never do is treat a stored `""` or `[]` as absent. Emptying a field is
 * a deliberate editorial action, and "helpfully" falling back to seed copy overrides it.
 */

import type { ContentDocument, ContentImage, ContentRow, ListEntryDescriptor } from "./types.js";

/**
 * A `text` field's value.
 *
 * @param doc - One section's fields, or a collection item's values.
 * @param key - The field key.
 * @returns The stored string, or `""` when the key is absent.
 * @remarks
 * `""` for an absent key **and** for a stored `""` — the two are the same to a component, and
 * distinguishing them would only invite a default that overrides a deliberate blank. A stored
 * value of the wrong shape also reads as `""` rather than throwing: one mistyped field must not
 * take a route down.
 */
export function asText(doc: ContentDocument, key: string): string {
  const value = doc[key];
  return typeof value === "string" ? value : "";
}

/**
 * A `richtext` field's **markdown source**.
 *
 * @param doc - One section's fields, or a collection item's values.
 * @param key - The field key.
 * @returns The stored markdown, or `""` when the key is absent.
 * @remarks
 * Identical behaviour to {@link asText} and separate on purpose: the type of the field decides
 * whether a component pipes the string through a markdown renderer, and nothing in the document
 * says which is which. Naming the coercion at the read site is where that decision gets written
 * down.
 *
 * The SDK ships no renderer. The subset is four rules — `**bold**`, `[text](/path)`, a blank line
 * as a paragraph break, a single newline as a line break — and **never HTML**: a renderer that
 * accepts HTML is the whole security hole, since nothing in the service strips tags.
 */
export function asRichtext(doc: ContentDocument, key: string): string {
  return asText(doc, key);
}

/**
 * An `image` field's resolved value.
 *
 * @param doc - One section's fields, or a collection item's values.
 * @param key - The field key.
 * @returns The image, or `null` when the key is absent or its asset was deleted.
 * @remarks
 * `null` is a real answer, not an error: the service resolves a deleted asset to `null` rather
 * than to a dangling id, so render a placeholder and never a broken `src`. There is no `assetId`
 * here by design — writing alt text back needs one, which is what
 * `getAssetIdByUrl` on the client exists for.
 */
export function asImage(doc: ContentDocument, key: string): ContentImage | null {
  return readImage(doc[key]);
}

/**
 * A `list` field's rows, one column at a time.
 *
 * @param doc - One section's fields, or a collection item's values.
 * @param key - The field key.
 * @param entry - The columns to pick, in display order.
 * @returns One row per stored entry, or `[]` when the key is absent.
 * @remarks
 * Takes `entry` precisely so it can iterate the **descriptor** rather than the row: a column the
 * schema gained but this build does not know about then cannot reach a component. A column the
 * row does not carry is left out, so a component's own `?? ""` applies.
 *
 * An `image` column is resolved the same way {@link asImage} resolves a field.
 */
export function asRows(
  doc: ContentDocument,
  key: string,
  entry: readonly ListEntryDescriptor[],
): ContentRow[] {
  const stored = doc[key];
  if (!Array.isArray(stored)) return [];

  return stored.filter(isRecord).map((row) => {
    const picked: Record<string, unknown> = {};
    for (const column of entry) {
      if (!(column.key in row)) continue;
      picked[column.key] = column.type === "image" ? readImage(row[column.key]) : row[column.key];
    }
    return picked;
  });
}

/** Read a resolved image, whatever shape actually arrived. */
function readImage(value: unknown): ContentImage | null {
  if (!isRecord(value)) return null;
  const { url, alt, width, height } = value;
  if (typeof url !== "string" || typeof alt !== "string") return null;
  return {
    url,
    alt,
    width: typeof width === "number" ? width : null,
    height: typeof height === "number" ? height : null,
  };
}

/** A plain object, as distinct from an array or `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
