import { derivedIdempotencyKey } from "@lazslov/api-core";
import { createPaymentClient, huf, isTerminal, type PaymentApiError } from "@lazslov/payment";
import { describe, expect, it } from "vitest";
import { allowWrites, failure, paymentTarget, skipReason } from "./config.js";

/**
 * payment-service, live.
 *
 * @remarks
 * **Mode is a property of the credential.** A sandbox `pmk_` cannot touch a real card, and
 * `PAYMENT_PROVIDERS_ALLOW_LIVE` is `false` outside production — the service refuses to construct a live
 * PSP adapter at all. That is what makes any of this safe to run.
 *
 * What is *not* safe to assume is that a preview deployment is a scratch environment. As deployed, this
 * service's preview and production share one `DATABASE_URL` and one `PUBLIC_BASE_URL`, so a payment
 * created from a preview is a real production row and its PSP callbacks are delivered to production.
 * Every case that creates anything is therefore behind `LIVE_ALLOW_WRITES`.
 */

/** An id that is well-formed and belongs to nobody. */
const strangerId = "019e0000-0000-7000-8000-000000000000";

describe.skipIf(!paymentTarget.ready)("payment-service live", () => {
  const client = (extra: Record<string, unknown> = {}) =>
    createPaymentClient({
      baseUrl: paymentTarget.baseUrl,
      apiKey: paymentTarget.keys.merchant,
      ...extra,
    });

  it("rejects a major-unit amount, confirming the local money type matches the service", async () => {
    // `minorUnits("25.00")` throws locally. This asserts the service would have refused it too — i.e.
    // the SDK's rule is the service's rule, not a stricter invention that blocks legitimate amounts.
    const error = await failure<PaymentApiError>(() =>
      client().createPayment(
        // Cast because the type exists precisely to make this unwritable. The point is the wire.
        { merchant_payment_ref: "sdk-live-probe", amount_minor: "25.00", currency: "HUF" } as never,
        derivedIdempotencyKey("sdk-live-probe-major-units", 1),
      ),
    );

    expect(error.status).toBe(400);
    expect(error.type).toContain("validation");
  });

  it("rejects a request carrying an Origin header BEFORE authenticating it", async () => {
    // The tripwire's *ordering* is the assertion, so this goes out with a deliberately wrong key: a 403
    // proves Origin was checked first, and a 401 would prove it was not.
    const error = await failure<PaymentApiError>(() =>
      client({
        apiKey: "pmk_YOUR_WRONG_KEY_probe000",
        defaultInit: { headers: { Origin: "https://attacker.example.com" } },
      }).getPayment(strangerId),
    );

    expect(error.status).toBe(403);
  });

  it("answers 404 for a payment id this merchant does not own", async () => {
    // Every read is scoped to the key's merchant inside the same SQL predicate that fetches the row, so
    // another merchant's id is indistinguishable from one that does not exist — which is why the SDK
    // never maps a 404 here to null.
    const error = await failure<PaymentApiError>(() => client().getPayment(strangerId));

    expect(error.status).toBe(404);
    expect(error.type).toContain("not-found");
  });

  it("rejects an unknown key with a 401", async () => {
    const error = await failure<PaymentApiError>(() =>
      client({ apiKey: "pmk_YOUR_UNKNOWN_KEY_probe0" }).getPayment(strangerId),
    );

    expect(error.status).toBe(401);
  });

  it.skipIf(!allowWrites)("creates a sandbox payment, reads it, and replays the key", async () => {
    // The documented checklist item. A replay must answer 200 with the frozen body of the first
    // request — and the SDK must report `replayed: true` from the status, not from the body.
    const key = derivedIdempotencyKey(`sdk-live-probe-${Math.trunc(performance.now())}`, 1);
    const body = {
      merchant_payment_ref: "sdk-live-probe",
      amount_minor: huf(100),
      currency: "HUF" as const,
    };

    const created = await client().createPayment(body, key);
    expect(created.replayed).toBe(false);
    // The single most important assertion in this file: a sandbox credential produced a sandbox payment.
    expect(created.payment.mode).toBe("sandbox");

    const read = await client().getPayment(created.payment.public_id);
    expect(read.public_id).toBe(created.payment.public_id);
    expect(isTerminal(read.status)).toBe(false);

    const replay = await client().createPayment(body, key);
    expect(replay.replayed).toBe(true);
    expect(replay.payment.public_id).toBe(created.payment.public_id);
  });

  it.skipIf(!allowWrites)("throttles a second refresh within five seconds", async () => {
    // `last_refreshed_at` is written BEFORE the provider call, so a failed refresh consumes the window
    // too — which is what stops a retry loop hammering a PSP that is timing out.
    const key = derivedIdempotencyKey(`sdk-live-throttle-${Math.trunc(performance.now())}`, 1);
    const { payment } = await client().createPayment(
      { merchant_payment_ref: "sdk-live-probe", amount_minor: huf(100), currency: "HUF" },
      key,
    );

    await client().refreshPayment(payment.public_id);
    const error = await failure<PaymentApiError>(() => client().refreshPayment(payment.public_id));

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBeTypeOf("number");
  });
});

describe.skipIf(paymentTarget.ready)("payment-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(paymentTarget)}`);
    expect(paymentTarget.ready).toBe(false);
  });
});
