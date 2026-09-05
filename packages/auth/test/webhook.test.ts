import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifyResult } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  deliveryIdHeader,
  eventIdHeader,
  isCustomerEvent,
  isKnownEvent,
  isPingEvent,
  isSubscriptionEvent,
  parseAuthWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyAuthWebhook,
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

describe("verifyAuthWebhook against pinned fixtures", () => {
  it("covers a non-ASCII body and every failure reason", () => {
    expect(fixtures.some((candidate) => /Árvíztűrő|árvíztűrő/.test(candidate.rawBody))).toBe(true);
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
      const verdict = await verifyAuthWebhook({
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

describe("verifyAuthWebhook behaviour", () => {
  const valid = () => fixture("valid-subscription-activated");

  it("binds the service's own header names", () => {
    expect(signatureHeader).toBe("X-Signature");
    expect(timestampHeader).toBe("X-Signature-Timestamp");
    expect(eventIdHeader).toBe("X-Event-Id");
    expect(deliveryIdHeader).toBe("X-Delivery-Id");
  });

  it("reads headers case-insensitively, which is what an edge runtime delivers", async () => {
    const one = valid();
    const verdict = await verifyAuthWebhook({
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

    const verdict = await verifyAuthWebhook({
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
    await expect(verifyAuthWebhook(input)).resolves.toEqual({ ok: true });
    await expect(verifyAuthWebhook(input)).resolves.toEqual({ ok: true });
  });

  it("honours a custom tolerance", async () => {
    const stale = fixture("stale-timestamp");
    await expect(
      verifyAuthWebhook({
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
      verifyAuthWebhook({
        secret: "whsec_x",
        rawBody: "",
        headers: new Headers(),
        nowSeconds: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("parseAuthWebhookEvent", () => {
  it("finds the subscription under data, with the status the type's participle promises", () => {
    const event = parseAuthWebhookEvent(fixture("valid-subscription-activated").rawBody);
    expect(event && isSubscriptionEvent(event) && event.data.subscription).toEqual({
      public_id: "019f0a10-0000-7000-8000-0000000000c3",
      status: "active",
      plan: "starter",
      website: null,
      period_start: "2026-08-01T00:00:00.000Z",
      period_end: "2026-09-01T00:00:00.000Z",
    });
  });

  it("carries the chain metadata a receiver logs and dedupes on", () => {
    const event = parseAuthWebhookEvent(fixture("valid-subscription-activated").rawBody);
    expect(event?.correlation_id).toBe(event?.event_id);
    expect(event?.causation_id).toBeNull();
    expect(event?.hop).toBe(0);
    expect(event?.tenant.kind).toBe("organization");
    expect(event?.service).toBe("auth-service");
  });

  it("finds the customer block, including an opted-in email", () => {
    const event = parseAuthWebhookEvent(fixture("valid-non-ascii").rawBody);
    expect(event && isCustomerEvent(event) && event.data.customer.status).toBe("active");
    expect(event && isCustomerEvent(event) && event.data.customer.email).toBe(
      "árvíztűrő.tükörfúrógép@example.com",
    );
    expect(event && isKnownEvent(event)).toBe(true);
  });

  it("keeps a webhook.ping as a delivery to acknowledge, outside the catalogue", () => {
    const event = parseAuthWebhookEvent(fixture("valid-webhook-ping").rawBody);
    expect(event?.event_type).toBe("webhook.ping");
    expect(event?.account_id).toBeNull();
    expect(event && isPingEvent(event)).toBe(true);
    expect(event && isKnownEvent(event)).toBe(false);
  });

  it("keeps a membership event with whatever data it carries", () => {
    // The knowledge base documents that the event fires and does not show its block, so the parser
    // requires nothing of `data` beyond being an object.
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-subscription-activated").rawBody),
      event_type: "membership.revoked",
      data: { membership: { public_id: "m1" } },
    });
    const event = parseAuthWebhookEvent(body);
    expect(event?.event_type).toBe("membership.revoked");
    expect(event && isKnownEvent(event)).toBe(true);
    expect(event?.data).toEqual({ membership: { public_id: "m1" } });
  });

  it("keeps an event type it has never heard of, rather than rejecting it", () => {
    // Answering non-2xx for an unrecognised type dead-letters a delivery that was fine.
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-subscription-activated").rawBody),
      event_type: "subscription.renewed",
      data: { subscription: { public_id: "x", status: "active" } },
    });
    const event = parseAuthWebhookEvent(body);
    expect(event?.event_type).toBe("subscription.renewed");
    expect(event && isKnownEvent(event)).toBe(false);
    expect(event && isSubscriptionEvent(event)).toBe(false);
  });

  it("answers null for a subscription event with no subscription block", () => {
    const body = JSON.parse(fixture("valid-subscription-activated").rawBody) as {
      data: Record<string, unknown>;
    };
    delete body.data.subscription;
    expect(parseAuthWebhookEvent(JSON.stringify(body))).toBeNull();
  });

  it("answers null for a customer event with no customer block", () => {
    const body = JSON.parse(fixture("valid-customer-created").rawBody) as {
      data: Record<string, unknown>;
    };
    delete body.data.customer;
    expect(parseAuthWebhookEvent(JSON.stringify(body))).toBeNull();
  });

  it("answers null for a body that is not an event", () => {
    expect(parseAuthWebhookEvent("not json")).toBeNull();
    expect(parseAuthWebhookEvent("null")).toBeNull();
    expect(parseAuthWebhookEvent(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseAuthWebhookEvent(JSON.stringify({ event_type: "customer.created" }))).toBeNull();
  });
});
