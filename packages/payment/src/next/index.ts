/**
 * `@lazslov/payment/next` — the webhook route handler.
 *
 * @remarks
 * One export, and it imports **nothing from `next`**: it takes a `Request` and answers a `Response`,
 * which is what an App Router route handler is, so it runs unchanged in any Web-standard runtime. It
 * lives here rather than on the main entry because this is where a consumer looks for it — and because
 * the one line that keeps it working is Next-specific: `export const runtime = "nodejs"`, since an edge
 * runtime may transform the body and break the HMAC.
 *
 * The whole point of the shape is that {@link createPaymentWebhookHandler} **cannot be constructed
 * without `alreadyProcessed` and `markProcessed`.** Delivery is at-least-once; the dedupe is not
 * optional; and the SDK owns no storage, so the most it can do is make forgetting it a compile error.
 *
 * @example
 * ```ts
 * // app/api/webhooks/payment/route.ts
 * export const runtime = "nodejs";
 *
 * import { createPaymentWebhookHandler } from "@lazslov/payment/next";
 *
 * export const POST = createPaymentWebhookHandler({
 *   alreadyProcessed: (id) => db.webhookEvents.exists(id),
 *   markProcessed: (id) => db.webhookEvents.insert(id),
 *   onEvent: (event) => queue.push({ paymentId: event.payment.id, type: event.event_type }),
 * });
 * ```
 */

export {
  createPaymentWebhookHandler,
  type PaymentWebhookHandlerOptions,
} from "./handler.js";
