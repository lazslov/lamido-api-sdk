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

/** Which events the service sends today. */
export type PaymentWebhookEventType = components["schemas"]["WebhookEventType"];

/**
 * The payment block of a delivery.
 *
 * @remarks
 * Identified by `public_id`, like every resource block in the estate envelope. This used to be
 * spelled `id` — the payload was a frozen wire format that diverged from the REST responses — and
 * the two agree again now.
 *
 * On a `refund.*` event, `status` is the payment's **new** status, derived from the refunds ledger.
 */
export interface WebhookPaymentBlock {
  readonly public_id: string;
  readonly merchant_payment_ref: string;
  readonly status: PaymentStatus;
  readonly amount_minor: string;
  readonly currency: Currency;
  readonly provider: Provider | null;
}

/** The refund block, present on `refund.*` events only. */
export interface WebhookRefundBlock {
  readonly public_id: string;
  readonly status: RefundStatus;
  readonly amount_minor: string;
  readonly currency: Currency;
}

/** Which tenant an event belongs to. */
export interface PaymentEventTenant {
  /** Always `"merchant"` from this service. */
  readonly kind: string;
  readonly public_id: string;
}

/**
 * The envelope every event from every Lamido service carries.
 *
 * @remarks
 * Everything outside `data` is metadata — who, when, why, in what chain — so one piece of a
 * receiver's code can verify, log and dedupe any event before it knows what the event is.
 */
export interface PaymentEventEnvelope {
  /** UUIDv7, equal to `X-Event-Id`. The dedupe key. */
  readonly event_id: string;
  /** The version these bytes were rendered at — your endpoint's pin. */
  readonly contract_version: number;
  /** ISO 8601 UTC. **When the fact became true**, not when it was sent. Replaced `created_at`. */
  readonly occurred_at: string;
  /** `"payment-service"`. What makes a multi-service receiver's logs legible. */
  readonly service: string;
  readonly account_id: string | null;
  /**
   * The sending merchant.
   *
   * @remarks
   * You do not need to check it: the signing secret is per endpoint, so a valid signature already
   * proves who sent it.
   */
  readonly tenant: PaymentEventTenant;
  /** Stable across a whole causal chain. Equals `event_id` on a natively-produced event. */
  readonly correlation_id: string;
  /** The `event_id` that caused this one. **Never absent**; `null` when nothing did. */
  readonly causation_id: string | null;
  /** `0` natively; `inbound.hop + 1` for an event emitted while handling one. */
  readonly hop: number;
}

/**
 * One delivery, discriminated on `event_type`.
 *
 * @remarks
 * A `refund.*` event carries a `data.refund` block as well as `data.payment`; a `payment.*` event
 * does not, and the union makes reading `event.data.refund` on the wrong branch a compile error
 * rather than an `undefined` at runtime.
 *
 * The third arm is the one that matters operationally: **an event type this SDK has never heard of
 * is a normal delivery**, not a malformed one. A receiver answering non-2xx for it would dead-letter
 * a delivery that was fine. `event_type` stays assignable from any string for that reason, and
 * narrowing on a known literal still selects the right arm.
 *
 * There is no event for `pending`, `initializing` or `authorized` — those are steps, not outcomes —
 * and no `payment.refunded`: the thing that happened is a refund, so it arrives as `refund.succeeded`.
 */
export type PaymentWebhookEvent = PaymentEventEnvelope &
  (
    | {
        readonly event_type:
          | "payment.succeeded"
          | "payment.failed"
          | "payment.canceled"
          | "payment.expired";
        readonly data: { readonly payment: WebhookPaymentBlock };
      }
    | {
        readonly event_type: "refund.succeeded" | "refund.failed";
        readonly data: {
          readonly payment: WebhookPaymentBlock;
          readonly refund: WebhookRefundBlock;
        };
      }
    | {
        // `string & {}` keeps the literals above in autocompletion while still accepting a type
        // added upstream after this SDK shipped.
        readonly event_type: string & Record<never, never>;
        readonly data: Record<string, unknown>;
      }
  );

