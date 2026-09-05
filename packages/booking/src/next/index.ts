/**
 * `@lazslov/booking/next` — the webhook route handler.
 *
 * @remarks
 * One export, and it imports **nothing from `next`**: it takes a `Request` and answers a `Response`,
 * which is what an App Router route handler is, so it runs unchanged in any Web-standard runtime. It
 * lives here rather than on the main entry because this is where a consumer looks for it — and
 * because the one line that keeps it working is Next-specific: `export const runtime = "nodejs"`,
 * since an edge runtime may transform the body and break the HMAC.
 *
 * The whole point of the shape is that {@link createBookingWebhookHandler} **cannot be constructed
 * without `alreadyProcessed` and `markProcessed`.** Delivery is at-least-once; the dedupe is not
 * optional; and the SDK owns no storage, so the most it can do is make forgetting it a compile error.
 *
 * And this route is where a tenant's customers are told anything at all. **booking-service sends no
 * email, no SMS and no push** — the confirmation link, the reminder and the cancellation notice all
 * start from an event arriving here.
 *
 * @example
 * ```ts
 * // app/api/webhooks/booking/route.ts
 * export const runtime = "nodejs";
 *
 * import { createBookingWebhookHandler } from "@lazslov/booking/next";
 *
 * export const POST = createBookingWebhookHandler({
 *   alreadyProcessed: (id) => db.webhookEvents.exists(id),
 *   markProcessed: (id) => db.webhookEvents.insert(id),
 *   onEvent: (event) => queue.push(event),
 * });
 * ```
 */

export {
  type BookingWebhookHandlerOptions,
  createBookingWebhookHandler,
} from "./handler.js";
