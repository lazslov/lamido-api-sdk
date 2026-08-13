/**
 * The server-action error shape.
 *
 * @remarks
 * > **RULE — a write action returns a result object; it never throws.** A thrown server-action message
 * > is **redacted in production**, so a rejected save reaches the editor as an opaque generic failure
 * > and the one piece of information they needed — *which field, and why* — is gone.
 *
 * This module ships the plumbing for that and **no user-facing copy.** "This card has 3 payments
 * against it, so archive it instead" is a sentence in the site's own voice and its own language, and a
 * translation layer inside a dependency is one nobody can edit.
 */

import { NotConfiguredError, type ProblemType } from "@lazslov/api-core";
import { ContentApiError } from "../errors.js";

/**
 * What a write action reports when it fails.
 *
 * @remarks
 * The service's problem slug, plus this SDK's own `not_configured` for a missing base URL or key.
 */
export type SaveErrorCode = ProblemType | "not_configured";

/**
 * What a write action returns.
 *
 * @remarks
 * `error` is the service's **stable problem slug**, not prose — switch on it to pick your own
 * sentence. The SDK deliberately does not put a message here that a site would be tempted to
 * render.
 */
export type SaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * The problem slug. Branch on this.
       *
       * @remarks
       * `not_configured` arrives through the same channel as a real `401`, thanks to core's `status: 0`
       * sentinel — so a site needs one translator, not two. A thrown value that is not a
       * {@link ContentApiError} at all reports `internal`, because from the editor's side an SDK
       * bug and a server fault are the same event.
       *
       * A slug does not always identify the failure on its own: `conflict` covers both a `409`
       * duplicate and a `422` wrong-state. Catch the error itself where the difference matters.
       */
      readonly error: SaveErrorCode;
      /**
       * Per-field messages, keyed by field.
       *
       * @remarks
       * Present when the service answered `validation` with something field-shaped, so a form can
       * render errors next to inputs instead of one toast. The messages are the service's own English
       * and are meant for a developer reading them during a build; render your own copy where the key
       * matters and treat these as the fallback.
       *
       * For the exact location of every failure — including ones inside nested values — read
       * `error.errors`, the RFC 9457 field-error array, whose `pointer` is a JSON Pointer into the
       * body. This map is the form-shaped summary of it.
       *
       * A publish `conflict` is not mapped here: its `details.missing` entries are `"<section>.<field>"`
       * paths across a whole page rather than fields of the form that was just submitted, and each one
       * wants to be a link. Read `error.details.missing` off the caught error for that.
       */
      readonly fields?: Record<string, string>;
    };

/**
 * Run a write action's body and turn any failure into a {@link SaveResult}.
 *
 * @param fn - The action's work: prepare, write, revalidate.
 * @returns `{ ok: true }`, or a structured failure. **Never throws** and never rejects.
 * @remarks
 * Logs the failure server-side before swallowing it, because the result object deliberately carries no
 * prose and a silently-dropped stack is how a save failure becomes unreproducible.
 *
 * @example
 * ```ts
 * "use server";
 * export async function saveAbout(submitted: Record<string, unknown>): Promise<SaveResult> {
 *   const prepared = prepareValues(ABOUT, submitted, page.section("about").fields);
 *   if (!prepared.ok) return { ok: false, error: "validation_error", fields: prepared.errors };
 *   if (Object.keys(prepared.values).length === 0) return { ok: true };   // nothing changed
 *
 *   return asSaveResult(async () => {
 *     await client.patchValues("home", prepared.values);
 *     revalidateAfterWrite(tag);
 *   });
 * }
 * ```
 */
export async function asSaveResult(fn: () => Promise<unknown>): Promise<SaveResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    // Server-side only. The editor gets a code; whoever is on call gets the stack.
    console.error("[@lazslov/content] a write action failed:", error);

    // Checked separately because it is core's class, not this package's: `resolveConfig` throws it
    // before any service-specific parser runs. Its `status: 0` sentinel is the whole reason a site
    // needs one translator rather than two, so it must not collapse into `internal_error`.
    if (error instanceof NotConfiguredError) return { ok: false, error: "not_configured" };
    if (!(error instanceof ContentApiError)) return { ok: false, error: "internal" };

    const fields = fieldsFrom(error);
    return { ok: false, error: error.type, ...(fields === undefined ? {} : { fields }) };
  }
}

/**
 * Map a `validation_error`'s details onto field names.
 *
 * @returns One entry per field the service named, or `undefined` when it named none.
 * @remarks
 * Two documented shapes, and both are field-shaped:
 *
 * - `unknown_keys` — value keys the section's schema does not declare. Usually a renamed field or a
 *   stale form, and the editor's actual work is elsewhere; the message says so.
 * - `invalid[]` — one entry per badly shaped value, already carrying the key and a reason.
 *
 * `invalid` wins on a collision, because it explains *why* and `unknown_keys` only says *which*.
 */
function fieldsFrom(error: ContentApiError): Record<string, string> | undefined {
  if (error.type !== "validation") return undefined;

  const fields: Record<string, string> = {};

  for (const key of error.details?.unknown_keys ?? []) {
    fields[key] = "This field is not part of the section's schema.";
  }
  for (const entry of error.details?.invalid ?? []) {
    fields[entry.key] = entry.message;
  }

  return Object.keys(fields).length === 0 ? undefined : fields;
}
