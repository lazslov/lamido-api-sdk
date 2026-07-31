import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifyResult } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  deliveryIdHeader,
  eventIdHeader,
  parsePaymentWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyPaymentWebhook,
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

describe("verifyPaymentWebhook against pinned fixtures", () => {
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
      const verdict = await verifyPaymentWebhook({
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

describe("verifyPaymentWebhook behaviour", () => {
  const valid = () => fixture("valid-payment-succeeded");

  it("binds the service's own header names", async () => {
    expect(signatureHeader).toBe("X-Signature");
    expect(timestampHeader).toBe("X-Signature-Timestamp");
    expect(eventIdHeader).toBe("X-Event-Id");
    expect(deliveryIdHeader).toBe("X-Delivery-Id");
  });

  it("reads headers case-insensitively, which is what an edge runtime delivers", async () => {
    const one = valid();
    const verdict = await verifyPaymentWebhook({
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
    const reserialised = JSON.stringify({ payment: parsed.payment, event_id: parsed.event_id });

    const verdict = await verifyPaymentWebhook({
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
    await expect(verifyPaymentWebhook(input)).resolves.toEqual({ ok: true });
    await expect(verifyPaymentWebhook(input)).resolves.toEqual({ ok: true });
  });

  it("honours a custom tolerance", async () => {
    const stale = fixture("stale-timestamp");
    await expect(
      verifyPaymentWebhook({
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
      verifyPaymentWebhook({
        secret: "whsec_x",
        rawBody: "",
        headers: new Headers(),
        nowSeconds: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("parsePaymentWebhookEvent", () => {
  it("does not rename payment.id to public_id", () => {
    // The payload is a frozen wire format. Renaming would hide the discrepancy from someone reading a
    // payload and a REST response side by side — and payment.id IS the payment's public_id.
    const event = parsePaymentWebhookEvent(fixture("valid-payment-succeeded").rawBody);
    expect(event?.payment.id).toBe("019e4a91-0000-7000-8000-000000000002");
    expect(event?.payment).not.toHaveProperty("public_id");
  });

  it("keeps the amount as the string it arrived as", () => {
    const event = parsePaymentWebhookEvent(fixture("valid-payment-succeeded").rawBody);
    expect(event?.payment.amount_minor).toBe("1000");
  });

  it("carries the extra refund block on a refund event, with the payment's new status", () => {
    const event = parsePaymentWebhookEvent(fixture("valid-refund-succeeded").rawBody);
    expect(event?.event_type).toBe("refund.succeeded");
    expect(event?.payment.status).toBe("partially_refunded");
    if (event?.event_type !== "refund.succeeded") throw new Error("expected a refund event");
    expect(event.refund).toEqual({
      id: "019e4a95-77c1-7a02-8f31-9b0c4d5e6f70",
      status: "succeeded",
      amount_minor: "400",
      currency: "HUF",
    });
  });

  it("answers null for a refund event with no refund block", () => {
    // Inventing an empty one would hand a handler a zero-amount refund.
    const body = JSON.parse(fixture("valid-refund-succeeded").rawBody) as Record<string, unknown>;
    delete body.refund;
    expect(parsePaymentWebhookEvent(JSON.stringify(body))).toBeNull();
  });

  it("answers null for a body that is not an event", () => {
    expect(parsePaymentWebhookEvent("not json")).toBeNull();
    expect(parsePaymentWebhookEvent("null")).toBeNull();
    expect(parsePaymentWebhookEvent(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parsePaymentWebhookEvent(JSON.stringify({ event_type: "payment.invented" }))).toBeNull();
  });

  it("answers null when the payment block is missing", () => {
    expect(
      parsePaymentWebhookEvent(
        JSON.stringify({ event_id: "x", event_type: "payment.succeeded", created_at: "now" }),
      ),
    ).toBeNull();
  });
});
