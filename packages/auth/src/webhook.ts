/**
 * The outbound webhook: verification, and the event types.
 *
 * @remarks
 * Verification and parsing are two functions on purpose. The signature covers the **raw body**, so a
 * handler must verify before it parses — and a single function that did both would have to parse in
 * order to return anything useful, which is the wrong order.
 *
 * auth-service is a **pure emitter**: it receives no webhooks and exposes no inbound surface, so
 * nothing here sends it anything.
 */

import { type VerifyResult, verifySignedBody } from "@lazslov/api-core";
import type { CustomerStatus, SubscriptionStatus } from "./types.js";

/** The signature header: `sha256=` plus lowercase hex. */
export const signatureHeader = "X-Signature";

/** The timestamp header: Unix **seconds** at signing time, inside the MAC. */
export const timestampHeader = "X-Signature-Timestamp";

/**
 * The header to dedupe on.
 *
 * @remarks
 * Stable across every retry of the same event **and** every operator redelivery. `X-Delivery-Id` is
 * per HTTP attempt and is **not** the one — deduping on it would process the same event up to eight
 * times. The store behind the dedupe must outlive your restart: the ladder spans about 3.5 days.
 */
export const eventIdHeader = "X-Event-Id";

/** Identifies one HTTP attempt. Useful in a log, never as a dedupe key. */
export const deliveryIdHeader = "X-Delivery-Id";

/**
 * The six event types the service sends today.
 *
 * @remarks
 * Hand-written: the contract declares no event-type schema. Checked against the live catalogue by a
 * test in the service's own repository. What never fires is as deliberate as what does — no
 * `customer.deactivated`, no `user.*`, no `session.*`, no `permission.*`, no `subscription.past_due`
 * (a grace period is a state you observe, not a transition to act on), and no event for a plan or
 * feature edit.
 */
export type AuthWebhookEventType =
  | "customer.created"
  | "membership.created"
  | "membership.revoked"
  | "subscription.activated"
  | "subscription.canceled"
  | "subscription.expired";

/**
 * The operator's test delivery.
 *
 * @remarks
 * Delivered only when an operator presses *test* on your endpoint. In no catalogue, not subscribable,
 * carries `data: {}` and `account_id: null`, and is signed exactly like a real delivery — so it is a
 * live test of your **verification**. Accept it and answer `2xx`.
 */
export const pingEventType = "webhook.ping";

/**
 * The subscription block, on `subscription.*` events.
 *
 * @remarks
 * `status` equals the event type's participle — `subscription.activated` carries `"active"`. The
 * six members are the ones the documented example carries.
 */
export interface WebhookSubscriptionBlock {
  readonly public_id: string;
  readonly status: SubscriptionStatus;
  readonly plan: string;
  readonly website: string | null;
  readonly period_start: string;
  readonly period_end: string;
}

/**
 * The customer block, on `customer.created`.
 *
 * @remarks
 * The event type carries no status and that is deliberate: a create is a fact about a row appearing,
 * and whether the person may sign in is `status`, which you must **read** rather than assume. `email`
 * is present only on an endpoint whose operator enabled `include_customer`; its absence is not a
 * customer without an address.
 */
export interface WebhookCustomerBlock {
  readonly public_id: string;
  readonly status: CustomerStatus;
  readonly email?: string;
  readonly [member: string]: unknown;
}

/** Which tenant an event belongs to. */
export interface AuthEventTenant {
  /** Always `"organization"` from this service. */
  readonly kind: string;
  readonly public_id: string;
}

/**
 * The envelope every event from every Lamido service carries.
 *
 * @remarks
 * Everything outside `data` is metadata — who, when, why, in what chain — so one piece of a receiver's
 * code can verify, log and dedupe any event before it knows what the event is.
 */
