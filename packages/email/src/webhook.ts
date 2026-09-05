/**
 * The outbound webhook: verification, and the event types.
 *
 * @remarks
 * Verification and parsing are two functions on purpose. The signature covers the **raw body**, so a
 * handler must verify before it parses — and a single function that did both would have to parse in
 * order to return anything useful, which is the wrong order.
 *
 * What is different about this service's events is the clock behind them. The retry ladder is
 * bounded by a cron that runs **once a day**: the first attempt is inline and prompt, and every
 * later rung waits for a drain that a quiet service may not run until tomorrow. So a receiver keeps
 * a reconciliation poll — `getMessage` is the authority; an event is a notification.
 */

import { type VerifyResult, verifySignedBody } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";
import type { MessageStatus } from "./status.js";
import type { TemplateRef } from "./types.js";

/** The signature header: `sha256=` plus lowercase hex. */
export const signatureHeader = "X-Signature";

/** The timestamp header: Unix **seconds** at signing time, not milliseconds. */
export const timestampHeader = "X-Signature-Timestamp";

/**
 * The header to dedupe on.
 *
 * @remarks
 * Stable across every retry of the same event. `X-Delivery-Id` is per HTTP attempt and is **not** the
 * one — deduping on it would let every retry through as new.
 */
export const eventIdHeader = "X-Event-Id";

/** Identifies one HTTP attempt. Useful in a log, never as a dedupe key. */
export const deliveryIdHeader = "X-Delivery-Id";

/**
 * The nine message event types.
 *
 * @remarks
 * Six are **transitions** — a status changed. Three are **observations**: `message.dropped`,
 * `message.opened` and `message.clicked` report something learned that moves no status; the
 * message keeps the status it already had. `message.dropped` is *not* the suppression event: a
 * suppression is a synchronous `409` on the send, and there is no `message.suppressed`.
 *
 * Not every type fires for every tenant. `message.delivered` never fires for an SMTP tenant,
 * because SMTP has no event feed at all and `sent` is terminal there. Act on `message.sent` and
 * treat `delivered` as a bonus where the provider offers it.
 */
export type EmailMessageEventType = components["schemas"]["WebhookEventType"];

/**
 * Which events the service sends today: the nine message types plus the connectivity test.
 *
 * @remarks
 * `webhook.ping` comes only from an operator's `POST …/test`, never from a real send, and
 * carries no message.
 */
export type EmailWebhookEventType = EmailMessageEventType | "webhook.ping";

/**
 * The message block a `message.*` event carries in `data`.
 *
 * @remarks
 * A snapshot, frozen at emission. Every member was true at `occurred_at` and is never updated; a
 * redelivery of the same `event_id` carries the same bytes. **An old event is not a current
 * fact** — read the message back before acting on anything expensive.
 *
 * `to` is **opt-in per endpoint** (`include_recipient`, default off) and absent otherwise. Carry
 * your own id in `metadata` rather than expecting the address.
 */
export interface WebhookMessageBlock {
  readonly public_id: string;
  /** The status at `occurred_at`. On an observation, the status the message already had. */
  readonly status: MessageStatus;
  readonly template: Readonly<Partial<TemplateRef>>;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  /** Present only when the endpoint opted in. */
  readonly to?: string;
}

/**
 * The envelope every event from every Lamido service carries.
 *
 * @remarks
 * Everything outside `data` is metadata — who, when, in what chain — so one piece of a receiver's
 * code can verify, log and dedupe any event before it knows what the event is.
 */
