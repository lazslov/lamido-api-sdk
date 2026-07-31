/**
 * Expiring the tag from a server action, which is not the same call the webhook makes.
 *
 * @remarks
 * > **`updateTag` in an action, `revalidateTag` in the webhook.** Both exist and they are **not**
 * > interchangeable.
 *
 * In a **server action**, expire the tag immediately so the editor's own next view is correct without
 * waiting for a round trip — that is the promise you make to someone who just pressed Save. In the
 * **webhook handler**, `revalidateTag` is the one available, and it keeps every *other* visitor's page
 * fresh. Belt and braces: the webhook says the same thing a moment later.
 *
 * Next enforces the split itself. `updateTag` throws *"can only be called from within a Server
 * Action"* when called from a route handler, so the two are not substitutable even by accident.
 *
 * Nothing in this SDK calls either from inside a write method. A gateway that revalidated on write
 * would be doing framework work in a transport, and it would fire on every write whether or not the
 * caller was in a request that could act on it.
 */

import * as cache from "next/cache";
import { CONTENT_TAG } from "./tag.js";

/**
 * Expire the content tag after a write, from inside a server action.
 *
 * @param tag - The tag your reads set. Defaults to {@link CONTENT_TAG}; pass the gateway's `tag` if you
 * overrode it.
 * @throws Whatever Next throws when called outside a server action — which is the point: this is not
 * the call a route handler makes. `createRevalidationHandler` does the right thing there.
 * @remarks
 * Prefers `updateTag`, which gives the editor read-your-own-writes within this same request. Falls back
 * to `revalidateTag` on a Next that has no `updateTag` — it arrived in Next 16, and this package's peer
 * range starts at 14, so the capability is checked rather than assumed. A static named import of
 * `updateTag` would make the whole subpath unimportable on Next 14 and 15.
 *
 * The `"max"` argument on the fallback is Next 16's required cache-life profile, which preserves the
 * old single-argument behaviour; on Next 14 and 15 it is an extra argument and is ignored.
 *
 * @example
 * ```ts
 * "use server";
 * import { asSaveResult, revalidateAfterWrite } from "@lazslov/content/next";
 * import { client, tag } from "@/lib/content";
 *
 * export async function saveAbout(values: Record<string, unknown>) {
 *   return asSaveResult(async () => {
 *     await client.patchValues("home", values);
 *     revalidateAfterWrite(tag);
 *   });
 * }
 * ```
 */
export function revalidateAfterWrite(tag: string = CONTENT_TAG): void {
  // `in` before the property read, because the question really is "does this module export it": a Next
  // 14 namespace does not have the key at all, and reaching for it directly is also what trips a test
  // runner's mocked-module proxy.
  if ("updateTag" in cache && typeof cache.updateTag === "function") {
    cache.updateTag(tag);
    return;
  }
  cache.revalidateTag(tag, "max");
}
