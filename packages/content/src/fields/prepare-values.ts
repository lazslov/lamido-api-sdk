/**
 * `prepareValues` — the highest-value function in this package.
 *
 * @remarks
 * It turns one section's form submission into the `values` map a draft save sends, and every rule
 * it enforces comes from a documented failure rather than from defensive style.
 */

import { type Normalised, normaliseScalar, sameValue } from "./normalise.js";
import { normaliseRows } from "./prepare-rows.js";
import type { ContentDocument, SectionDescriptor } from "./types.js";

/**
 * What {@link prepareValues} produces: a body to send, or errors to render.
 *
 * @remarks
 * A discriminated union rather than a throw, because a thrown server-action message is redacted
 * in production — the editor would get an opaque failure and lose the one thing they needed,
 * which field and why.
 */
export type PreparedValues =
  | {
      readonly ok: true;
      /**
       * Changed keys only, as `` `${section.key}.${field.key}` `` — ready to pass straight to
       * `patchValues`. **May be empty**, and an empty map means make no HTTP call at all.
       */
      readonly values: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      /** One sentence per field, keyed by the **field** key a form's inputs are named after. */
      readonly errors: Record<string, string>;
    };

/**
 * Prepare one section's submission for `patchValues`.
 *
 * @param section - The descriptor table for this section. **This** is what gets iterated.
 * @param submitted - The form's values, keyed by field key. Keys the descriptor does not declare
 * are dropped, not rejected.
 * @param current - The stored values this submission was diffed against — one section's `fields`
 * from a page document. Passed in rather than read, so the caller diffs against the document they
 * rendered from and not against live form state they have been typing into.
 * @returns The changed keys, or per-field errors.
 * @throws `TypeError` when a descriptor is malformed (a `list` with no `entry`, `rowKeys` with no
 * locked column). A build-time mistake, deliberately not an editor-facing error.
 *
 * @remarks
 * Four behaviours, each from something that went wrong once:
 *
 * - **The descriptor is iterated, never the submission.** A server action is a public endpoint,
 *   and the service answers `400` for an unknown value key rather than dropping it silently —
 *   which is correct, because a stripped `"hero.titel"` loses an editor's new headline behind a
 *   `200 OK`. So one stray field would fail the whole save. Iterating the table means a
 *   submission can only ever contain keys the table declared.
 * - **Only changed keys are returned.** A values `PATCH` merges key by key.
 * - **Nothing changed means `{}`, and the caller then makes no request.** Not tidiness: a save is
 *   usually followed by a publish, and **publish carries every other pending draft on the page
 *   live**. An idly pressed Save must not be able to publish someone else's half-finished
 *   section. (The service also rejects an empty `values` map, so the early exit saves a round trip
 *   either way.)
 * - **An unknown stored option survives.** See {@link ./prepare-rows.js}.
 *
 * Two limits worth knowing:
 *
 * - **An `image` key present in a submission always counts as a change.** A read document carries
 *   the resolved `{ url, alt, width, height }` and never the `assetId`, so equality cannot be
 *   proven. Give an image its own save action — a text correction must never publish a photo swap
 *   — and simply leave the key out of a text form's submission.
 * - **A never-set field submitted as `""` is not a change.** An empty `<input>` for a field
 *   nobody has ever filled in is what an untouched form looks like; treating it as an edit would
 *   let opening a form and pressing Save arm a publish across the whole page.
 *
 * @example
 * ```ts
 * const prepared = prepareValues(ABOUT, submitted, page.section("about").fields);
 * if (!prepared.ok) return { ok: false, errors: prepared.errors };
 * if (Object.keys(prepared.values).length === 0) return { ok: true };   // no request at all
 * await content.patchValues("home", prepared.values);
 * ```
 */
export function prepareValues(
  section: SectionDescriptor,
  submitted: Record<string, unknown>,
  current: ContentDocument,
): PreparedValues {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const field of section.fields) {
    if (!(field.key in submitted)) continue;

    const raw = submitted[field.key];
    const stored = current[field.key];

    const normalised: Normalised =
      field.type === "list" ? normaliseRows(field, raw, stored) : normaliseScalar(field.type, raw);

    if (!normalised.ok) {
      errors[field.key] = `${field.label} ${normalised.error}.`;
      continue;
    }

    // An image cannot be diffed against a resolved read, so it is always sent when submitted.
    if (field.type !== "image" && unchanged(normalised.value, stored)) continue;

    values[`${section.key}.${field.key}`] = normalised.value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** Whether sending this value would write what is already stored. */
function unchanged(value: unknown, stored: unknown): boolean {
  if (sameValue(value, stored)) return true;
  // A field the service omits has never been set. An empty input for it is not an edit.
  if (stored !== undefined) return false;
  return value === "" || (Array.isArray(value) && value.length === 0);
}
