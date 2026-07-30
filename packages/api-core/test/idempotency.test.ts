import { describe, expect, it } from "vitest";
import { derivedIdempotencyKey, idempotencyKey } from "../src/idempotency.js";

describe("idempotencyKey", () => {
  it("returns the value unchanged", () => {
    expect(idempotencyKey("order-12345-attempt-1")).toBe("order-12345-attempt-1");
  });

  it("throws on an empty key", () => {
    expect(() => idempotencyKey("")).toThrow(/cannot be empty/);
  });

  it("accepts 255 characters and throws on 256", () => {
    expect(() => idempotencyKey("a".repeat(255))).not.toThrow();
    expect(() => idempotencyKey("a".repeat(256))).toThrow(/cannot exceed 255/);
  });

  it("throws on non-ASCII, which is not a valid header value", () => {
    expect(() => idempotencyKey("számla-1")).toThrow(/printable ASCII/);
  });

  it("throws on a control character", () => {
    expect(() => idempotencyKey("order\n1")).toThrow(/printable ASCII/);
  });
});

describe("derivedIdempotencyKey", () => {
  it("builds the documented shape", () => {
    expect(derivedIdempotencyKey("order-12345", 1)).toBe("order-12345-attempt-1");
  });

  it("takes the attempt as a parameter, so incrementing it is visible at the call site", () => {
    // A new key after an unanswered request is how double charges happen, so the SDK will not
    // decide for the caller when to move on.
    expect(derivedIdempotencyKey("order-12345", 2)).toBe("order-12345-attempt-2");
  });

  it.each([0, -1, 1.5, Number.NaN])("throws on attempt %s", (attempt) => {
    expect(() => derivedIdempotencyKey("order-12345", attempt)).toThrow(/positive integer/);
  });

  it("still validates the assembled key", () => {
    expect(() => derivedIdempotencyKey("a".repeat(250), 1)).toThrow(/cannot exceed 255/);
  });
});