export interface EmailEventEnvelope {
  /** The envelope version these bytes were rendered at. */
  readonly schema_version: number;
  /** UUIDv7, equal to `X-Event-Id`. The dedupe key. */
  readonly event_id: string;
  /** ISO 8601 UTC. The **provider's** clock where there is one, not when the webhook was sent. */
  readonly occurred_at: string;
  /** `"email-service"`. What makes a multi-service receiver's logs legible. */
  readonly service: string;
  /**
   * lamido-admin's account id for the tenant.
   *
   * @remarks
   * **Can be `null`** — an unpaired tenant. Harmless for your own endpoint; treat it as "unpaired",
   * not as an error.
   */
  readonly account_id: string | null;
  /**
   * Shared by every event in one causal chain across services. Equals `event_id` on a natively
   * produced event.
   *
   * @remarks
   * Log it. A payment succeeds, invoice-service issues an invoice, email-service sends it: three
   * events, three services, one `correlation_id`. It turns *"the customer paid and got no
   * receipt"* into one query.
   */
  readonly correlation_id: string;
  /** `0` natively; `inbound.hop + 1` for an event emitted while reacting to another service's. */
  readonly hop: number;
}

/**
 * One delivery, discriminated on `event_type`.
 *
 * @remarks
 * A `message.*` event carries the message block as `data`; a `webhook.ping` carries no message.
 * The union makes reading `event.data.public_id` on a ping a compile error rather than an
 * `undefined` at runtime.
 *
 * The third arm is the one that matters operationally: **an event type this SDK has never heard of
 * is a normal delivery**, not a malformed one. Conventions §11 says a new event type is not a
 * breaking change, and a receiver answering non-2xx for it would dead-letter a delivery that was
 * fine. `event_type` stays assignable from any string for that reason, and narrowing on a known
 * literal still selects the right arm.
 *
 * There is no event for `queued` (you got the `202`), for `sending` (internal), or for
 * `suppressed` (a synchronous `409` on the send).
 */
export type EmailWebhookEvent = EmailEventEnvelope &
  (
    | {
        readonly event_type: EmailMessageEventType;
        readonly data: WebhookMessageBlock;
      }
    | {
        readonly event_type: "webhook.ping";
        readonly data: Readonly<Record<string, unknown>>;
      }
    | {
        // `string & {}` keeps the literals above in autocompletion while still accepting a type
        // added upstream after this SDK shipped.
        readonly event_type: string & Record<never, never>;
        readonly data: Readonly<Record<string, unknown>>;
      }
  );

/** A delivery whose type this SDK knows: a message event with its block, or the ping. */
export type KnownEmailEvent = Extract<
  EmailWebhookEvent,
  { readonly event_type: EmailWebhookEventType }
>;

/** A `message.*` delivery, whose `data` is the message block. */
export type EmailMessageEvent = Extract<
  EmailWebhookEvent,
  { readonly event_type: EmailMessageEventType }
>;

/**
 * Whether this is an event type this SDK knows.
 *
 * @param event - A parsed event.
 * @remarks
 * The guard exists because `event_type` accepts any string — a type added upstream after this SDK
 * shipped must still be deliverable — and that is exactly what stops TypeScript narrowing the
 * union on an `===` comparison. Ask this first, then switch; and answer `2xx` when it says no.
 *
 * @example
 * ```ts
 * if (!isKnownEvent(event)) return acknowledge();   // 2xx, and nothing to do
 * if (event.event_type === "webhook.ping") return acknowledge();
 * await settle(event.data.public_id, event.data.status);
 * ```
 */
export function isKnownEvent(event: EmailWebhookEvent): event is KnownEmailEvent {
  return event.event_type === "webhook.ping" || messageEventTypes.has(event.event_type);
}

/**
 * Whether this is a `message.*` event, and therefore carries the message block.
 *
 * @param event - A parsed event.
 * @remarks
 * Branch on `event.data.status` and on your own stored state, **never on arrival order**. The
 * ladder reorders by construction: a `message.sent` whose first attempt failed can land after the
 * `message.delivered` that followed it.
 */
export function isMessageEvent(event: EmailWebhookEvent): event is EmailMessageEvent {
  return messageEventTypes.has(event.event_type);
}

