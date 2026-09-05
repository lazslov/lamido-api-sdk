import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifyResult } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  deliveryIdHeader,
  eventIdHeader,
  isKnownEvent,
  isMessageEvent,
  parseEmailWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyEmailWebhook,
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

describe("verifyEmailWebhook against pinned fixtures", () => {
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
      const verdict = await verifyEmailWebhook({
        secret: candidate.secret,
        rawBody: candidate.rawBody,
        headers: headers(candidate),
        nowSeconds: candidate.nowSeconds,
      });
      expect(verdict, candidate.describes).toEqual(candidate.expect);
    },
  );

  it("uses the whole whsec_ secret, prefix included", async () => {
    // The prefix is key material, not a label to strip. The fixture proves the stripped digest fails.
    const stripped = fixture("bad-signature-secret-without-prefix");
    expect(stripped.expect).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("verifyEmailWebhook behaviour", () => {
  const valid = () => fixture("valid-message-delivered");

  it("binds the service's own header names", () => {
    expect(signatureHeader).toBe("X-Signature");
    expect(timestampHeader).toBe("X-Signature-Timestamp");
    expect(eventIdHeader).toBe("X-Event-Id");
    expect(deliveryIdHeader).toBe("X-Delivery-Id");
  });

  it("reads headers case-insensitively, which is what an edge runtime delivers", async () => {
    const one = valid();
    const verdict = await verifyEmailWebhook({
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

    const verdict = await verifyEmailWebhook({
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
    await expect(verifyEmailWebhook(input)).resolves.toEqual({ ok: true });
    await expect(verifyEmailWebhook(input)).resolves.toEqual({ ok: true });
  });

  it("honours a custom tolerance", async () => {
    const stale = fixture("stale-timestamp");
    await expect(
      verifyEmailWebhook({
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
      verifyEmailWebhook({
        secret: "whsec_x",
        rawBody: "",
        headers: new Headers(),
        nowSeconds: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("parseEmailWebhookEvent", () => {
  it("finds the message block as data, identified by public_id", () => {
    // On this service `data` IS the message block — there is no `data.message` layer.
    const event = parseEmailWebhookEvent(fixture("valid-message-delivered").rawBody);
    expect(event && isMessageEvent(event) && event.data.public_id).toBe(
      "0194c7a1-0000-7000-8000-000000000002",
    );
    expect(event && isMessageEvent(event) && event.data.status).toBe("delivered");
    expect(event && isMessageEvent(event) && event.data.metadata).toEqual({ order_id: "A-2291" });
  });

  it("carries the chain metadata a receiver logs and dedupes on", () => {
    const event = parseEmailWebhookEvent(fixture("valid-message-delivered").rawBody);
    expect(event?.schema_version).toBe(1);
    expect(event?.service).toBe("email-service");
    expect(event?.correlation_id).toBe("0194c7a1-0000-7000-8000-000000000001");
    expect(event?.hop).toBe(0);
  });

  it("leaves the recipient absent unless the endpoint opted in", () => {
    const withoutRecipient = parseEmailWebhookEvent(fixture("valid-message-delivered").rawBody);
    expect(withoutRecipient && isMessageEvent(withoutRecipient) && withoutRecipient.data.to).toBe(
      undefined,
    );

    const withRecipient = parseEmailWebhookEvent(
      fixture("valid-message-bounced-with-recipient").rawBody,
    );
    expect(withRecipient && isMessageEvent(withRecipient) && withRecipient.data.to).toBe(
      "guest@example.com",
    );
  });

  it("reads account_id: null as an unpaired tenant, not as an error", () => {
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-message-delivered").rawBody),
      account_id: null,
    });
    expect(parseEmailWebhookEvent(body)?.account_id).toBeNull();
  });

  it("recognises the ping as known, and not as a message event", () => {
    const event = parseEmailWebhookEvent(fixture("valid-webhook-ping").rawBody);
    if (!event) throw new Error("expected an event");
    expect(event.event_type).toBe("webhook.ping");
    expect(isKnownEvent(event)).toBe(true);
    expect(isMessageEvent(event)).toBe(false);
  });

  it("keeps an event type it has never heard of, rather than rejecting it", () => {
    // Answering non-2xx for an unrecognised type dead-letters a delivery that was fine.
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-message-delivered").rawBody),
      event_type: "message.deferred",
    });
    const event = parseEmailWebhookEvent(body);
    if (!event) throw new Error("expected an event");
    expect(event.event_type).toBe("message.deferred");
    expect(isKnownEvent(event)).toBe(false);
    expect(isMessageEvent(event)).toBe(false);
  });

  it("answers null for a message event with no message block", () => {
    // Inventing an empty one would hand a handler an event with no id to act on.
    const body = JSON.parse(fixture("valid-message-delivered").rawBody) as {
      data: Record<string, unknown>;
    };
    body.data = {};
    expect(parseEmailWebhookEvent(JSON.stringify(body))).toBeNull();
  });

  it("answers null for a body that is not an event", () => {
    expect(parseEmailWebhookEvent("not json")).toBeNull();
    expect(parseEmailWebhookEvent("null")).toBeNull();
    expect(parseEmailWebhookEvent(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseEmailWebhookEvent(JSON.stringify({ event_type: "message.sent" }))).toBeNull();
    expect(
      parseEmailWebhookEvent(
        JSON.stringify({ event_id: "x", event_type: "message.sent", occurred_at: "now" }),
      ),
    ).toBeNull();
  });
});
