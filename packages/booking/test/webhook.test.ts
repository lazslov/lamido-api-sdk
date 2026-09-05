import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifyResult } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  deliveryIdHeader,
  eventIdHeader,
  isKnownEvent,
  parseBookingWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyBookingWebhook,
} from "../src/webhook.js";

/** One pinned fixture. See test/fixtures/webhook/generate.mjs for how they were produced. */
interface WebhookFixture {
  readonly name: string;
  readonly describes: string;
  readonly secret: string;
  readonly rawBody: string;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly nowSeconds: number;
  readonly expect: VerifyResult;
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "webhook");

const fixtures: WebhookFixture[] = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")) as WebhookFixture);

/** The headers the service sends, as a route handler receives them. */
function headers(fixture: WebhookFixture): Headers {
  const built = new Headers();
  if (fixture.signature !== null) built.set(signatureHeader, fixture.signature);
  if (fixture.timestamp !== null) built.set(timestampHeader, fixture.timestamp);
  return built;
}

/** One fixture by name, or a failed test rather than a silent skip. */
function fixture(name: string): WebhookFixture {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`the ${name} fixture is missing`);
  return found;
}

describe("verifyBookingWebhook against pinned fixtures", () => {
  it("covers a non-ASCII body and every failure reason", () => {
    expect(fixtures.some((candidate) => /Árvíztűrő/.test(candidate.rawBody))).toBe(true);
    const reasons = new Set(
      fixtures.flatMap((candidate) => (candidate.expect.ok ? [] : [candidate.expect.reason])),
    );
    expect([...reasons].sort()).toEqual([
      "bad_signature",
      "malformed_timestamp",
      "missing_signature",
      "stale_timestamp",
    ]);
  });

  it.each(fixtures.map((candidate) => [candidate.name, candidate] as const))(
    "%s",
    async (_name, candidate) => {
      const verdict = await verifyBookingWebhook({
        secret: candidate.secret,
        rawBody: candidate.rawBody,
        headers: headers(candidate),
        nowSeconds: candidate.nowSeconds,
      });
      expect(verdict, candidate.describes).toEqual(candidate.expect);
    },
  );

  it("uses the whole whsec_ secret, prefix included", () => {
    // The prefix is key material, not a label to strip. The fixture proves the stripped digest fails.
    expect(fixture("bad-signature-secret-without-prefix").expect).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("verifyBookingWebhook behaviour", () => {
  const valid = () => fixture("valid-booking-confirmed");

  it("binds the service's own header names", () => {
    expect(signatureHeader).toBe("X-Signature");
    expect(timestampHeader).toBe("X-Signature-Timestamp");
    expect(eventIdHeader).toBe("X-Event-Id");
    expect(deliveryIdHeader).toBe("X-Delivery-Id");
  });

  it("reads headers case-insensitively, which is what an edge runtime delivers", async () => {
    const one = valid();
    const verdict = await verifyBookingWebhook({
      secret: one.secret,
      rawBody: one.rawBody,
      headers: new Headers({
        "x-signature": one.signature ?? "",
        "x-signature-timestamp": one.timestamp ?? "",
      }),
      nowSeconds: one.nowSeconds,
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a re-serialised body, which is why rawBody is text", async () => {
    const one = valid();
    const parsed = JSON.parse(one.rawBody) as Record<string, unknown>;
    const reserialised = JSON.stringify({ data: parsed.data, event_id: parsed.event_id });

    const verdict = await verifyBookingWebhook({
      secret: one.secret,
      rawBody: reserialised,
      headers: headers(one),
      nowSeconds: one.nowSeconds,
    });
    expect(verdict).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("verifies the identical delivery twice, because delivery is at-least-once", async () => {
    const one = valid();
    const input = {
      secret: one.secret,
      rawBody: one.rawBody,
      headers: headers(one),
      nowSeconds: one.nowSeconds,
    };
    await expect(verifyBookingWebhook(input)).resolves.toEqual({ ok: true });
    await expect(verifyBookingWebhook(input)).resolves.toEqual({ ok: true });
  });

  it("honours a custom tolerance", async () => {
    const stale = fixture("stale-timestamp");
    await expect(
      verifyBookingWebhook({
        secret: stale.secret,
        rawBody: stale.rawBody,
        headers: headers(stale),
        nowSeconds: stale.nowSeconds,
        toleranceSeconds: 600,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("never throws, whatever arrives", async () => {
    await expect(
      verifyBookingWebhook({
        secret: "whsec_x",
        rawBody: "",
        headers: new Headers(),
        nowSeconds: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("parseBookingWebhookEvent", () => {
  it("finds the four blocks under data, identified by public_id", () => {
    const event = parseBookingWebhookEvent(fixture("valid-booking-confirmed").rawBody);
    if (!event || !isKnownEvent(event)) throw new Error("expected a booking event");
    expect(event.data.booking.public_id).toBe("019e5c31-0000-7000-8000-000000000106");
    expect(event.data.booking.status).toBe("confirmed");
    expect(event.data.location.public_id).toBe("019e5c31-0000-7000-8000-000000000101");
    expect(event.data.service.price_minor).toBe("4500");
    expect(event.data.employee.public_id).toBe("019e5c31-0000-7000-8000-000000000103");
    // No opt-in on this endpoint, so the block is absent rather than `undefined`.
    expect("customer" in event.data).toBe(false);
  });

  it("carries the chain metadata a receiver logs and dedupes on", () => {
    const event = parseBookingWebhookEvent(fixture("valid-booking-confirmed").rawBody);
    expect(event?.correlation_id).toBe(event?.event_id);
    expect(event?.causation_id).toBeNull();
    expect(event?.hop).toBe(0);
    expect(event?.tenant.kind).toBe("tenant");
    expect(event?.service).toBe("booking-service");
  });

  it("carries the customer block where the endpoint opted in", () => {
    const event = parseBookingWebhookEvent(fixture("valid-booking-canceled-with-customer").rawBody);
    if (!event || !isKnownEvent(event)) throw new Error("expected a booking event");
    expect(event.event_type).toBe("booking.canceled");
    // A pending expiry arrives as a cancellation nobody chose.
    expect(event.data.booking.cancellation_reason).toBe("system_pending_expired");
    expect(event.data.customer?.email).toBe("anna@example.com");
  });

  it("keeps an event type it has never heard of, rather than rejecting it", () => {
    // Answering non-2xx for an unrecognised type dead-letters a delivery that was fine.
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-booking-confirmed").rawBody),
      event_type: "booking.waitlisted",
    });
    const event = parseBookingWebhookEvent(body);
    expect(event?.event_type).toBe("booking.waitlisted");
    expect(event && isKnownEvent(event)).toBe(false);
  });

  it("keeps a booking status it has never heard of, on a known event", () => {
    // The enum is open inside /v1. A new status is a string to log, not a reason to fail.
    const parsed = JSON.parse(fixture("valid-booking-confirmed").rawBody) as {
      data: { booking: Record<string, unknown> };
    };
    parsed.data.booking.status = "waitlisted";
    const event = parseBookingWebhookEvent(JSON.stringify(parsed));
    expect(event && isKnownEvent(event) && event.data.booking.status).toBe("waitlisted");
  });

  it("accepts a webhook.ping, which has no booking block and asks only for a 2xx", () => {
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-booking-confirmed").rawBody),
      event_type: "webhook.ping",
      data: { message: "hello" },
    });
    const event = parseBookingWebhookEvent(body);
    expect(event?.event_type).toBe("webhook.ping");
    expect(event && isKnownEvent(event)).toBe(false);
  });

  it("answers null for a known event missing a block its arm promises", () => {
    // A handler reading `data.booking.status` on a `booking.confirmed` must never get `undefined`.
    const parsed = JSON.parse(fixture("valid-booking-confirmed").rawBody) as {
      data: Record<string, unknown>;
    };
    delete parsed.data.service;
    expect(parseBookingWebhookEvent(JSON.stringify(parsed))).toBeNull();
  });

  it("answers null for a body that is not an event", () => {
    expect(parseBookingWebhookEvent("not json")).toBeNull();
    expect(parseBookingWebhookEvent("null")).toBeNull();
    expect(parseBookingWebhookEvent(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseBookingWebhookEvent(JSON.stringify({ event_type: "booking.created" }))).toBeNull();
    expect(
      parseBookingWebhookEvent(
        JSON.stringify({ event_id: "x", event_type: "booking.created", occurred_at: "now" }),
      ),
    ).toBeNull();
  });
});
