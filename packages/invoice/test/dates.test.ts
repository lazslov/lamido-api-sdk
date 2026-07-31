import { describe, expect, it } from "vitest";
import { isoDate } from "../src/dates.js";

/**
 * The three invoice dates are not format-validated by the service — they are forwarded to the provider,
 * which rejects them as a `502` with the idempotency key already consumed. So they are rejected here,
 * before any request.
 */

describe("isoDate accepts a real day in YYYY-MM-DD", () => {
  it("passes the value through unchanged", () => {
    expect(isoDate("2026-07-25")).toBe("2026-07-25");
  });

  it("accepts a leap day in a leap year", () => {
    expect(isoDate("2028-02-29")).toBe("2028-02-29");
  });

  it("renders a Date in UTC, not in the host's zone", () => {
    // A server in Budapest at 00:30 local would otherwise date an invoice to the previous day.
    expect(isoDate(new Date("2026-07-25T23:30:00Z"))).toBe("2026-07-25");
  });
});

describe("isoDate rejects locally, before any request", () => {
  it("rejects an impossible month and day", () => {
    expect(() => isoDate("2026-13-45")).toThrow(TypeError);
  });

  it("rejects a shape-valid non-day", () => {
    expect(() => isoDate("2026-02-30")).toThrow(/not a real calendar date/);
    expect(() => isoDate("2027-02-29")).toThrow(/not a real calendar date/);
  });

  it("rejects the European written form", () => {
    expect(() => isoDate("25/07/2026")).toThrow(/must be YYYY-MM-DD/);
  });

  it("rejects a full timestamp, which the provider would not read as a date", () => {
    expect(() => isoDate("2026-07-25T09:14:03.221Z")).toThrow(TypeError);
  });

  it("rejects an unpadded month or day", () => {
    expect(() => isoDate("2026-7-25")).toThrow(TypeError);
  });

  it("rejects an empty string", () => {
    expect(() => isoDate("")).toThrow(TypeError);
  });

  it("rejects an invalid Date", () => {
    expect(() => isoDate(new Date("not a date"))).toThrow(/invalid Date/);
  });

  it("rejects a non-string, non-Date value", () => {
    // What a JavaScript caller reaches this with.
    expect(() => isoDate(20260725 as unknown as string)).toThrow(TypeError);
  });

  it("names the consequence, so the message is worth reading", () => {
    expect(() => isoDate("25/07/2026")).toThrow(/consuming the idempotency key/);
  });
});
