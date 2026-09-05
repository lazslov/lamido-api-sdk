/**
 * The outbound webhook: verification, and the event types.
 *
 * @remarks
 * Verification and parsing are two functions on purpose. The signature covers the **raw body**, so
 * a handler must verify before it parses — and a single function that did both would have to parse
 * in order to return anything useful, which is the wrong order.
 *
 * **These events are the only way a tenant learns that anything happened.** The service sends no
 * email, no SMS and no push. A receiver that is down, disabled or never built is a customer nobody
 * told.
 */

import { type VerifyResult, verifySignedBody } from "@lazslov/api-core";
import type { BookingStatus, CancellationReason, MinorAmount } from "./types.js";

/** The signature header: `sha256=` plus lowercase hex. */
export const signatureHeader = "X-Signature";

/** The timestamp header: Unix **seconds** at signing time, not milliseconds. */
export const timestampHeader = "X-Signature-Timestamp";

/**
 * The header to dedupe on.
 *
 * @remarks
 * Equal to the envelope's `event_id` — one id, not two — and stable across every retry and every
 * redelivery of the same event. `X-Delivery-Id` is per HTTP attempt and is **not** the one.
 */
export const eventIdHeader = "X-Event-Id";

/** A fresh id per HTTP attempt. Useful in a log, never as a dedupe key. */
export const deliveryIdHeader = "X-Delivery-Id";

/**
 * The seven booking events the service emits.
 *
 * @remarks
 * There is deliberately no event for a hold (created, redeemed, released or expired), for a
 * catalogue or working-hours change, for a calendar connecting or degrading, or for a customer
 * record. A booking created already `confirmed` fires `booking.created` **only**, with
 * `data.booking.status: "confirmed"` — so a receiver subscribed only to `booking.confirmed` never
 * hears from a tenant running without a confirmation gate. **Branch on `data.booking.status`,
 * never on the event name.** A pending booking that expires fires `booking.canceled` with
 * `cancellation_reason: "system_pending_expired"`.
 */
export type BookingEventType =
  | "booking.created"
  | "booking.confirmed"
  | "booking.rescheduled"
  | "booking.canceled"
  | "booking.completed"
  | "booking.no_show"
  | "booking.reminder_reached";

/**
 * Every event type this SDK knows: the seven booking events and the `webhook.ping` that
 * `testWebhookEndpoint` sends through the real path.
 *
 * @remarks
 * Hand-written, because the contract types `event_type` as an open `string` and publishes the
 * catalogue as data on `GET /v1/event-types`. Fetch that to offer choices; use this to narrow a
 * parsed delivery.
 */
export type BookingWebhookEventType = BookingEventType | "webhook.ping";

/** The booking block of a booking event: ids, instants and the two open enums. */
export interface WebhookBookingBlock {
  readonly public_id: string;
  readonly status: BookingStatus;
  readonly pending_reason: string | null;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly timezone: string;
  readonly cancellation_reason: CancellationReason;
  readonly rescheduled_from_id: string | null;
}

/** The location block: an id to read the record with, not a copy of it. */
export interface WebhookLocationBlock {
  readonly public_id: string;
}

/** The service block, with the price as a minor-unit string. `HUF` is zero-decimal. */
export interface WebhookServiceBlock {
  readonly public_id: string;
  readonly price_minor: MinorAmount;
  readonly currency: string;
}

/** The employee block: an id. */
export interface WebhookEmployeeBlock {
  readonly public_id: string;
}

/**
 * The customer block, present **only** on an endpoint with `include_customer: true`.
 *
 * @remarks
 * Off by default. It is stored in the event at emission so every attempt of a delivery is
 * byte-identical for the signature, and stripped from event *reads* on the API.
 */
export interface WebhookCustomerBlock {
  readonly public_id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
}

/**
 * The `data` block of a booking event.
 *
 * @remarks
 * Ids, not a denormalised copy of the world. **Re-read state rather than reconstructing it from the
 * event stream** — events arrive at-least-once and out of order, and if a read and an event
 * disagree, the read is right and the event is old.
 */
