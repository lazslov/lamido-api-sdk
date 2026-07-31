/**
 * Query parameters as an endpoint function supplies them.
 *
 * @remarks
 * An array value is serialised as a **repeated** parameter, not as a comma-joined one, because
 * that is the form content-service's `eq` filter takes (`?eq=a:1&eq=b:2`, at most three). A
 * service wanting comma-joined values gets a string from its endpoint function instead.
 */
export type QueryInit = Record<
  string,
  string | number | boolean | null | undefined | readonly (string | number | boolean)[]
>;

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
    if (Array.isArray(value)) {
      // Appended in order: a service that caps repeats reports which one it rejected by index.
      for (const entry of value) params.append(key, String(entry));
      continue;
    }
    params.set(key, String(value));
  }

  const serialised = params.toString();
  return serialised ? `?${serialised}` : "";
}
