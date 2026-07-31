/**
 * The payment webhook route handler.
 *
 * @remarks
 * Nothing in this module imports `next`. It takes a `Request` and answers a `Response`, which is what an
 * App Router route handler is — so it works unchanged in any Web-standard runtime. It lives on the
 * `./next` subpath because that is where a consumer looks for it, and because the *documentation* around
 * it is Next-specific: `export const runtime = "nodejs"` is the line that keeps the HMAC valid.
 *
 * Four things are non-negotiable, and each is encoded rather than documented:
 *
 * 1. `alreadyProcessed` and `markProcessed` are **required parameters**. Delivery is at-least-once and
 *    the dedupe is not optional. The SDK owns no storage so it cannot dedupe — but it can make omitting
 *    it impossible to do by accident.
 * 2. `onEvent` runs **only after** the dedupe passes, and `markProcessed` **only after** `onEvent`
 *    resolves. A crash between them yields a redelivery, which is the safe direction.
 * 3. A `2xx` inside 5 seconds. `onEvent` is *enqueue, do not process*.
 * 4. A transformed body is a signature failure, and the `401` names the edge runtime, because that is
 *    the cause far more often than a wrong secret.
 */

import { readEnv, webhookSecretVar } from "../env.js";
import {
  eventIdHeader,
  type PaymentWebhookEvent,
  parsePaymentWebhookEvent,
  verifyPaymentWebhook,
} from "../webhook.js";

/** What {@link createPaymentWebhookHandler} accepts. */
export interface PaymentWebhookHandlerOptions {
  /**
   * The signing secret, used **whole** — the `whsec_` prefix is key material, not a label to strip.
   *
   * @remarks
   * Defaults to `PAYMENT_SERVICE_WEBHOOK_SECRET`, read **per request** rather than at construction, so a
   * route module cannot throw on import and take the route tree down with it — and so a site still builds
   * with an empty environment. An unset secret is a `500` on delivery, with the variable named.
   */
  readonly secret?: string;
  /**
   * Whether this event has already been handled. **Required.**
   *
   * @remarks
   * Delivery is at-least-once: the same event arrives again after a timeout, a `5xx`, or a network blip
   * on your `200`. Without this, fulfilment runs twice. Back it with a unique constraint on the event id
   * in your own database — not an in-memory set, which is empty again on the next cold start.
   */
  readonly alreadyProcessed: (eventId: string) => Promise<boolean>;
  /**
   * Record that this event is handled. **Required.**
   *
   * @remarks
   * Called only after `onEvent` resolves, so a crash in between produces a redelivery rather than a
   * silently dropped event.
   */
  readonly markProcessed: (eventId: string) => Promise<void>;
  /**
   * Do something with the event — **enqueue it, do not process it.**
   *
   * @remarks
   * The response must be a `2xx` within 5 seconds. Eight failed attempts dead-letter the delivery, and
   * five consecutive dead-letters disable your endpoint entirely — so charging a card, sending an email
   * or issuing an invoice belongs on a queue, not here.
   *
   * A throw answers `500` and leaves the event unmarked, so the sender retries. Ordering across events is
   * **not guaranteed**: reconcile against `payment.status` in the payload, never against arrival order.
   */
  readonly onEvent: (event: PaymentWebhookEvent) => Promise<void>;
  /**
   * When to warn that `onEvent` is too slow, in milliseconds. Defaults to 3000.
   *
   * @remarks
   * Warns once per handler, and outside production only. The production symptom of a slow `onEvent` is
   * dead-lettering days later, which is a terrible way to find out; a line in a development log is a
   * much better one, and a `console.warn` on every delivery in production would itself be the problem.
   */
  readonly slowEventWarningMs?: number;
}

/** Default threshold for the slow-`onEvent` warning. */
const defaultSlowEventWarningMs = 3000;

/**
 * A `401`'s body names the cause that is actually likely.
 *
 * @remarks
 * The signature covers the raw bytes. An edge runtime, or any body-parsing middleware, may re-serialise
 * them — reordering keys and changing whitespace — and the digest stops matching a body that is
 * semantically identical. Rotating the secret does not help, so the message says where to look.
 */
const verificationAdvice =
  'The signature is over the raw request body. If this is a valid delivery, the body was transformed before it was read: set `export const runtime = "nodejs"` on this route, and keep body-parsing middleware away from it.';

