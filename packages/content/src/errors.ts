/**
 * content-service's error envelope, translated once.
 *
 * @remarks
 * The SDK ships the codes, the typed `details` shapes and a `retryable` verdict. It deliberately
 * ships **no copy table**: "this card has 3 payments against it, so archive it instead" is a
 * user-facing sentence in the site's own voice and its own language, and a translation layer in a
 * dependency is one nobody can edit.
 */

import { type ErrorContext, LamidoApiError } from "@lamido/api-core";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "content-service";

/**
 * Every code content-service sends, plus the one it cannot.
 *
 * @remarks
 * Branch on this, never on `message` — a code is part of the contract and a message is written for
 * a human. `not_configured` is the SDK's own, carried on a `status: 0` error when the base URL or
 * key is missing, so a site can route a missing environment variable through the same translator
 * as a real `401`.
 */
export type ContentErrorCode =
  | "validation_error"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "internal_error"
  | "not_configured";

/**
 * The `details` shapes the service documents, all optional.
 *
 * @remarks
 * Optional rather than per-code unions on purpose: `details` is present only where it helps, and a
 * union would force a cast at every read for no added safety. What it buys is that
 * `error.details?.missing` and `.unknownKeys` are spelled correctly and typed.
 */
export interface ContentErrorDetails extends Record<string, unknown> {
  /** Value keys the section or item schema does not declare. The editor's actual work. */
  readonly unknownKeys?: string[];
  /** One entry per badly shaped value, naming the key and (for a list) the entry index. */
  readonly invalid?: { readonly key: string; readonly message: string }[];
  /** `"<section>.<field>"` for each required field that would publish empty. */
  readonly missing?: string[];
  /** Which locales the site publishes, on a bad `locale`; which a publish covered. */
  readonly locales?: string[];
  /** Ids a reorder did not include, and ids it named that do not belong. */
  readonly unknown?: string[];
  /** How many dataset records point at the item a delete refused. */
  readonly recordCount?: number;
  readonly itemId?: string;
  /** Every place an asset is used, in both views — a draft reference is someone's work. */
  readonly references?: unknown[];
  /** The asset already registered under a pathname a registration clashed with. */
  readonly assetId?: string;
  /** Serialised size of a record that exceeded the 8 KB limit. */
  readonly bytes?: number;
  readonly unresolvableRefs?: string[];
}

/**
 * A non-2xx answer from content-service.
 *
 * @remarks
 * Carries no credential, no host and no request body — see `@lamido/api-core`'s `LamidoApiError`.
 *
 * @example
 * ```ts
 * try {
 *   await content.publishPage("home");
 * } catch (error) {
 *   if (error instanceof ContentApiError && error.code === "conflict") {
 *     return { ok: false, missing: error.details?.missing ?? [] };
 *   }
 *   throw error;
 * }
 * ```
 */
export class ContentApiError extends LamidoApiError {
  declare readonly code: ContentErrorCode;
  declare readonly details?: ContentErrorDetails;

  constructor(init: {
    status: number;
    code: ContentErrorCode;
    message: string;
    requestPath: string;
    retryable: boolean;
    details?: ContentErrorDetails;
  }) {
    super({ ...init, service: serviceName });
    this.name = "ContentApiError";
  }
}

/** Codes the service documents. Anything else is a proxy or a bug, not the service. */
const documented = new Set<ContentErrorCode>([
  "validation_error",
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "internal_error",
]);

/**
 * How the service pairs a status with a code, used only when no usable body arrived.
 *
 * @remarks
 * An HTML error page from an edge proxy has no `error.code`, and inventing one from the message
 * would be branching on prose. The status is the only thing left, and this table is the service's
 * own pairing rather than a guess.
 */
const codeByStatus: Readonly<Record<number, ContentErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
};

/**
 * Read the service's error envelope.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status. Typed
 * as returning the narrow error rather than as core's `ErrorParser`, which it still satisfies: a
 * caller reading `details.unknownKeys` should not have to cast at the one place the shape is known.
 */
export const parseContentError = (context: ErrorContext): ContentApiError => {
  const envelope = (
    context.body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null
  )?.error;

  const code = codeFor(context.status, envelope?.code);
  const message =
    typeof envelope?.message === "string"
      ? envelope.message
      : `${serviceName} answered ${context.status}`;

  // Passed through exactly as it arrived: `details` is where the actionable part lives, and
  // re-shaping it here would be a second contract for a caller to learn.
  const details = envelope?.details as ContentErrorDetails | undefined;

  return new ContentApiError({
    status: context.status,
    code,
    message,
    requestPath: context.requestPath,
    retryable: isRetryable(code, context.requestPath, details),
    ...(details === undefined ? {} : { details }),
  });
};

/** The code the service sent, or the one its status implies. */
function codeFor(status: number, raw: unknown): ContentErrorCode {
  if (typeof raw === "string" && documented.has(raw as ContentErrorCode)) {
    return raw as ContentErrorCode;
  }
  return codeByStatus[status] ?? "internal_error";
}

/**
 * Whether retrying the identical request can succeed.
 *
 * @remarks
 * Two cases only, both from the service's own table:
 *
 * - `internal_error` — *"retry once, then report"*.
 * - a **publish** `conflict` with no `missing` list, which is the lost publish race: two publishes
 *   of one page collided on the version number, the transaction was already retried once inside
 *   the service, and the answer is safe to retry **after reloading**. Every other `conflict` — a
 *   required field empty at publish, a duplicate slug, a referenced asset — needs a human to
 *   resolve the stated cause first.
 *
 * Distinguishing the two requires reading `details`, which is why this is not a status lookup. It
 * does not read the message: the sentence about another publish completing first is prose and may
 * be reworded at any time.
 */
function isRetryable(
  code: ContentErrorCode,
  requestPath: string,
  details: ContentErrorDetails | undefined,
): boolean {
  if (code === "internal_error") return true;
  if (code !== "conflict") return false;
  return requestPath.endsWith("/publish") && details?.missing === undefined;
}