export interface AuthEventEnvelope {
  /** UUIDv7, equal to `X-Event-Id`. The dedupe key. */
  readonly event_id: string;
  /** The version these bytes were rendered at — your endpoint's pin. */
  readonly contract_version: number;
  /** ISO 8601 UTC. **When the fact became true**, inside the committing transaction — not when sent. Order your work by this. */
  readonly occurred_at: string;
  /** `"auth-service"`. What makes a multi-service receiver's logs legible. */
  readonly service: string;
  /**
   * The tenant's estate-wide account reference, or `null`.
   *
   * @remarks
   * Written by lamido-admin at provisioning. An organization created a minute ago may not have one
   * yet; the event still fires, and it cannot be routed cross-service until it does.
   */
  readonly account_id: string | null;
  /**
   * The sending organization.
   *
   * @remarks
   * You do not need to check it: the signing secret is per endpoint, so a valid signature already
   * proves who sent it.
   */
  readonly tenant: AuthEventTenant;
  /** Equals `event_id` on everything this service emits: nothing here reacts to another service's event. */
  readonly correlation_id: string;
  /** **Never absent**; `null` on everything this service emits, for the same reason. */
  readonly causation_id: string | null;
  /** `0` on everything this service emits. */
  readonly hop: number;
}

/**
 * One delivery, discriminated on `event_type`.
 *
 * @remarks
 * A `subscription.*` event carries `data.subscription`; `customer.created` carries `data.customer`.
 * The `membership.*` arms keep `data` open: the knowledge base documents that a membership event fires
 * and does not show its block, and a key this SDK guessed would be a type that lies. The last arm is
 * the one that matters operationally: **an event type this SDK has never heard of is a normal
 * delivery**, not a malformed one, and a receiver answering non-2xx for it would dead-letter a
 * delivery that was fine.
 */
export type AuthWebhookEvent = AuthEventEnvelope &
  (
    | {
        readonly event_type:
          | "subscription.activated"
          | "subscription.canceled"
          | "subscription.expired";
        readonly data: { readonly subscription: WebhookSubscriptionBlock };
      }
    | {
        readonly event_type: "customer.created";
        readonly data: { readonly customer: WebhookCustomerBlock };
      }
    | {
        readonly event_type: "membership.created" | "membership.revoked";
        readonly data: Record<string, unknown>;
      }
    | {
        readonly event_type: typeof pingEventType;
        readonly data: Record<string, unknown>;
      }
    | {
        // `string & {}` keeps the literals above in autocompletion while still accepting a type
        // added upstream after this SDK shipped.
        readonly event_type: string & Record<never, never>;
        readonly data: Record<string, unknown>;
      }
  );

/** A delivery whose type is in the catalogue. */
export type KnownAuthEvent = Extract<AuthWebhookEvent, { event_type: AuthWebhookEventType }>;

/** A `subscription.*` delivery, whose block the parser has already checked. */
export type SubscriptionEvent = Extract<AuthWebhookEvent, { event_type: `subscription.${string}` }>;

/** A `customer.created` delivery, whose block the parser has already checked. */
export type CustomerEvent = Extract<AuthWebhookEvent, { event_type: "customer.created" }>;

/** Every event type in the catalogue. */
const eventTypes: ReadonlySet<string> = new Set<AuthWebhookEventType>([
  "customer.created",
  "membership.created",
  "membership.revoked",
  "subscription.activated",
  "subscription.canceled",
  "subscription.expired",
]);

/**
 * Whether this is an event type in the catalogue.
 *
 * @param event - A parsed event.
 * @remarks
 * The guard exists because `event_type` accepts any string — a type added upstream after this SDK
 * shipped must still be deliverable — and that is exactly what stops TypeScript narrowing the union on
 * an `===` comparison. Ask this first, then switch. A `webhook.ping` is **not** known: it is in no
 * catalogue, and {@link isPingEvent} names it.
 *
 * @example
 * ```ts
 * if (!isKnownEvent(event)) return acknowledge();   // 2xx, and nothing to do
 * if (isSubscriptionEvent(event)) await applyEntitlement(event.data.subscription);
 * ```
 */
export function isKnownEvent(event: AuthWebhookEvent): event is KnownAuthEvent {
  return eventTypes.has(event.event_type);
}

/** Whether this is a `subscription.*` event, which carries `data.subscription`. */
export function isSubscriptionEvent(event: AuthWebhookEvent): event is SubscriptionEvent {
  return event.event_type.startsWith("subscription.") && eventTypes.has(event.event_type);
}