/** A delivery whose blocks the parser has already checked. */
export type KnownPaymentEvent = PaymentEventEnvelope & {
  readonly event_type: PaymentWebhookEventType;
  readonly data: { readonly payment: WebhookPaymentBlock; readonly refund?: WebhookRefundBlock };
};

/** A `refund.*` delivery, which carries both blocks. */
export type RefundEvent = PaymentEventEnvelope & {
  readonly event_type: "refund.succeeded" | "refund.failed";
  readonly data: { readonly payment: WebhookPaymentBlock; readonly refund: WebhookRefundBlock };
};

/**
 * Whether this is an event type this SDK knows, and therefore one whose blocks are guaranteed.
 *
 * @param event - A parsed event.
 * @remarks
 * The guard exists because `event_type` accepts any string — a type added upstream after this SDK
 * shipped must still be deliverable — and that is exactly what stops TypeScript narrowing the
 * union on an `===` comparison. Ask this first, then switch.
 *
 * @example
 * ```ts
 * if (!isKnownEvent(event)) return acknowledge();   // 2xx, and nothing to do
 * await settle(event.data.payment.public_id, event.data.payment.status);
 * ```
 */
export function isKnownEvent(event: PaymentWebhookEvent): event is KnownPaymentEvent {
  return eventTypes.has(event.event_type as PaymentWebhookEventType);
}

/**
 * Whether this is a `refund.*` event, which carries a `data.refund` block as well.
 *
 * @param event - A parsed event.
 * @remarks
 * `data.payment.status` on a refund event is the payment's **new** status, derived from the
 * refunds ledger — not the refund's.
 */
export function isRefundEvent(event: PaymentWebhookEvent): event is RefundEvent {
  return event.event_type === "refund.succeeded" || event.event_type === "refund.failed";
}

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
  const tenant = candidate.tenant as Record<string, unknown> | null | undefined;
  const data = candidate.data as Record<string, unknown> | null | undefined;

  // Only the envelope members the contract marks always-present are required here. The event type
  // is deliberately NOT checked against a list: an unrecognised type is a valid delivery this
  // receiver does not act on, and rejecting it would dead-letter it.
  if (typeof eventType !== "string" || eventType === "") return null;
  if (typeof candidate.event_id !== "string" || typeof candidate.occurred_at !== "string")
    return null;
  if (typeof tenant !== "object" || tenant === null || typeof tenant.public_id !== "string")
    return null;
  if (typeof data !== "object" || data === null) return null;

  const envelope: PaymentEventEnvelope = {
    event_id: candidate.event_id,
    contract_version:
      typeof candidate.contract_version === "number" ? candidate.contract_version : 1,
    occurred_at: candidate.occurred_at,
    service: typeof candidate.service === "string" ? candidate.service : "payment-service",
    account_id: typeof candidate.account_id === "string" ? candidate.account_id : null,
    tenant: {
      kind: typeof tenant.kind === "string" ? tenant.kind : "merchant",
      public_id: tenant.public_id,
    },
    correlation_id:
      typeof candidate.correlation_id === "string" ? candidate.correlation_id : candidate.event_id,
    causation_id: typeof candidate.causation_id === "string" ? candidate.causation_id : null,
    hop: typeof candidate.hop === "number" ? candidate.hop : 0,
  };

  // A known type must carry the blocks its arm promises, or the union would be a lie: a handler
  // reading `data.refund` on a `refund.succeeded` would get `undefined` with no type error.
  if (eventTypes.has(eventType as PaymentWebhookEventType)) {
    const payment = data.payment as WebhookPaymentBlock | undefined;
    if (typeof payment?.public_id !== "string" || typeof payment.status !== "string") return null;

    if (eventType === "refund.succeeded" || eventType === "refund.failed") {
      const refund = data.refund as WebhookRefundBlock | undefined;
      // The extra block is what makes a refund event a refund event; without it there is nothing to
      // act on, and inventing an empty one would hand a handler a zero-amount refund.
      if (typeof refund?.public_id !== "string" || typeof refund.status !== "string") return null;
      return { ...envelope, event_type: eventType, data: { payment, refund } };
    }
    return { ...envelope, event_type: eventType, data: { payment } };
  }

  return { ...envelope, event_type: eventType, data };
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
