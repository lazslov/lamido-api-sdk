/**
 * The revalidation route handler.
 *
 * @remarks
 * Four lines of real work wrapped around one ordering rule: **read the raw body before anything
 * parses it.** The signature covers the bytes as they arrived, and `JSON.parse` then re-serialise
 * reorders keys and changes whitespace — which is the likeliest cause of a `401` on a delivery that
 * is perfectly valid.
 */

import { revalidateTag } from "next/cache";
import { readEnv, revalidateSecretVar } from "../env.js";
import { type ContentEvent, verifyContentWebhook } from "../webhook.js";
import { CONTENT_TAG } from "./tag.js";

/** What {@link createRevalidationHandler} accepts. */
export interface RevalidationHandlerOptions {
  /**
   * The shared secret the service signs with.
   *
   * @remarks
   * Defaults to `CONTENT_REVALIDATE_SECRET`, read **per request** rather than at construction. A route
   * module that threw on import would take the whole route tree down, and would stop a site building at
   * all with an empty environment — which is how a new contributor runs the project. An unset secret is
   * a `500` on delivery instead, with the variable named.
   */
  readonly secret?: string;
  /**
   * The tag to bust.
   *
   * @remarks
   * Defaults to {@link CONTENT_TAG}, which is the same constant `createNextContentGateway` defaults to.
   * **It must be the tag your reads set.** If you overrode it on the gateway, pass the gateway's `tag`
   * here — a mismatch answers `200`, invalidates nothing, and produces no error anywhere.
   */
  readonly tag?: string;
  /**
   * Called after the tag is busted, with the verified event.
   *
   * @remarks
   * Must be **fast**, and must not be the only path by which the site learns something changed: a
   * delivery is retried once and then given up on, and a failure never fails the publish — the content
   * is live either way.
   */
  readonly onPublish?: (event: ContentEvent) => void | Promise<void>;
  /** Passed to the verifier. Defaults to the 300 seconds the service documents. */
  readonly toleranceSeconds?: number;
}

/**
 * Build the `POST` handler for `/api/revalidate`.
 *
 * @param options - The secret, the tag and an optional callback.
 * @returns A handler taking a `Request` and answering a `Response`. Assign it to `POST`.
 * @remarks
 * The order is the contract:
 *
 * 1. `request.text()` — before any parse, because the signature is over raw bytes;
 * 2. verify — a stale timestamp or an unparseable body is a `400`, a missing or bad signature a `401`;
 * 3. `revalidateTag(tag)`;
 * 4. `onPublish`, then `200`.
 *
 * **`tenant` is not checked, and that is deliberate.** The signing secret is per endpoint, so a valid
 * signature already proves who sent it. Comparing the field as well only adds a way to reject
 * your own deliveries — so the check is absent, and this comment is here so nobody adds one.
 *
 * **Every event type busts the tag, including one this SDK has never heard of.** The catalogue is
 * `page.published`, `collection_item.published`, `collection_item.archived`, `record.created` and
 * `site.revalidation_requested`, and it grows. A receiver that answered non-2xx for an unrecognised
 * type would dead-letter a delivery that was fine, and five of those disable the endpoint. The
 * single coarse tag makes every one of them the same invalidation, so there is nothing to branch on
 * here; `onPublish` is where a caller does finer work, and {@link ../webhook.js | subjectOf} finds
 * the subject of any event without a per-type branch.
 *
 * **Treat delivery as idempotent.** The service retries, and an operator can redeliver; both carry
 * the same `X-Event-Id`. Busting the same tag twice costs nothing, so there is no dedupe here —
 * unlike the payment handler, where the work is not idempotent. A caller whose `onPublish` does
 * non-idempotent work should dedupe on `event.event_id` itself.
 *
 * @example
 * ```ts
 * // app/api/revalidate/route.ts
 * import { createRevalidationHandler } from "@lazslov/content/next";
 * import { tag } from "@/lib/content";
 *
 * export const POST = createRevalidationHandler({ tag });
 * ```
 */
export function createRevalidationHandler(
  options: RevalidationHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const tag = options.tag ?? CONTENT_TAG;

  return async function handleRevalidation(request: Request): Promise<Response> {
    const secret = options.secret ?? readEnv(revalidateSecretVar);
    if (!secret) {
      // Not a delivery problem, so it is not a 4xx: the sender is behaving and this deployment is not.
      return text(500, `${revalidateSecretVar} is not set, so a delivery cannot be verified`);
    }

    const rawBody = await request.text();

    const verdict = await verifyContentWebhook({
      secret,
      rawBody,
      headers: request.headers,
      ...(options.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: options.toleranceSeconds }),
    });

    if (!verdict.ok) {
      // A stale timestamp and an unreadable body are both "this delivery is not usable"; a missing or
      // wrong signature is "this delivery is not yours". The service treats any non-2xx the same way,
      // but the split is what makes a log readable when deliveries start failing.
      const unusable = verdict.reason === "stale_timestamp" || verdict.reason === "malformed_body";
      return text(unusable ? 400 : 401, verdict.reason);
    }

    // "max" is Next 16's required cache-life profile and preserves the pre-16 single-argument
    // behaviour; on Next 14 and 15 it is an ignored extra argument. `updateTag` is NOT usable here —
    // Next throws for it outside a server action.
    revalidateTag(tag, "max");

    await options.onPublish?.(verdict.event);

    return text(200, "revalidated");
  };
}

/** A plain-text response, which is all a webhook sender reads. */
function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
