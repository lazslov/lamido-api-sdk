import { describe, expect, it } from "vitest";
import { isConfirmed, isTerminal } from "../src/status.js";

describe("isConfirmed", () => {
  it("is true only once the money landed and the stock was committed", () => {
    expect(isConfirmed("confirmed")).toBe(true);
    expect(isConfirmed("fulfilled")).toBe(true);
  });

  it("is false for pending, because the 201 is not a paid order", () => {
    expect(isConfirmed("pending")).toBe(false);
  });

  it("is false for paid, the step nobody should wait for", () => {
    // `pending → paid → confirmed` happens in one transaction; a poller almost never sees `paid`, and a
    // branch that waits for it waits forever.
    expect(isConfirmed("paid")).toBe(false);
  });

  it("is false for every other documented status", () => {
    for (const status of ["payment_failed", "canceled", "refunded"]) {
      expect(isConfirmed(status), status).toBe(false);
    }
  });

  it("is false for a status this SDK has never heard of — in progress, do not act", () => {
    expect(isConfirmed("shipped")).toBe(false);
  });
});

describe("isTerminal", () => {
  it("is true for the three states the service refuses to move", () => {
    for (const status of ["fulfilled", "canceled", "refunded"]) {
      expect(isTerminal(status), status).toBe(true);
    }
  });

  it("is false for confirmed, which an operator can still fulfil", () => {
    expect(isTerminal("confirmed")).toBe(false);
  });

  it("is false for the open states and for an unknown one", () => {
    for (const status of ["pending", "paid", "payment_failed", "shipped"]) {
      expect(isTerminal(status), status).toBe(false);
    }
  });
});
