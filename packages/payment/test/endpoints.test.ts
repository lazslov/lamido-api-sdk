import { idempotencyKey } from "@lamido/api-core";
import { describe, expect, it } from "vitest";
import { PaymentApiError } from "../src/errors.js";
import { huf, minorUnits } from "../src/money.js";
import {
  fetchStub,
  jsonResponse,
  payment,
  paymentClient,
  problemResponse,
  refund,
  testApiKey,
  testBaseUrl,
} from "./stubs/fetch.js";

const key = idempotencyKey("order-12345-attempt-1");

describe("createPayment", () => {
  it("posts the body with the idempotency key as a header", async () => {
    const stub = fetchStub([jsonResponse(payment(), 201)]);
    await paymentClient(stub).createPayment(
      { merchant_payment_ref: "order-12345", amount_minor: huf(2500), currency: "HUF" },
      key,
    );

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/payments`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe("order-12345-attempt-1");
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApiKey}`);
    expect(stub.lastBody()).toEqual({
      merchant_payment_ref: "order-12345",
      amount_minor: "2500",
      currency: "HUF",
    });
  });

  it("reports replayed: false on a 201 and true on a 200", async () => {
    const created = fetchStub([jsonResponse(payment(), 201)]);
    expect((await paymentClient(created).createPayment(body(), key)).replayed).toBe(false);

    const replayed = fetchStub([jsonResponse(payment(), 200, { "idempotent-replay": "true" })]);
    expect((await paymentClient(replayed).createPayment(body(), key)).replayed).toBe(true);
  });

  it("reads the header too, so a proxy that rewrites the status cannot hide a replay", async () => {
    const stub = fetchStub([jsonResponse(payment(), 201, { "idempotent-replay": "true" })]);
    expect((await paymentClient(stub).createPayment(body(), key)).replayed).toBe(true);
  });

  it("sends an array in a request body with its order intact", async () => {
    // Object keys are sorted for the idempotency hash, but ARRAY ORDER IS SIGNIFICANT: reordering one
    // changes the hash, so the same request would conflict instead of replaying.
    const stub = fetchStub([jsonResponse(payment(), 201)]);
    await paymentClient(stub).createPayment(
      { ...body(), metadata: { items: ["c", "a", "b"], nested: [{ n: 2 }, { n: 1 }] } },
      key,
    );

    expect(stub.lastBodyText()).toContain('"items":["c","a","b"]');
    expect(stub.lastBodyText()).toContain('"nested":[{"n":2},{"n":1}]');
  });

  it("does not default the provider", async () => {
    // Omitted with one active credential uses it; omitted with two is a 400. Guessing which PSP
    // charges a buyer is not a defaulting decision, here either.
    const stub = fetchStub([jsonResponse(payment(), 201)]);
    await paymentClient(stub).createPayment(body(), key);
    expect(stub.lastBody()).not.toHaveProperty("provider");
  });

  it("passes a caller's init through, and sets no fetch mode", async () => {
    const controller = new AbortController();
    const stub = fetchStub([jsonResponse(payment(), 201)]);
    await paymentClient(stub).createPayment(body(), key, { init: { signal: controller.signal } });

    expect(stub.calls.at(-1)?.init.signal).toBe(controller.signal);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });

  it("surfaces a 502 with its provider outcome", async () => {
    const stub = fetchStub([
      problemResponse(502, "urn:payment-service:problem:internal", {
        detail: "The provider could not be reached and the outcome is unknown",
      }),
    ]);
    await expect(paymentClient(stub).createPayment(body(), key)).rejects.toMatchObject({
      providerOutcome: "unknown",
      retryable: true,
    });
  });
});