/**
 * Build the `POST` handler for a payment webhook route.
 *
 * @param options - The dedupe callbacks, the event sink, and optionally the secret.
 * @returns A handler taking a `Request` and answering a `Response`. Assign it to `POST`.
 * @remarks
 * Response codes, and why each one:
 *
 * | Code | When | Why |
 * |---|---|---|
 * | `401` | verification failed | With the edge-runtime cause named. |
 * | `400` | the body is not an event | Retrying will not change it. |
 * | `200` | a duplicate | A duplicate is a **success** — the sender's job is done. `onEvent` is not called. |
 * | `200` | enqueued | The normal path. |
 * | `500` | `onEvent` threw | So the sender retries, and `markProcessed` is not called. Answered here
 * rather than re-thrown, so the response is the same in any runtime rather than depending on the
 * framework's own error boundary. |
 *
 * The dedupe key is `X-Event-Id`, which is stable across every retry of the same event. `X-Delivery-Id`
 * is per HTTP attempt and would let the same event through up to eight times. When the header is absent
 * the payload's own `event_id` is used — it is the same value, because the payload is frozen at emission
 * and delivered verbatim afterwards.
 *
 * @example
 * ```ts
 * // app/api/webhooks/payment/route.ts
 * export const runtime = "nodejs";   // an edge runtime may transform the body, which breaks the HMAC
 *
 * import { createPaymentWebhookHandler } from "@lazslov/payment/next";
 *
 * export const POST = createPaymentWebhookHandler({
 *   alreadyProcessed: (id) => db.webhookEvents.exists(id),
 *   markProcessed: (id) => db.webhookEvents.insert(id),
 *   onEvent: async (event) => {
 *     await queue.push({ type: event.event_type, paymentId: event.payment.id });
 *   },
 * });
 * ```
 */
export function createPaymentWebhookHandler(
  options: PaymentWebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  const slowAfterMs = options.slowEventWarningMs ?? defaultSlowEventWarningMs;
  let warned = false;

  return async function handlePaymentWebhook(request: Request): Promise<Response> {
    const secret = options.secret ?? readEnv(webhookSecretVar);
    if (!secret) {
      // The sender is behaving; this deployment is not. That is a 500, not a 4xx.
      return text(500, `${webhookSecretVar} is not set, so a delivery cannot be verified`);
    }

    // Before anything parses it. This is the whole ordering rule.
    const rawBody = await request.text();

    const verdict = await verifyPaymentWebhook({ secret, rawBody, headers: request.headers });
    if (!verdict.ok) return text(401, `${verdict.reason}. ${verificationAdvice}`);

    const event = parsePaymentWebhookEvent(rawBody);
    if (event === null) return text(400, "the body is not a webhook event");

    // The header first, because that is the documented key; the payload's own id is the same value and
    // covers a proxy that dropped the header.
    const eventId = request.headers.get(eventIdHeader) ?? event.event_id;

    if (await options.alreadyProcessed(eventId)) {
      // A duplicate is a success. Answering anything else asks for the retry that produced it.
      return text(200, "duplicate");
    }

    const startedAt = performance.now();
    try {
      await options.onEvent(event);
    } catch (error) {
      // A 500 rather than a re-throw, so the answer is the same in any runtime rather than depending
      // on the framework's own error boundary. `markProcessed` is deliberately unreached: the sender
      // retries, and an event marked handled after a failed enqueue is one that never happens again.
      console.error("[@lazslov/payment] onEvent threw; the delivery will be retried:", error);
      return text(500, "the event could not be accepted");
    }
    warnIfSlow(performance.now() - startedAt);

    await options.markProcessed(eventId);
    return text(200, "accepted");
  };

  /** One warning per handler, outside production only. */
  function warnIfSlow(elapsedMs: number): void {
    if (warned || elapsedMs <= slowAfterMs) return;
    if (readEnv("NODE_ENV") === "production") return;
    warned = true;
    console.warn(
      `[@lazslov/payment] onEvent took ${Math.round(elapsedMs)}ms. The service treats a response slower ` +
        "than 5 seconds as a failed attempt; eight of those dead-letter the delivery and five " +
        "consecutive dead-letters disable the endpoint. Enqueue the work instead of doing it here.",
    );
  }
}

/** A plain-text response, which is all a webhook sender reads. */
function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
