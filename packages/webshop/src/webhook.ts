/**
 * The outbound webhook: verification, and the event types.
 *
 * @remarks
 * Verification and parsing are two functions on purpose. The signature covers the **raw body**, so a
 * handler must verify before it parses — and a single function that did both would have to parse in
 * order to return anything useful, which is the wrong order.
 *
 * **Subscribe and poll.** The retry ladder is published in minutes (1 min → 48 h) and delivered in
 * days: the first attempt is inline, immediately after the emitting transaction commits, and every
 * retry waits for a drain that runs **once a day** on this deployment. A receiver down for ten
 * minutes gets the missed event the next morning. Keep a reconciliation poll through `getOrder` or
 * `listOrders`, and let that be the thing you trust.
 */

import { type VerifyResult, verifySignedBody } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";
import type { OrderStatus } from "./status.js";
import type { Address, Currency, MinorAmount } from "./types.js";

/** The signature header: `sha256=` plus lowercase hex. */
export const signatureHeader = "X-Signature";

/** The timestamp header: Unix **seconds** at signing time, inside the MAC. */
export const timestampHeader = "X-Signature-Timestamp";

/**
 * The header to dedupe on.
 *
 * @remarks
 * Stable across every retry **and** every operator redelivery. `X-Delivery-Id` is per HTTP attempt
 * and is **not** the one — deduping on it would process the same event up to eight times.
 */
export const eventIdHeader = "X-Event-Id";

/** Identifies one HTTP attempt. For correlating one request in both parties' logs; never a dedupe key. */
export const deliveryIdHeader = "X-Delivery-Id";

/**
 * The six events the service sends today.
 *
 * @remarks
 * Closed and additive-only. Where the name ends in a status, `data.order.status` **equals** that
 * status — the service's own tests enforce it. **`order.created` is the exception**: "created" is not
 * a status, so it is an *observation* that an order exists, not a statement of its state. Today it
 * always lands on `pending`, and the service deliberately does not promise that. **Read
 * `data.order.status`; never branch on the event name alone.**
 *
 * There is no `order.paid`: `paid` is a step inside one transaction, and the outcome a receiver acts
 * on is `order.confirmed` moments later. Nothing fires for a cart, the catalog, a coupon or stock.
 * `canceled` has one `l`.
 */
export type WebshopWebhookEventType = components["schemas"]["EventType"]["event_type"];

/**
 * One line of the order block.
 *
 * @remarks
 * Addressed by `variant_public_id`, and `product_name` / `variant_name` are the names **as bought**.
 * If the shop renames the product tomorrow, this event keeps what the buyer saw. Do not re-resolve
 * names for a historical order.
 */
export interface WebhookOrderLine {
  readonly product_public_id: string;
  readonly variant_public_id: string;
  readonly product_name: string;
  readonly variant_name: string;
  readonly sku: string | null;
  /** A JSON number. */
  readonly quantity: number;
  readonly unit_price: MinorAmount;
  /** Always `"0"`. */
  readonly discount_total: string;
  readonly total: MinorAmount;
  readonly currency: Currency;
}

/**
 * The order block every event carries.
 *
 * @remarks
 * Money is a decimal string in minor units with `currency` beside it; **HUF has zero minor units**.
 * **`grand_total` is gross and `tax_total` is contained within it** — adding them double-counts, and
 * that is the single most expensive thing to get wrong here.
 *
 * There is no address, no email and no customer name here by default — see
 * {@link WebhookCustomerBlock}.
 */
export interface WebhookOrderBlock {
  readonly public_id: string;
  /** Read it. On `order.created` this is an observation; on every other event it equals the name. */
  readonly status: OrderStatus;
  readonly currency: Currency;
  readonly subtotal: MinorAmount;
  readonly discount_total: MinorAmount;
  readonly shipping_total: MinorAmount;
  readonly tax_total: string;
  readonly grand_total: MinorAmount;
  readonly shipping_method_name: string | null;
  readonly shipping_method_price: string | null;
  readonly coupon_code: string | null;
  readonly coupon_discount: string | null;
  readonly items: WebhookOrderLine[];
  readonly created_at: string;
}