export interface BookingEventData {
  readonly booking: WebhookBookingBlock;
  readonly location: WebhookLocationBlock;
  readonly service: WebhookServiceBlock;
  readonly employee: WebhookEmployeeBlock;
  readonly customer?: WebhookCustomerBlock;
}

/** Which tenant an event belongs to. */
export interface BookingEventTenant {
  /** Always `"tenant"` from this service. */
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
export interface BookingEventEnvelope {
  /** UUIDv7, equal to `X-Event-Id`. The dedupe key. */
  readonly event_id: string;
  /** The version these bytes were rendered at — your endpoint's pin. `1` today. */
  readonly contract_version: number;
  /** ISO 8601 UTC. **When the fact happened**, not when it was delivered. */
  readonly occurred_at: string;
  /** `"booking-service"`. What makes a multi-service receiver's logs legible. */
  readonly service: string;
  /** The tenant's `external_ref` — the lamido-admin account. `null` if unset. */
  readonly account_id: string | null;
  /**
   * The sending tenant.
   *
   * @remarks
   * You do not need to check it: the signing secret is per endpoint, so a valid signature already
   * proves who sent it.
   */
  readonly tenant: BookingEventTenant;
  /** Equals `event_id` for an event this service originated. */
  readonly correlation_id: string;
  /** `null` — this service does not act on inbound events. **Never absent.** */
  readonly causation_id: string | null;
  /** `0`. A loop breaker for choreographed chains. */
  readonly hop: number;
}

/**
 * One delivery, discriminated on `event_type`.
 *
 * @remarks
 * The seven booking events carry a {@link BookingEventData} block. `webhook.ping` carries whatever
 * the service put in it, and asks for nothing but a `2xx`.
 *
 * The third arm is the one that matters operationally: **an event type this SDK has never heard of
 * is a normal delivery**, not a malformed one. New members ship inside `contract_version: 1`, and a
 * receiver answering non-2xx for one would dead-letter a delivery that was fine. `event_type` stays
 * assignable from any string for that reason, and narrowing on a known literal still selects the
 * right arm.
 */
export type BookingWebhookEvent = BookingEventEnvelope &
  (
    | { readonly event_type: BookingEventType; readonly data: BookingEventData }
    | { readonly event_type: "webhook.ping"; readonly data: Record<string, unknown> }
    | {
        // `string & {}` keeps the literals above in autocompletion while still accepting a type
        // added upstream after this SDK shipped.
        readonly event_type: string & Record<never, never>;
        readonly data: Record<string, unknown>;
      }
  );

/** A booking event whose blocks the parser has already checked. */
export type KnownBookingEvent = BookingEventEnvelope & {
  readonly event_type: BookingEventType;
  readonly data: BookingEventData;
};

/**
 * Whether this is one of the seven booking events, and therefore one whose blocks are guaranteed.
 *
 * @param event - A parsed event.
 * @remarks
 * The guard exists because `event_type` accepts any string — a type added upstream after this SDK
 * shipped must still be deliverable — and that is exactly what stops TypeScript narrowing the
 * union on an `===` comparison. Ask this first, then read `data.booking.status`. A `webhook.ping`
 * answers `false`: it has no booking to act on.
 *
 * @example
 * ```ts
 * if (!isKnownEvent(event)) return acknowledge();   // 2xx, and nothing to do
 * await reconcile(event.data.booking.public_id);     // re-read; do not trust the snapshot
 * ```
 */
export function isKnownEvent(event: BookingWebhookEvent): event is KnownBookingEvent {
  return bookingEventTypes.has(event.event_type as BookingEventType);
}

/** What the verifier needs. */
export interface BookingWebhookInput {
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
 * HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, hex, behind a `sha256=` prefix, with a
 * 300-second tolerance. The timestamp is **inside** the signed string, which is what makes the skew
 * window real replay protection: a captured body cannot be re-signed with a fresh timestamp.
 *
 * Then dedupe on `X-Event-Id` ({@link eventIdHeader}) before doing any work. Delivery is
 * **at-least-once** and the dedupe is not optional.
 *
 * And answer `2xx` **within 5 seconds**, doing the real work asynchronously. Everything else is a
 * failure, including a `3xx`; five consecutive failures disable your endpoint, and a disabled
 * endpoint has no backlog — nothing is queued for it until somebody re-enables it. Keep a
 * reconciliation poll over `listBookings` for the window you act on.
 *
 * @example
 * ```ts
 * export const runtime = "nodejs";   // an edge runtime may transform the body
 *
 * export async function POST(request: Request) {
 *   const rawBody = await request.text();
 *   const verdict = await verifyBookingWebhook({
 *     secret: process.env.BOOKING_SERVICE_WEBHOOK_SECRET!,
 *     rawBody,
 *     headers: request.headers,
 *   });
 *   if (!verdict.ok) return new Response(verdict.reason, { status: 401 });
 *
 *   const eventId = request.headers.get("x-event-id");
 *   if (eventId && (await alreadyProcessed(eventId))) return new Response(null, { status: 200 });
 *
 *   const event = parseBookingWebhookEvent(rawBody);
 *   if (!event) return new Response("malformed", { status: 400 });
 *
 *   await enqueue(event);   // the email you send goes off this request
 *   if (eventId) await markProcessed(eventId);
 *   return new Response(null, { status: 200 });
 * }
 * ```
 */
export async function verifyBookingWebhook(input: BookingWebhookInput): Promise<VerifyResult> {
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
 * Ordering across events is **not guaranteed** — nothing says `booking.created` arrives before
 * `booking.confirmed`. Treat an event as *"something changed, go look"* and re-read the booking.
 */
export function parseBookingWebhookEvent(rawBody: string): BookingWebhookEvent | null {
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

  const envelope: BookingEventEnvelope = {
    event_id: candidate.event_id,
    contract_version:
      typeof candidate.contract_version === "number" ? candidate.contract_version : 1,
    occurred_at: candidate.occurred_at,
    service: typeof candidate.service === "string" ? candidate.service : "booking-service",
    account_id: typeof candidate.account_id === "string" ? candidate.account_id : null,
    tenant: {
      kind: typeof tenant.kind === "string" ? tenant.kind : "tenant",
      public_id: tenant.public_id,
    },
    correlation_id:
      typeof candidate.correlation_id === "string" ? candidate.correlation_id : candidate.event_id,
    causation_id: typeof candidate.causation_id === "string" ? candidate.causation_id : null,
    hop: typeof candidate.hop === "number" ? candidate.hop : 0,
  };

  // A known type must carry the blocks its arm promises, or the union would be a lie: a handler
  // reading `data.booking.status` on a `booking.confirmed` would get `undefined` with no type error.
  if (bookingEventTypes.has(eventType as BookingEventType)) {
    const blocks = bookingBlocks(data);
    if (blocks === null) return null;
    return { ...envelope, event_type: eventType as BookingEventType, data: blocks };
  }

  return { ...envelope, event_type: eventType, data };
}

/** The four blocks every booking event carries, plus the customer block when it is there. */
function bookingBlocks(data: Record<string, unknown>): BookingEventData | null {
  const booking = data.booking as WebhookBookingBlock | undefined;
  if (typeof booking?.public_id !== "string" || typeof booking.status !== "string") return null;

  const location = data.location as WebhookLocationBlock | undefined;
  const service = data.service as WebhookServiceBlock | undefined;
  const employee = data.employee as WebhookEmployeeBlock | undefined;
  if (
    typeof location?.public_id !== "string" ||
    typeof service?.public_id !== "string" ||
    typeof employee?.public_id !== "string"
  )
    return null;

  const customer = data.customer as WebhookCustomerBlock | undefined;
  return {
    booking,
    location,
    service,
    employee,
    // Present only where the endpoint opted in; an absent block stays absent rather than `undefined`.
    ...(typeof customer?.public_id === "string" ? { customer } : {}),
  };
}

/** The seven booking events. `webhook.ping` is not here: it carries no booking. */
const bookingEventTypes = new Set<BookingEventType>([
  "booking.created",
  "booking.confirmed",
  "booking.rescheduled",
  "booking.canceled",
  "booking.completed",
  "booking.no_show",
  "booking.reminder_reached",
]);
