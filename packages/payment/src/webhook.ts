/**
 * The outbound webhook: verification, and the event types.
 *
 * @remarks
 * Verification and parsing are two functions on purpose. The signature covers the **raw body**, so a
 * handler must verify before it parses — and a single function that did both would have to parse in
 * order to return anything useful, which is the wrong order.
 */

import { type VerifyResult, verifySignedBody } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";
import type { PaymentStatus, RefundStatus } from "./status.js";
import type { Currency, Provider } from "./types.js";

/** The signature header: `sha256=` plus lowercase hex. */
export const signatureHeader = "X-Signature";

/** The timestamp header: Unix **seconds** at signing time, not milliseconds. */
export const timestampHeader = "X-Signature-Timestamp";

/**
 * The header to dedupe on.
 *
 * @remarks
 * Stable across every retry of the same event. `X-Delivery-Id` is per HTTP attempt and is **not** the
 * one — deduping on it would process the same event up to eight times.
 */
export const eventIdHeader = "X-Event-Id";

/** Identifies one HTTP attempt. Useful in a log, never as a dedupe key. */
export const deliveryIdHeader = "X-Delivery-Id";

/** Which events the service sends. */
export type PaymentWebhookEventType = components["schemas"]["WebhookEventType"];

/**
 * The payment block of a delivery.
 *
 * @remarks
 * **`id` here is the payment's `public_id`.** The webhook payload is a frozen wire format — stored at
 * emission and delivered verbatim afterwards — so it is spelled differently from the REST responses.
 * The SDK does not rename it: renaming would hide the discrepancy from someone reading a payload and a
 * `GET /v1/payments/{public_id}` response side by side.
 *
 * On a `refund.*` event, `status` is the payment's **new** status, derived from the refunds ledger.
 */
export interface WebhookPaymentBlock {
  readonly id: string;
  readonly merchant_payment_ref: string;
  readonly status: PaymentStatus;
  readonly amount_minor: string;
  readonly currency: Currency;
  readonly provider: Provider | null;
}

/** The refund block, present on `refund.*` events only. */
export interface WebhookRefundBlock {
  readonly id: string;
  readonly status: RefundStatus;
  readonly amount_minor: string;
  readonly currency: Currency;
}

/**
 * One delivery, discriminated on `event_type`.
 *
 * @remarks
 * A `refund.*` event carries the extra `refund` block; a `payment.*` event does not, and the union
 * makes reading `event.refund` on the wrong branch a compile error rather than an `undefined` at
 * runtime.
 *
 * There is no event for `pending`, `initializing` or `authorized` — those are steps, not outcomes —
 * and no `payment.refunded`: the thing that happened is a refund, so it arrives as `refund.succeeded`.
 */
export type PaymentWebhookEvent =
  | {
      readonly event_id: string;
      readonly event_type:
        | "payment.succeeded"
        | "payment.failed"
        | "payment.canceled"
        | "payment.expired";
      readonly created_at: string;
      readonly payment: WebhookPaymentBlock;
    }
  | {
      readonly event_id: string;
      readonly event_type: "refund.succeeded" | "refund.failed";
      readonly created_at: string;
      readonly payment: WebhookPaymentBlock;
      readonly refund: WebhookRefundBlock;
    };

/** What the verifier needs. */
export interface PaymentWebhookInput {
  /**
   * The signing secret, used **whole**.
   *
   * @remarks
   * The `whsec_` prefix is key material, not a label to strip. Stripping it produces a valid-looking
   * digest that never matches.
   */
  readonly secret: string;
  /**
   * The request body **as text**, read before any parsing.
   *
   * @remarks
   * `JSON.parse` then re-serialise reorders keys and changes whitespace, and the signature stops
   * matching. Keep body-parsing middleware away from the route, and use the Node runtime: an edge
   * runtime may transform the body, which breaks the HMAC.
   */
  readonly rawBody: string;
  /** The request's headers, or anything with a compatible `get`. */
  readonly headers: Pick<Headers, "get">;
  /** Default 300 seconds, which is what the service signs against. */
  readonly toleranceSeconds?: number;
  /** Injectable so a fixture is deterministic. */
  readonly nowSeconds?: number;
}

