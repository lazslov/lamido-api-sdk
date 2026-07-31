import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { huf, minorUnits } from "../src/money.js";
import type { CreatePaymentInput, CreateRefundInput } from "../src/types.js";
import { fetchStub, jsonResponse, payment, paymentClient } from "./stubs/fetch.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The runtime bodies exist so the file is also
 * a readable list of what the types forbid.
 */

describe("an amount cannot be a bare string or a number", () => {
  it("rejects a major-unit string at the type level", () => {
    const bad = {
      merchant_payment_ref: "order-12345",
      // @ts-expect-error — "25.00" is not MinorUnits: thinking in major units must not compile.
      amount_minor: "25.00",
      currency: "HUF",
    } satisfies CreatePaymentInput;
    expect(bad.amount_minor).toBe("25.00");
  });

  it("rejects a canonical-looking string that never went through a constructor", () => {
    const bad = {
      merchant_payment_ref: "order-12345",
      // @ts-expect-error — even a correct-looking "2500" must be built by huf/eurCents/minorUnits.
      amount_minor: "2500",
      currency: "HUF",
    } satisfies CreatePaymentInput;
    expect(bad.amount_minor).toBe("2500");
  });

  it("rejects a number", () => {
    const bad = {
      merchant_payment_ref: "order-12345",
      // @ts-expect-error — an amount never goes into a JavaScript number.
      amount_minor: 2500,
      currency: "HUF",
    } satisfies CreatePaymentInput;
    expect(bad.amount_minor).toBe(2500);
  });

  it("rejects an unsupported currency", () => {
    const bad = {
      merchant_payment_ref: "order-12345",
      amount_minor: huf(2500),
      // @ts-expect-error — two currencies, deliberately.
      currency: "USD",
    } satisfies CreatePaymentInput;
    expect(bad.currency).toBe("USD");
  });

  it("accepts what the constructors produce", () => {
    const good: CreatePaymentInput = {
      merchant_payment_ref: "order-12345",
      amount_minor: huf(2500),
      currency: "HUF",
    };
    const refund: CreateRefundInput = { amount_minor: minorUnits("1000"), currency: "HUF" };
    expect([good.amount_minor, refund.amount_minor]).toEqual(["2500", "1000"]);
  });
});

describe("a create cannot happen without an idempotency key", () => {
  const client = paymentClient(fetchStub([jsonResponse(payment(), 201)]));
  const body = { merchant_payment_ref: "o", amount_minor: huf(1), currency: "HUF" } as const;
  const refundBody = { amount_minor: huf(1), currency: "HUF" } as const;

  it("has no createPayment overload without one", () => {
    // The argument list is on one line on purpose: an @ts-expect-error applies to the line that
    // follows it, so a formatter wrapping the call would move the error out from under the directive.
    // @ts-expect-error — the key is the second argument and there is no overload lacking it.
    const call = () => client.createPayment(body);
    expect(typeof call).toBe("function");
  });

  it("has no createRefund overload without one", () => {
    // @ts-expect-error — same rule on the endpoint that moves money back out.
    const call = () => client.createRefund("019e", refundBody);
    expect(typeof call).toBe("function");
  });

  it("rejects a raw string as a key", () => {
    // @ts-expect-error — IdempotencyKey is branded: it must go through idempotencyKey().
    const call = () => client.createPayment(body, "order-1");
    expect(typeof call).toBe("function");
  });

  it("accepts a validated key", () => {
    expect(typeof idempotencyKey("order-12345-attempt-1")).toBe("string");
  });
});

describe("the client exposes no mode switch", () => {
  it("has no sandbox or live option, because mode is a property of the credential", () => {
    const client = paymentClient(fetchStub());
    // Asking would imply it exists. It does not: there is no test hostname and no test flag. Whole
    // names, because `listWebhookDeliveries` contains "live".
    const asking = /^(setMode|sandbox|live|test|useSandbox|useLive)$/i;
    expect(Object.keys(client).filter((name) => asking.test(name))).toEqual([]);
  });
});
