/**
 * The `url` field predicate, shared by a browser form and a server action.
 *
 * @remarks
 * A plain library module rather than part of the client, because the two halves that need it
 * cannot both live where the other one does: a client component may import a library module,
 * but a server validator must not import a client component.
 */

/**
 * The service's own `url` pattern, mirrored.
 *
 * @remarks
 * **Mirrored deliberately, not invented.** content-service accepts `https://`, `http://`,
 * `mailto:`, `tel:`, a root-relative `/path` and an in-page `#anchor`, and answers `400` for
 * anything else. Rejecting the relative forms would push a site's nav and footer links back into
 * code as hardcoded strings. Do not "improve" this out of sync with the service.
 */
const contentUrl = /^(?:https?:\/\/|mailto:|tel:|\/|#)/;

/**
 * Whether a string is storable in a `url` field.
 *
 * @param value - The submitted value.
 * @returns `true` when the service would accept it.
 * @remarks
 * Note what this rejects: `""` is **not** a valid `url` value. The service has no way to clear a
 * published url — `null` discards a draft, and `""` fails this same pattern there too — so a
 * form should offer "replace", not "clear". Blocking locally is byte-identical to what the
 * service does, with a message the editor can act on instead of one round trip's worth of
 * English they cannot.
 *
 * @example
 * ```ts
 * isValidContentUrl("/rolunk");            // true
 * isValidContentUrl("mailto:a@b.hu");      // true
 * isValidContentUrl("www.example.com");    // false — no scheme
 * ```
 */
export function isValidContentUrl(value: string): boolean {
  return contentUrl.test(value);
}
