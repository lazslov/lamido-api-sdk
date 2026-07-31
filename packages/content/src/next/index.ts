/**
 * `@lazslov/content/next` — the Next.js App Router adapter.
 *
 * @remarks
 * A separate subpath because **`next` is an optional peer dependency**: only this entry imports it, so
 * installing `@lazslov/content` in an Astro, Remix or plain-Node project neither warns nor breaks, and
 * `"sideEffects": false` lets a bundler drop this entry entirely when it is unused.
 *
 * Four things live here, and each one is a bug from the reference integration turned into something the
 * type system or a shared constant prevents:
 *
 * - **{@link createNextContentGateway}** — three named cache modes, so nobody reaches for
 *   `cache: "no-store"` to get a fresh total and silently un-statifies the route.
 * - **{@link CONTENT_TAG}** — one constant the gateway *and* the handler default to, so the tag your
 *   reads set cannot drift from the tag your webhook busts. That mismatch has no error message.
 * - **{@link createRevalidationHandler}** — verifies before it parses, and does not compare `site`.
 * - **{@link asSaveResult}** — a write action returns a result object, because a thrown server-action
 *   message is redacted in production and takes the field-level reason with it.
 *
 * @example
 * ```ts
 * // lib/content.ts — one module, so the tag cannot be two different strings
 * import "server-only";
 * import { createNextContentGateway } from "@lazslov/content/next";
 *
 * export const { published, live, client, tag } = createNextContentGateway();
 *
 * // app/api/revalidate/route.ts
 * import { createRevalidationHandler } from "@lazslov/content/next";
 * import { tag } from "@/lib/content";
 *
 * export const POST = createRevalidationHandler({ tag });
 * ```
 */

export {
  createNextContentGateway,
  LIVE_REVALIDATE_SECONDS,
  type NextContentGateway,
  type NextGatewayConfig,
  tryCreateNextContentGateway,
} from "./gateway.js";
export { createRevalidationHandler, type RevalidationHandlerOptions } from "./handler.js";
export { revalidateAfterWrite } from "./revalidate.js";
export { asSaveResult, type SaveResult } from "./save-result.js";
export { CONTENT_TAG } from "./tag.js";
