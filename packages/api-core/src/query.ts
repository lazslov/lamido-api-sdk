/** Query parameters as an endpoint function supplies them. */
export type QueryInit = Record<string, string | number | boolean | null | undefined>;

/**
 * Serialise query parameters.
 *
 * @param query - Parameters. `null` and `undefined` values are dropped entirely.
 * @returns `""` when there is nothing to send, otherwise a string starting with `?`.
 * @remarks
 * Dropping empty values matters: serialising `undefined` produces the literal string
 * `"undefined"`, which a service reads as a real value. Booleans become `"true"` / `"false"`,
 * which is what content-service accepts — it answers `400` for anything else rather than
 * treating it as falsy.
 */
export function buildQuery(query: QueryInit | undefined): string {
  if (!query) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, typeof value === "boolean" ? String(value) : String(value));
  }

  const serialised = params.toString();
  return serialised ? `?${serialised}` : "";
}