/**
 * Verify a webhook delivery.
 *
 * @param input - The secret, the raw body and the request headers.
 * @returns A verdict. **Never throws** — a thrown error in a verification path tends to get caught
 * upstream and treated as valid by accident.
 * @remarks
 * HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, hex, behind a `sha256=` prefix, with a 300-second
 * tolerance. The timestamp is **inside** the signed string, which is what makes the skew window real
 * replay protection rather than decoration: a captured body cannot be re-signed with a fresh
 * timestamp.
 *
 * Then dedupe on `X-Event-Id` ({@link eventIdHeader}) before doing any work. Delivery is
 * **at-least-once** and the dedupe is not optional.
 *
 * And answer `2xx` **within 5 seconds**, doing the real work asynchronously. A slower response is a
 * failed attempt; eight failed attempts dead-letter the delivery, and five consecutive dead-letters
 * disable your endpoint entirely.
 *
 * @example
 * ```ts
 * export const runtime = "nodejs";   // an edge runtime may transform the body
 *
 * export async function POST(request: Request) {
 *   const rawBody = await request.text();
 *   const verdict = await verifyPaymentWebhook({
 *     secret: process.env.PAYMENT_SERVICE_WEBHOOK_SECRET!,
 *     rawBody,
 *     headers: request.headers,
 *   });
 *   if (!verdict.ok) return new Response(verdict.reason, { status: 401 });
 *
 *   const eventId = request.headers.get("x-event-id");
 *   if (eventId && (await alreadyProcessed(eventId))) return new Response(null, { status: 200 });
 *
 *   const event = parsePaymentWebhookEvent(rawBody);
 *   if (!event) return new Response("malformed", { status: 400 });
 *
 *   await enqueueFulfilment(event);   // the slow work goes off this request
 *   if (eventId) await markProcessed(eventId);
 *   return new Response(null, { status: 200 });
 * }
 * ```
 */
export async function verifyPaymentWebhook(input: PaymentWebhookInput): Promise<VerifyResult> {
  return await verifySignedBody({
    secret: input.secret,
    rawBody: input.rawBody,
    signature: input.headers.get(signatureHeader),
    timestamp: input.headers.get(timestampHeader),
    ...(input.toleranceSeconds === undefined ? {} : { toleranceSeconds: input.toleranceSeconds }),
    ...(input.nowSeconds === undefined ? {} : { nowSeconds: input.nowSeconds }),
  });
}

/**
 * Read a delivery body into a typed event.
 *
 * @param rawBody - The same text that was verified. **Verify first.**
 * @returns The event, or `null` when the body is not one.
 * @remarks
 * Deliberately separate from verification and deliberately not throwing: a handler that parses an
 * unverified body is the bug this shape makes visible, and a `null` maps cleanly to the `400` that
 * malformed input deserves.
 *
 * Ordering across events is **not guaranteed**. Reconcile against `payment.status` in the payload
 * rather than against arrival order.
 */
export function parsePaymentWebhookEvent(rawBody: string): PaymentWebhookEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;

  const eventType = candidate.event_type;
  if (typeof eventType !== "string" || !eventTypes.has(eventType as PaymentWebhookEventType)) {
    return null;
  }
  if (typeof candidate.event_id !== "string" || typeof candidate.created_at !== "string")
    return null;

  const payment = candidate.payment as WebhookPaymentBlock | undefined;
  if (typeof payment?.id !== "string" || typeof payment.status !== "string") return null;

  const base = {
    event_id: candidate.event_id,
    created_at: candidate.created_at,
    payment,
  };

  if (eventType === "refund.succeeded" || eventType === "refund.failed") {
    const refund = candidate.refund as WebhookRefundBlock | undefined;
    // The extra block is what makes a refund event a refund event; without it there is nothing to act
    // on, and inventing an empty one would hand a handler a zero-amount refund.
    if (typeof refund?.id !== "string" || typeof refund.status !== "string") return null;
    return { ...base, event_type: eventType, refund };
  }

  // Listed rather than cast, so a new event type added upstream cannot be silently mis-narrowed here.
  if (
    eventType === "payment.succeeded" ||
    eventType === "payment.failed" ||
    eventType === "payment.canceled" ||
    eventType === "payment.expired"
  ) {
    return { ...base, event_type: eventType };
  }

  return null;
}

/** Every event type the service sends. */
const eventTypes = new Set<PaymentWebhookEventType>([
  "payment.succeeded",
  "payment.failed",
  "payment.canceled",
  "payment.expired",
  "refund.succeeded",
  "refund.failed",
]);
