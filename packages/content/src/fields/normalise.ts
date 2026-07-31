/**
 * Per-type validation and normalisation of a **submitted** value, plus the equality test the
 * write preparer diffs with. Internal to the field layer — {@link ./prepare-values.js} is the
 * public door.
 *
 * @remarks
 * Every rule here mirrors one the service enforces, and the mirroring is the point: a rejection
 * the SDK can make locally saves a round trip whose only payload is an English sentence an editor
 * cannot act on. Where a limit appears, it is the service's own.
 */

import { isValidContentUrl } from "./url.js";

/** The outcome of normalising one value. */
export type Normalised =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/** Character limits the service enforces per type. */
const limits = { text: 5_000, richtext: 100_000, url: 2_000, alt: 300 } as const;

/** A form submits strings for everything, so these two types are parsed rather than rejected. */
const numeric = /^-?\d+(?:\.\d+)?$/;

/**
 * Validate and normalise a scalar value for a field or a list column.
 *
 * @param type - The declared type. `list` is handled by the preparer, not here.
 * @param value - What the submission carried.
 * @returns The value to send, or a sentence naming what is wrong with it.
 * @remarks
 * `number` and `boolean` accept their string forms — `"1500"`, `"true"` — because a `FormData`
 * submission has no other shape to offer, and the strict patterns mean `""` is an error rather
 * than a silent `0` or `false`. Everything else is passed through untouched: the SDK does not
 * trim, tidy or truncate an editor's text.
 */
export function normaliseScalar(
  type: "text" | "richtext" | "url" | "number" | "boolean" | "image",
  value: unknown,
): Normalised {
  switch (type) {
    case "text":
    case "richtext":
      if (typeof value !== "string") return bad("must be text");
      return value.length > limits[type]
        ? bad(`is longer than the ${limits[type].toLocaleString("en")} characters allowed`)
        : { ok: true, value };

    case "url":
      if (typeof value !== "string") return bad("must be text");
      if (value.length > limits.url) return bad(`is longer than ${limits.url} characters`);
      // Mirrors the service exactly; see isValidContentUrl for why "" is not valid either.
      return isValidContentUrl(value)
        ? { ok: true, value }
        : bad("must start with https://, http://, mailto:, tel:, / or #");

    case "number": {
      if (typeof value === "number") {
        return Number.isFinite(value) ? { ok: true, value } : bad("must be a finite number");
      }
      if (typeof value === "string" && numeric.test(value))
        return { ok: true, value: Number(value) };
      return bad("must be a number");
    }

    case "boolean":
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true" || value === "false") return { ok: true, value: value === "true" };
      return bad("must be true or false");

    case "image":
      return normaliseImage(value);
  }
}

/**
 * Validate an image reference.
 *
 * @param value - What the submission carried, expected as `{ assetId, alt }`.
 * @returns Exactly those two keys, or a sentence naming what is wrong.
 * @remarks
 * `alt` is **required** and `""` is a legitimate value for it: a decorative image and a forgotten
 * one must stay distinguishable. Only the two keys are kept, which is what the service stores —
 * sending more is not an error there, but dropping them here keeps the diff honest.
 */
export function normaliseImage(value: unknown): Normalised {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return bad("must be an image, as { assetId, alt }");
  }
  const { assetId, alt } = value as { assetId?: unknown; alt?: unknown };
  if (typeof assetId !== "string" || assetId === "") return bad("is missing its assetId");
  if (typeof alt !== "string") {
    return bad('needs alt text — use "" for a decorative image');
  }
  if (alt.length > limits.alt) return bad(`has alt text longer than ${limits.alt} characters`);
  return { ok: true, value: { assetId, alt } };
}

/**
 * Structural equality over the JSON shapes a content value can take.
 *
 * @param a - One value.
 * @param b - The other.
 * @returns `true` when the service would store the same thing for both.
 * @remarks
 * The preparer sends only changed keys, so this decides what "changed" means. Array **order** is
 * significant — reordering a list is an edit — and key order in an object is not.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => sameValue(entry, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameValue(a[key], b[key]))
    );
  }
  return false;
}

/** A plain object, as distinct from an array or `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A failed normalisation. The sentence is completed by the caller with the field's label. */
function bad(error: string): Normalised {
  return { ok: false, error };
}