/** What the verifier needs. */
export interface EmailWebhookInput {
  /**
   * The signing secret, used **whole**.
   *
   * @remarks
   * The `whsec_` prefix is key material, not a label to strip. Stripping it produces a valid-looking
   * digest that never matches. Each endpoint has its own secret, so a compromised receiver cannot
   * forge events to another.
   */
  readonly secret: string;
  /**
   * The request body **as text**, read before any parsing.
   *
   * @remarks
   * `JSON.parse` then re-serialise reorders keys and changes whitespace, and the signature stops
   * matching. `await request.text()`, not `.json()`; keep body-parsing middleware away from the
   * route; use the Node runtime, because an edge runtime may transform the body.
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
 * **at-least-once and unordered**, and the dedupe is not optional.
 *
 * And answer `2xx` **within 5 seconds**, doing the real work asynchronously. A slower response is a
 * failed attempt, and five consecutive dead-letters disable your endpoint entirely — after which
 * nothing arrives to tell you what you missed.
 *
 * @example
 * ```ts
 * export const runtime = "nodejs";   // an edge runtime may transform the body
 *
 * export async function POST(request: Request) {
 *   const rawBody = await request.text();
 *   const verdict = await verifyEmailWebhook({
 *     secret: process.env.EMAIL_SERVICE_WEBHOOK_SECRET!,
 *     rawBody,
 *     headers: request.headers,
 *   });
 *   if (!verdict.ok) return new Response(verdict.reason, { status: 401 });
 *
 *   const eventId = request.headers.get("x-event-id");
 *   if (eventId && (await alreadyProcessed(eventId))) return new Response(null, { status: 200 });
 *
 *   const event = parseEmailWebhookEvent(rawBody);
 *   if (!event) return new Response("malformed", { status: 400 });
 *
 *   await enqueue(event);   // the slow work goes off this request
 *   if (eventId) await markProcessed(eventId);
 *   return new Response(null, { status: 200 });
 * }
 * ```
 */
export async function verifyEmailWebhook(input: EmailWebhookInput): Promise<VerifyResult> {
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
 */
export function parseEmailWebhookEvent(rawBody: string): EmailWebhookEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;

  const eventType = candidate.event_type;
  const data = candidate.data as Record<string, unknown> | null | undefined;

  // Only the envelope members the Markdown shows on every delivery are required here. The event
  // type is deliberately NOT checked against a list: an unrecognised type is a valid delivery this
  // receiver does not act on, and rejecting it would dead-letter it.
  if (typeof eventType !== "string" || eventType === "") return null;
  if (typeof candidate.event_id !== "string" || typeof candidate.occurred_at !== "string")
    return null;
  if (typeof data !== "object" || data === null) return null;

  const envelope: EmailEventEnvelope = {
    schema_version: typeof candidate.schema_version === "number" ? candidate.schema_version : 1,
    event_id: candidate.event_id,
    occurred_at: candidate.occurred_at,
    service: typeof candidate.service === "string" ? candidate.service : "email-service",
    account_id: typeof candidate.account_id === "string" ? candidate.account_id : null,
    correlation_id:
      typeof candidate.correlation_id === "string" ? candidate.correlation_id : candidate.event_id,
    hop: typeof candidate.hop === "number" ? candidate.hop : 0,
  };

  // A message event must carry the block its arm promises, or the union would be a lie: a handler
  // reading `data.status` on a `message.bounced` would get `undefined` with no type error.
  if (messageEventTypes.has(eventType)) {
    if (typeof data.public_id !== "string" || typeof data.status !== "string") return null;
    return {
      ...envelope,
      event_type: eventType as EmailMessageEventType,
      data: data as unknown as WebhookMessageBlock,
    };
  }

  return { ...envelope, event_type: eventType, data };
}

/** Every message event type the service sends. `webhook.ping` is checked by name. */
const messageEventTypes: ReadonlySet<string> = new Set<EmailMessageEventType>([
  "message.sent",
  "message.delivered",
  "message.bounced",
  "message.complained",
  "message.failed",
  "message.canceled",
  "message.dropped",
  "message.opened",
  "message.clicked",
]);