describe("getPayment", () => {
  it("reads one payment", async () => {
    const stub = fetchStub([jsonResponse(payment({ status: "succeeded" }))]);
    const result = await paymentClient(stub).getPayment("019e4a91");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/payments/019e4a91`);
    expect(result.status).toBe("succeeded");
  });

  it("throws on a 404 rather than answering null, and names the wrong-tenant possibility", async () => {
    const stub = fetchStub([problemResponse(404, "urn:payment-service:problem:not-found")]);
    const caught = await paymentClient(stub)
      .getPayment("019e4a91")
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(PaymentApiError);
    expect((caught as PaymentApiError).message).toMatch(/different merchant/);
  });
});

describe("refreshPayment", () => {
  it("posts to the refresh path", async () => {
    const stub = fetchStub([jsonResponse(payment({ status: "succeeded" }))]);
    await paymentClient(stub).refreshPayment("019e4a91");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/payments/019e4a91/refresh`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
  });

  it("surfaces the throttle's retry_after", async () => {
    const stub = fetchStub([
      problemResponse(429, "urn:payment-service:problem:rate-limit", { retry_after: 5 }),
    ]);
    await expect(paymentClient(stub).refreshPayment("019e4a91")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 5,
      retryable: true,
    });
  });
});

describe("refunds", () => {
  const refundKey = idempotencyKey("refund-order-12345-partial-1");

  it("creates a refund with an explicit amount and currency", async () => {
    const stub = fetchStub([jsonResponse(refund(), 201)]);
    const result = await paymentClient(stub).createRefund(
      "019e4a91",
      { amount_minor: minorUnits("1000"), currency: "HUF", reason: "Two items returned" },
      refundKey,
    );

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/payments/019e4a91/refunds`);
    expect(stub.lastHeaders()["idempotency-key"]).toBe("refund-order-12345-partial-1");
    expect(stub.lastBody()).toEqual({
      amount_minor: "1000",
      currency: "HUF",
      reason: "Two items returned",
    });
    expect(result.replayed).toBe(false);
  });

  it("surfaces a 422 as retryable later, with its code", async () => {
    // All four causes describe the payment's state, which can change.
    const stub = fetchStub([
      problemResponse(422, "urn:payment-service:problem:conflict", {
        code: "refund_exceeds_remaining",
      }),
    ]);
    await expect(
      paymentClient(stub).createRefund(
        "019e4a91",
        { amount_minor: minorUnits("1000"), currency: "HUF" },
        refundKey,
      ),
    ).rejects.toMatchObject({ conflictCode: "refund_exceeds_remaining", retryable: true });
  });

  it("refuses to retry a refund whose outcome is unknown", async () => {
    const stub = fetchStub([
      problemResponse(502, "urn:payment-service:problem:internal", {
        detail: "The refund was sent but the provider did not answer",
      }),
    ]);
    await expect(
      paymentClient(stub).createRefund(
        "019e4a91",
        { amount_minor: minorUnits("1000"), currency: "HUF" },
        refundKey,
      ),
    ).rejects.toMatchObject({ providerOutcome: "refund_unknown", retryable: false });
  });

  it("lists a payment's refunds as a bare array", async () => {
    // No envelope on this service: the resource itself is the body.
    const stub = fetchStub([jsonResponse([refund(), refund({ public_id: "second" })])]);
    const refunds = await paymentClient(stub).listRefunds("019e4a91");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/payments/019e4a91/refunds`);
    expect(refunds).toHaveLength(2);
  });

  it("reads one refund by its own public id", async () => {
    const stub = fetchStub([jsonResponse(refund({ outcome_unknown: true }))]);
    const result = await paymentClient(stub).getRefund("019e4a95");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/refunds/019e4a95`);
    expect(result.outcome_unknown).toBe(true);
  });
});

describe("listWebhookDeliveries", () => {
  it("sends no query when nothing was asked for, keeping the service's own default", async () => {
    const stub = fetchStub([jsonResponse([])]);
    await paymentClient(stub).listWebhookDeliveries();
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/webhook-deliveries`);
  });

  it("passes status and limit through", async () => {
    const stub = fetchStub([jsonResponse([])]);
    await paymentClient(stub).listWebhookDeliveries({ status: "all", limit: 100 });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/webhook-deliveries?status=all&limit=100`);
  });
});

/** A minimal valid create body. */
function body() {
  return { merchant_payment_ref: "order-12345", amount_minor: huf(2500), currency: "HUF" } as const;
}