/** Whether this is a `customer.created` event, which carries `data.customer`. */
export function isCustomerEvent(event: AuthWebhookEvent): event is CustomerEvent {
  return event.event_type === "customer.created";
}

/** Whether this is the operator's `webhook.ping`. Accept it and answer `2xx`; there is nothing to do. */
export function isPingEvent(event: AuthWebhookEvent): boolean {
  return event.event_type === pingEventType;
}

/** What the verifier needs. */
export interface AuthWebhookInput {
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
 * replay protection: an attacker holding yesterday's body cannot re-stamp it.
 *
 * Then dedupe on `X-Event-Id` ({@link eventIdHeader}) before doing any work, and answer `2xx`
 * **within 5 seconds**, doing the real work asynchronously. Eight failed attempts dead-letter the
 * delivery; five consecutive failures disable your endpoint, which then receives *nothing* — there is
 * no backlog to catch up. Keep a reconciliation poll.
 *
 * **Raise your own alarm when you reject a delivery.** A `2xx` tells the service you answered, never
 * that you verified; a signature that fails is a secret out of step or an attacker, and both are
 * silent on the service's side.
 *
 * @example
 * ```ts
 * export const runtime = "nodejs";   // an edge runtime may transform the body
 *
 * export async function POST(request: Request) {
 *   const rawBody = await request.text();
 *   const verdict = await verifyAuthWebhook({
 *     secret: process.env.AUTH_SERVICE_WEBHOOK_SECRET!,
 *     rawBody,
 *     headers: request.headers,
 *   });
 *   if (!verdict.ok) return new Response(verdict.reason, { status: 401 });
 *
 *   const eventId = request.headers.get("x-event-id");
 *   if (eventId && (await alreadyProcessed(eventId))) return new Response(null, { status: 200 });
 *
 *   const event = parseAuthWebhookEvent(rawBody);
 *   if (!event) return new Response("malformed", { status: 400 });
 *
 *   await enqueue(event);   // the slow work goes off this request
 *   if (eventId) await markProcessed(eventId);
 *   return new Response(null, { status: 200 });
 * }
 * ```
 */
export async function verifyAuthWebhook(input: AuthWebhookInput): Promise<VerifyResult> {
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
 * Ordering across events is **not guaranteed** — two events about one resource can arrive in either
 * order. Reconcile against `occurred_at` and the block's own `status`, never against arrival.
 */
export function parseAuthWebhookEvent(rawBody: string): AuthWebhookEvent | null {
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

  const envelope: AuthEventEnvelope = {
    event_id: candidate.event_id,
    contract_version:
      typeof candidate.contract_version === "number" ? candidate.contract_version : 1,
    occurred_at: candidate.occurred_at,
    service: typeof candidate.service === "string" ? candidate.service : "auth-service",
    account_id: typeof candidate.account_id === "string" ? candidate.account_id : null,
    tenant: {
      kind: typeof tenant.kind === "string" ? tenant.kind : "organization",
      public_id: tenant.public_id,
    },
    correlation_id:
      typeof candidate.correlation_id === "string" ? candidate.correlation_id : candidate.event_id,
    causation_id: typeof candidate.causation_id === "string" ? candidate.causation_id : null,
    hop: typeof candidate.hop === "number" ? candidate.hop : 0,
  };

  // A typed arm must carry the block it promises, or the union would be a lie: a handler reading
  // `data.subscription` on a `subscription.activated` would get `undefined` with no type error.
  if (
    eventType === "subscription.activated" ||
    eventType === "subscription.canceled" ||
    eventType === "subscription.expired"
  ) {
    const subscription = data.subscription as WebhookSubscriptionBlock | undefined;
    if (typeof subscription?.public_id !== "string" || typeof subscription.status !== "string") {
      return null;
    }
    return { ...envelope, event_type: eventType, data: { subscription } };
  }

  if (eventType === "customer.created") {
    const customer = data.customer as WebhookCustomerBlock | undefined;
    if (typeof customer?.public_id !== "string" || typeof customer.status !== "string") return null;
    return { ...envelope, event_type: eventType, data: { customer } };
  }

  return { ...envelope, event_type: eventType, data };
}