/**
 * The buyer, present **only** when an operator has ticked `include_customer` on your endpoint.
 *
 * @remarks
 * Off by default, because a webhook body does not stay in one place: it lands in your request log, in
 * your log drain, in every proxy between the services, and in the first support ticket. `customer_id`
 * is whatever your storefront passed at checkout, handed straight back — `null` for a guest.
 * `billing_address: null` means "the same as shipping"; resolve it exactly as the API does.
 */
export interface WebhookCustomerBlock {
  readonly customer_id: string | null;
  readonly email: string | null;
  readonly shipping_address: Address;
  readonly billing_address: Address | null;
}

/** Which tenant an event belongs to. */
export interface WebshopEventTenant {
  /** Always `"shop"` from this service. */
  readonly kind: string;
  readonly public_id: string;
}

/**
 * The envelope every event from every Lamido service carries.
 *
 * @remarks
 * Eleven members, all always present, so one piece of a receiver's code can verify, log and dedupe
 * any event before it knows what the event is.
 */
export interface WebshopEventEnvelope {
  /** UUIDv7, equal to `X-Event-Id`. The dedupe key. */
  readonly event_id: string;
  /** The version these bytes were rendered at — your endpoint's pin. `1` is the only value today. */
  readonly contract_version: number;
  /** ISO 8601 UTC. **When the fact became true**, inside the committing transaction. Order your work by this. */
  readonly occurred_at: string;
  /** `"webshop-service"`. */
  readonly service: string;
  /**
   * The shop's estate-wide account reference.
   *
   * @remarks
   * **May be `null`** for a newly provisioned shop whose pairing has not landed yet. The event still
   * fires; it just cannot be routed cross-service until the reference exists.
   */
  readonly account_id: string | null;
  /**
   * The sending shop.
   *
   * @remarks
   * You do not need to check it: the signing secret is per endpoint, so a valid signature already
   * proves who sent it.
   */
  readonly tenant: WebshopEventTenant;
  /** Stable across a whole causal chain. Equals `event_id` on a natively-produced event. */
  readonly correlation_id: string;
  /**
   * The `event_id` that caused this one. **Never absent**; `null` when nothing did.
   *
   * @remarks
   * An `order.confirmed` with a `causation_id` and `hop: 1` was caused by a payment-service event,
   * and one `correlation_id` query spans both services.
   */
  readonly causation_id: string | null;
  /** `0` natively; the inbound event's hop plus one when caused by one. */
  readonly hop: number;
}

/** The blocks a known event carries. */
export interface WebshopEventData {
  readonly order: WebhookOrderBlock;
  /** Present only when the endpoint has `include_customer: true`. */
  readonly customer?: WebhookCustomerBlock;
}

/**
 * One delivery, discriminated on `event_type`.
 *
 * @remarks
 * The second arm is the one that matters operationally: **an event type this SDK has never heard of
 * is a normal delivery**, not a malformed one. A receiver answering non-2xx for it would dead-letter
 * a delivery that was fine. `event_type` stays assignable from any string for that reason, and
 * narrowing on a known literal still selects the right arm. `webhook.ping` — the operator's test
 * delivery, with `data: {}` — arrives through this arm too: verify it and do nothing.
 */
export type WebshopWebhookEvent = WebshopEventEnvelope &
  (
    | {
        readonly event_type: WebshopWebhookEventType;
        readonly data: WebshopEventData;
      }
    | {
        // `string & {}` keeps the literals above in autocompletion while still accepting a type
        // added upstream after this SDK shipped.
        readonly event_type: string & Record<never, never>;
        readonly data: Record<string, unknown>;
      }
  );

/** A delivery whose order block the parser has already checked. */
export type KnownWebshopEvent = WebshopEventEnvelope & {
  readonly event_type: WebshopWebhookEventType;
  readonly data: WebshopEventData;
};

/**
 * Whether this is an event type this SDK knows, and therefore one whose order block is guaranteed.
 *
 * @param event - A parsed event.
 * @remarks
 * The guard exists because `event_type` accepts any string — a type added upstream after this SDK
 * shipped must still be deliverable — and that is exactly what stops TypeScript narrowing the union
 * on an `===` comparison. Ask this first, then read `data.order.status`.
 *
 * @example
 * ```ts
 * if (!isKnownEvent(event)) return acknowledge();   // 2xx, and nothing to do
 * if (isConfirmed(event.data.order.status)) await fulfil(event.data.order.public_id);
 * ```
 */
