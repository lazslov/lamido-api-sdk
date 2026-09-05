import { describe, expect, it } from "vitest";
import { isCancellable, type MessageStatus } from "../src/status.js";

describe("isCancellable", () => {
  it("is true for queued alone", () => {
    expect(isCancellable("queued")).toBe(true);
  });

  it.each([
    "sending",
    "sent",
    "delivered",
    "bounced",
    "complained",
    "failed",
    "canceled",
    "suppressed",
  ] satisfies MessageStatus[])("is false for %s", (status) => {
    // Including `canceled`: a second cancel is a 422 at the service, never a silent 200.
    expect(isCancellable(status)).toBe(false);
  });

  it("accepts a status this SDK has never heard of, and answers false", () => {
    // conventions §11: a new enum value is not a breaking change, and a client that throws on an
    // unknown one turns every addition into an outage.
    const future: MessageStatus = "deferred";
    expect(isCancellable(future)).toBe(false);
  });
});
