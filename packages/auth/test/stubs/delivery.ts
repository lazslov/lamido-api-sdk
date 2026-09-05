/**
 * Signed auth webhook deliveries, built the way the service builds them.
 *
 * @remarks
 * The handler suites need a *live* timestamp rather than the pinned fixtures' fixed one, because the
 * handler does not accept an injectable clock — it is a route handler, and a test-only `nowSeconds`
 * parameter on it would be surface a consumer could reach. So these are signed here, with `node:crypto`,
 * deliberately a different implementation from the `crypto.subtle` one under test.
 *
 * The pinned fixtures in `test/fixtures/webhook/` remain the drift guard for the *verifier*; this only
 * produces well-formed input for the *handler*.
 */

import { createHmac } from "node:crypto";
import {
  deliveryIdHeader,
  eventIdHeader,
  signatureHeader,
  timestampHeader,
} from "../../src/webhook.js";

/** The secret both sides of a test share. Not a credential, and shaped to pass the leak guard. */
export const testWebhookSecret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, lowercase hex behind the `sha256=` prefix. */
export function sign(rawBody: string, timestamp: string, secret = testWebhookSecret): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

/** A `subscription.activated` body, in the estate's standard event envelope. */
export function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: "019f0a10-0000-7000-8000-0000000000a1",
    event_type: "subscription.activated",
    contract_version: 1,
    occurred_at: "2026-08-14T09:14:31.204Z",
    service: "auth-service",
    account_id: "7c2e9f14-6b0a-4d21-9e83-5a1c7d0b2f46",
    tenant: { kind: "organization", public_id: "019f0a10-0000-7000-8000-0000000000b2" },
    correlation_id: "019f0a10-0000-7000-8000-0000000000a1",
    causation_id: null,
    hop: 0,
    data: {
      subscription: {
        public_id: "019f0a10-0000-7000-8000-0000000000c3",
        status: "active",
        plan: "starter",
        website: null,
        period_start: "2026-08-01T00:00:00.000Z",
        period_end: "2026-09-01T00:00:00.000Z",
      },
    },
    ...overrides,
  });
}

/** Options for {@link eventRequest}. */
export interface EventOptions {
  readonly body?: string;
  /** Defaults to now. Pass an old value to test the staleness window. */
  readonly timestamp?: string;
  /** Defaults to a correct signature. `null` omits the header. */
  readonly signature?: string | null;
  /** Sign with a different secret, to produce a wrong-but-well-formed signature. */
  readonly secret?: string;
  /** Defaults to the body's own `event_id`. `null` omits the header. */
  readonly eventId?: string | null;
  /** Per HTTP attempt. Present so a test can prove it is *not* the dedupe key. */
  readonly deliveryId?: string;
}

/** A `POST` a route handler can be called with. A real `Request`, not a stub. */
export function eventRequest(options: EventOptions = {}): Request {
  const body = options.body ?? eventBody();
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature =
    options.signature === undefined ? sign(body, timestamp, options.secret) : options.signature;

  const headers = new Headers({ "content-type": "application/json" });
  headers.set(timestampHeader, timestamp);
  if (signature !== null) headers.set(signatureHeader, signature);

  const eventId =
    options.eventId === undefined
      ? (JSON.parse(body) as { event_id?: string }).event_id
      : options.eventId;
  if (eventId) headers.set(eventIdHeader, eventId);
  if (options.deliveryId) headers.set(deliveryIdHeader, options.deliveryId);

  return new Request("https://site.example.com/api/webhooks/auth", {
    method: "POST",
    headers,
    body,
  });
}
