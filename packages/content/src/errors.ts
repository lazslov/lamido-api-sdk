/**
 * content-service's problem document, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse itself is `@lazslov/api-core`'s: the three services share one RFC 9457 document over
 * one closed slug set, so reading it here again would be a second chance to disagree. What this
 * module adds is the typed `details` shape and the one retry verdict core cannot reach — the
 * lost publish race.
 *
 * It deliberately ships **no copy table**: "this card has 3 payments against it, so archive it
 * instead" is a user-facing sentence in the site's own voice and its own language, and a
 * translation layer in a dependency is one nobody can edit.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "content-service";

/**
 * The `details` shapes the service documents, all optional.
 *
 * @remarks
 * Optional rather than per-slug unions on purpose: `details` is present only where it helps, and
 * a union would force a cast at every read for no added safety. What it buys is that
 * `error.details?.missing` and `.unknown_keys` are spelled correctly and typed.
 *
 * **Members are snake_case**, like every other member on the wire. They were camelCase before
 * the service's 2026-08 sync.
 */
export interface ContentErrorDetails extends Record<string, unknown> {
  /** Value keys the section or item schema does not declare. The editor's actual work. */
  readonly unknown_keys?: string[];
  /** One entry per badly shaped value, naming the key and (for a list) the entry index. */
  readonly invalid?: { readonly key: string; readonly message: string }[];
  /** `"<section>.<field>"` for each required field that would publish empty. */
  readonly missing?: string[];
  /** Which locales the site publishes, on a bad `locale`; which a publish covered. */
  readonly locales?: string[];
  /** Ids a reorder did not include, and ids it named that do not belong. */
  readonly unknown?: string[];
  /** How many dataset records point at the item a delete refused. */
  readonly record_count?: number;
  readonly item_id?: string;
  /** Every place an asset is used, in both views — a draft reference is someone's work. */
  readonly references?: unknown[];
  /** The asset already registered under a pathname a registration clashed with. */
  readonly asset_id?: string;
  /** Serialised size of a record that exceeded the 8 KB limit. */
  readonly bytes?: number;
  readonly unresolvable_refs?: string[];
  /** Which fields a dataset aggregate can group by, on a bad `group_by`. */
  readonly groupable?: string[];
}

/**
 * A non-2xx answer from content-service.
 *
 * @remarks
 * Carries no credential, no host and no request body — see `@lazslov/api-core`'s
 * `LamidoApiError`. Branch on `type` paired with `status`, never on `message`.
 *
 * @example
 * ```ts
 * try {
 *   await content.publishPage("home");
 * } catch (error) {
 *   if (error instanceof ContentApiError && error.type === "conflict") {
 *     return { ok: false, missing: error.details?.missing ?? [] };
 *   }
 *   throw error;
 * }
 * ```
 */
export class ContentApiError extends LamidoApiError {
  declare readonly details?: ContentErrorDetails;

  constructor(init: ConstructorParameters<typeof LamidoApiError>[0]) {
    super(init);
    this.name = "ContentApiError";
  }
}

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 * Typed as returning the narrow error rather than as core's `ErrorParser`, which it still
 * satisfies: a caller reading `details.unknown_keys` should not have to cast at the one place
 * the shape is known.
 */
export const parseContentError = (context: ErrorContext): ContentApiError => {
  const init = readProblem(serviceName, context);
  return new ContentApiError({
    ...init,
    retryable: init.retryable || isLostPublishRace(init, context.requestPath),
  });
};

/**
 * The one retry verdict core cannot reach on its own.
 *
 * @remarks
 * A **publish** `conflict` with no `missing` list is the lost publish race: two publishes of one
 * page collided on the version number, the transaction was already retried once inside the
 * service, and the answer is safe to retry **after reloading**. Every other `409 conflict` — a
 * required field empty at publish, a duplicate slug, a referenced asset — needs a human to
 * resolve the stated cause first, which is why core's flat "409 is not retryable" is right for
 * everything except this.
 *
 * It reads `details` rather than the message: the sentence about another publish completing
 * first is prose and may be reworded at any time.
 */
function isLostPublishRace(
  init: { readonly type: string; readonly status: number; readonly details?: unknown },
  requestPath: string,
): boolean {
  if (init.type !== "conflict" || init.status !== 409) return false;
  if (!requestPath.endsWith("/publish")) return false;
  return (init.details as ContentErrorDetails | undefined)?.missing === undefined;
}