export function isKnownEvent(event: WebshopWebhookEvent): event is KnownWebshopEvent {
  return eventTypes.has(event.event_type as WebshopWebhookEventType);
}

/** What the verifier needs. */
export interface WebshopWebhookInput {
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
  /** Default 300 seconds, which is what the service publishes. */
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
 * replay protection: a captured body cannot be re-signed with a fresh timestamp.
 *
 * Then dedupe on `X-Event-Id` ({@link eventIdHeader}) before doing any work. Delivery is
 * **at-least-once and unordered**, and the dedupe is not optional.
 *
 * And answer `2xx` **within 5 seconds**, doing the real work asynchronously. A slower response is a
 * failed attempt; eight failed attempts dead-letter the delivery, and five exhausted ladders disable
 * your endpoint entirely — after which nothing more is sent until an operator re-enables it.
 *
 * @example
 * ```ts
 * export const runtime = "nodejs";   // an edge runtime may transform the body
 *
 * export async function POST(request: Request) {
 *   const rawBody = await request.text();
 *   const verdict = await verifyWebshopWebhook({
 *     secret: process.env.WEBSHOP_WEBHOOK_SECRET!,
 *     rawBody,
 *     headers: request.headers,
 *   });
 *   if (!verdict.ok) return new Response(verdict.reason, { status: 401 });
 *
 *   const eventId = request.headers.get("x-event-id");
 *   if (eventId && (await alreadyProcessed(eventId))) return new Response(null, { status: 200 });
 *
 *   const event = parseWebshopWebhookEvent(rawBody);
 *   if (!event) return new Response("malformed", { status: 400 });
 *
 *   await enqueue(event);   // the slow work goes off this request
 *   if (eventId) await markProcessed(eventId);
 *   return new Response(null, { status: 200 });
 * }
 * ```
 */
export async function verifyWebshopWebhook(input: WebshopWebhookInput): Promise<VerifyResult> {
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
 * Ordering across events is **not guaranteed**. Reconcile against `data.order.status` in the payload
 * — or better, re-read the order through the API — rather than against arrival order.
 */
export function parseWebshopWebhookEvent(rawBody: string): WebshopWebhookEvent | null {
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

  const envelope: WebshopEventEnvelope = {
    event_id: candidate.event_id,
    contract_version:
      typeof candidate.contract_version === "number" ? candidate.contract_version : 1,
    occurred_at: candidate.occurred_at,
    service: typeof candidate.service === "string" ? candidate.service : "webshop-service",
    account_id: typeof candidate.account_id === "string" ? candidate.account_id : null,
    tenant: {
      kind: typeof tenant.kind === "string" ? tenant.kind : "shop",
      public_id: tenant.public_id,
    },
    correlation_id:
      typeof candidate.correlation_id === "string" ? candidate.correlation_id : candidate.event_id,
    causation_id: typeof candidate.causation_id === "string" ? candidate.causation_id : null,
    hop: typeof candidate.hop === "number" ? candidate.hop : 0,
  };

  // A known type must carry the block its arm promises, or the union would be a lie: a handler
  // reading `data.order.status` on an `order.confirmed` would get `undefined` with no type error.
  if (eventTypes.has(eventType as WebshopWebhookEventType)) {
    const order = data.order as WebhookOrderBlock | undefined;
    if (typeof order?.public_id !== "string" || typeof order.status !== "string") return null;

    const customer = data.customer;
    const blocks: WebshopEventData =
      typeof customer === "object" && customer !== null
        ? { order, customer: customer as WebhookCustomerBlock }
        : { order };
    return { ...envelope, event_type: eventType as WebshopWebhookEventType, data: blocks };
  }

  return { ...envelope, event_type: eventType, data };
}

/** Every event type the service sends. */
const eventTypes = new Set<WebshopWebhookEventType>([
  "order.created",
  "order.confirmed",
  "order.payment_failed",
  "order.canceled",
  "order.fulfilled",
  "order.refunded",
]);
