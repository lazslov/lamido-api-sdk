import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifyResult } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  deliveryIdHeader,
  eventIdHeader,
  isKnownEvent,
  parseWebshopWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyWebshopWebhook,
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

describe("verifyWebshopWebhook against pinned fixtures", () => {
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
      const verdict = await verifyWebshopWebhook({
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

describe("verifyWebshopWebhook behaviour", () => {
  const valid = () => fixture("valid-order-confirmed");

  it("binds the service's own header names", () => {
    expect(signatureHeader).toBe("X-Signature");
    expect(timestampHeader).toBe("X-Signature-Timestamp");
    expect(eventIdHeader).toBe("X-Event-Id");
    expect(deliveryIdHeader).toBe("X-Delivery-Id");
  });

  it("reads headers case-insensitively, which is what an edge runtime delivers", async () => {
    const one = valid();
    const verdict = await verifyWebshopWebhook({
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

    const verdict = await verifyWebshopWebhook({
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
    await expect(verifyWebshopWebhook(input)).resolves.toEqual({ ok: true });
    await expect(verifyWebshopWebhook(input)).resolves.toEqual({ ok: true });
  });

  it("honours a custom tolerance", async () => {
    const stale = fixture("stale-timestamp");
    await expect(
      verifyWebshopWebhook({
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
      verifyWebshopWebhook({
        secret: "whsec_x",
        rawBody: "",
        headers: new Headers(),
        nowSeconds: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("parseWebshopWebhookEvent", () => {
  it("finds the order under data, identified by public_id", () => {
    const event = parseWebshopWebhookEvent(fixture("valid-order-confirmed").rawBody);
    expect(event && isKnownEvent(event) && event.data.order.public_id).toBe(
      "019f1c40-0000-7000-8000-0000000000c3",
    );
  });

  it("carries the chain metadata a receiver logs and dedupes on", () => {
    // The documented example was caused by a payment-service event: hop 1, and a causation id.
    const event = parseWebshopWebhookEvent(fixture("valid-order-confirmed").rawBody);
    expect(event?.correlation_id).toBe("019f1c31-0000-7000-8000-00000000f0a1");
    expect(event?.causation_id).toBe("019f1c31-0000-7000-8000-00000000f0a1");
    expect(event?.hop).toBe(1);
    expect(event?.tenant.kind).toBe("shop");
    expect(event?.service).toBe("webshop-service");
  });

  it("keeps money as the strings they arrived as, with tax contained", () => {
    const event = parseWebshopWebhookEvent(fixture("valid-order-confirmed").rawBody);
    if (!event || !isKnownEvent(event)) throw new Error("expected a known event");
    expect(event.data.order.grand_total).toBe("13490");
    expect(event.data.order.tax_total).toBe("2854");
    expect(event.data.order.items[0]?.quantity).toBe(1);
  });

  it("reads the status off an order.created, which is an observation", () => {
    // "created" is not a status, so nothing binds `data.order.status` on it. Today it is `pending`,
    // and the service deliberately does not promise that.
    const event = parseWebshopWebhookEvent(fixture("valid-order-created").rawBody);
    if (!event || !isKnownEvent(event)) throw new Error("expected a known event");
    expect(event.event_type).toBe("order.created");
    expect(event.data.order.status).toBe("pending");
  });

  it("carries the customer block only when the endpoint opted in", () => {
    const body = JSON.parse(fixture("valid-order-confirmed").rawBody) as {
      data: Record<string, unknown>;
    };
    const without = parseWebshopWebhookEvent(JSON.stringify(body));
    expect(without && isKnownEvent(without) && without.data.customer).toBeUndefined();

    body.data.customer = {
      customer_id: null,
      email: "ada@example.com",
      shipping_address: {
        name: "Ada Lovelace",
        line1: "Kossuth Lajos utca 12",
        line2: null,
        city: "Budapest",
        postal_code: "1053",
        country: "HU",
        phone: null,
      },
      billing_address: null,
    };
    const withCustomer = parseWebshopWebhookEvent(JSON.stringify(body));
    expect(withCustomer && isKnownEvent(withCustomer) && withCustomer.data.customer?.email).toBe(
      "ada@example.com",
    );
  });

  it("keeps an event type it has never heard of, rather than rejecting it", () => {
    // Answering non-2xx for an unrecognised type dead-letters a delivery that was fine.
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-order-confirmed").rawBody),
      event_type: "order.disputed",
    });
    const event = parseWebshopWebhookEvent(body);
    expect(event?.event_type).toBe("order.disputed");
    expect(event && isKnownEvent(event)).toBe(false);
  });

  it("accepts the operator's webhook.ping, whose data is empty", () => {
    const body = JSON.stringify({
      ...JSON.parse(fixture("valid-order-confirmed").rawBody),
      event_type: "webhook.ping",
      data: {},
    });
    const event = parseWebshopWebhookEvent(body);
    expect(event?.event_type).toBe("webhook.ping");
    expect(event?.data).toEqual({});
  });

  it("answers null for a known type with no order block", () => {
    // Inventing an empty one would hand a handler an order with no id and no status.
    const body = JSON.parse(fixture("valid-order-confirmed").rawBody) as {
      data: Record<string, unknown>;
    };
    delete body.data.order;
    expect(parseWebshopWebhookEvent(JSON.stringify(body))).toBeNull();
  });

  it("answers null for a body that is not an event", () => {
    expect(parseWebshopWebhookEvent("not json")).toBeNull();
    expect(parseWebshopWebhookEvent("null")).toBeNull();
    expect(parseWebshopWebhookEvent(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseWebshopWebhookEvent(JSON.stringify({ event_type: "order.invented" }))).toBeNull();
  });
});
