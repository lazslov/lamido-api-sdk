/**
 * The revalidation webhook: content-service's one outbound integration point.
 *
 * @remarks
 * Lives in the main entry rather than in `./next`, because the payload and the signature are
 * framework-independent — only the route handler is Next-specific.
 */

import { type VerifyFailure, verifySignedBody } from "@lazslov/api-core";

/** The signature header content-service sends: `sha256=` plus lowercase hex. */
export const signatureHeader = "X-Content-Signature";

/** The timestamp header content-service sends: Unix **seconds**, not milliseconds. */
export const timestampHeader = "X-Content-Timestamp";

/** What a publish delivers. */
export interface RevalidationEvent {
  /**
   * The site slug.
   *
   * @remarks
   * You do **not** need to check it: the signing secret is per site, so a valid signature already
   * proves which tenant sent it. Comparing it as well only adds a way to reject your own deliveries
   * after a slug is renamed.
   */
  readonly site: string;
  readonly type: "page" | "collection_item";
  /**
   * The page slug or the item slug.
   *
   * @remarks
   * **`null` means "revalidate everything"** — an item with no slug, or a staff re-fire sent without
   * one. Treat it as a whole-site invalidation rather than as a malformed delivery.
   */
  readonly slug: string | null;
  /** The collection key for an item; `null` for a page. */
  readonly collection: string | null;
  /**
   * The page's new version.
   *
   * @remarks
   * `null` for a collection item, which has no versions, **and** for a whole-site re-fire — so a
   * receiver that keys off `version` has to tolerate `null` on a page delivery too.
   */
  readonly version: number | null;
  /** ISO 8601 UTC, never null. */
  readonly publishedAt: string;
}

/** The outcome of {@link verifyRevalidationWebhook}. */
export type RevalidationVerdict =
  | { readonly ok: true; readonly event: RevalidationEvent }
  | {
      readonly ok: false;
      /** `"malformed_body"` is this package's own; the rest come from the shared verifier. */
      readonly reason: VerifyFailure | "malformed_body";
    };

/** What the verifier needs. */
export interface RevalidationInput {
  /** The shared secret staff configured for this site. Used whole. */
  readonly secret: string;
  /**
   * The request body **as text**, read before any parsing.
   *
   * @remarks
   * A string and not an object on purpose: `JSON.parse` then re-serialise reorders keys and changes
   * whitespace, and the signature stops matching. In an edge runtime that is the likeliest cause of a
   * `401` on a delivery that is perfectly valid.
   */
  readonly rawBody: string;
  /** The request's headers, or anything with a compatible `get`. */
  readonly headers: Pick<Headers, "get">;
  /** Default 300 seconds, which is what the service documents. */
  readonly toleranceSeconds?: number;
  /** Injectable so a fixture is deterministic. */
  readonly nowSeconds?: number;
}

/**
 * Verify a revalidation delivery, and parse it only if the signature holds.
 *
 * @param input - The secret, the raw body and the request headers.
 * @returns The event on success; a reason on failure. **Never throws.**
 * @remarks
 * The event is reachable *only* through a valid verdict, which is what makes "verify before you
 * parse" structural rather than a rule to remember. A handler maps the failures itself:
 * `stale_timestamp` and `malformed_body` are a `400`, `missing_signature` and `bad_signature` a
 * `401`.
 *
 * The timestamp is inside the signed string on purpose — signing the body alone would let a captured
 * delivery be replayed forever under a fresh header — so a delivery more than five minutes old is
 * rejected even when the digest matches.
 *
 * **Treat a delivery as idempotent.** The service retries once with the identical body, timestamp and
 * signature, and re-signing would only widen the replay window. Two deliveries are one publish.
 *
 * @example
 * ```ts
 * const verdict = await verifyRevalidationWebhook({
 *   secret: process.env.CONTENT_REVALIDATE_SECRET!,
 *   rawBody: await request.text(),
 *   headers: request.headers,
 * });
 * if (!verdict.ok) {
 *   const stale = verdict.reason === "stale_timestamp" || verdict.reason === "malformed_body";
 *   return new Response(verdict.reason, { status: stale ? 400 : 401 });
 * }
 * revalidateTag(CONTENT_TAG);   // the tag your reads set — a mismatch fails silently
 * ```
 */
export async function verifyRevalidationWebhook(
  input: RevalidationInput,
): Promise<RevalidationVerdict> {
  const verdict = await verifySignedBody({
    secret: input.secret,
    rawBody: input.rawBody,
    signature: input.headers.get(signatureHeader),
    timestamp: input.headers.get(timestampHeader),
    ...(input.toleranceSeconds === undefined ? {} : { toleranceSeconds: input.toleranceSeconds }),
    ...(input.nowSeconds === undefined ? {} : { nowSeconds: input.nowSeconds }),
  });

  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const event = parseEvent(input.rawBody);
  return event === null ? { ok: false, reason: "malformed_body" } : { ok: true, event };
}

/**
 * Read the delivery body.
 *
 * @returns The event, or `null` when the body is not one.
 * @remarks
 * Nullable fields are read as nullable rather than defaulted: a `null` slug is a documented
 * whole-site invalidation and a `null` version is documented on two kinds of delivery, so treating
 * either as malformed would reject a valid publish.
 */
function parseEvent(rawBody: string): RevalidationEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;

  if (typeof candidate.site !== "string") return null;
  if (candidate.type !== "page" && candidate.type !== "collection_item") return null;
  if (typeof candidate.publishedAt !== "string") return null;

  return {
    site: candidate.site,
    type: candidate.type,
    slug: typeof candidate.slug === "string" ? candidate.slug : null,
    collection: typeof candidate.collection === "string" ? candidate.collection : null,
    version: typeof candidate.version === "number" ? candidate.version : null,
    publishedAt: candidate.publishedAt,
  };
}
