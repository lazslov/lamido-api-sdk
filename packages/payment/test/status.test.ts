import { describe, expect, it } from "vitest";
import { isFulfillable, isTerminal, type PaymentStatus } from "../src/status.js";

const every: PaymentStatus[] = [
  "initializing",
  "pending",
  "authorized",
  "succeeded",
  "failed",
  "canceled",
  "expired",
  "partially_refunded",
  "refunded",
];

describe("isFulfillable", () => {
  it("is false for pending — the buyer has a gateway URL and nothing more", () => {
    expect(isFulfillable("pending")).toBe(false);
  });

  it("is false for authorized, because there is no capture step to make funds move", () => {
    // It exists in the model because Stripe can produce it, not because it is driven.
    expect(isFulfillable("authorized")).toBe(false);
  });

  it("is true only for succeeded", () => {
    expect(every.filter(isFulfillable)).toEqual(["succeeded"]);
  });
});

describe("isTerminal", () => {
  it("is true for the four statuses nothing can move", () => {
    expect(every.filter(isTerminal)).toEqual(["failed", "canceled", "expired", "refunded"]);
  });

  it("is false for succeeded, because a refund can still move it", () => {
    expect(isTerminal("succeeded")).toBe(false);
    expect(isTerminal("partially_refunded")).toBe(false);
  });
});
