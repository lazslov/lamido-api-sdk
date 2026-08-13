import { describe, expect, it } from "vitest";
import { reconcilePayments } from "../src/reconcile.js";
import type { Payment } from "../src/types.js";
import { fetchStub, jsonResponse, payment, paymentClient, problemResponse } from "./stubs/fetch.js";

describe("reconcilePayments", () => {
  it("refreshes a pending payment and reports the refreshed state", async () => {
    const stub = fetchStub([
      jsonResponse(payment({ status: "pending" })),
      jsonResponse(payment({ status: "succeeded" })),
    ]);
    const seen: [string, string][] = [];

    const results = await reconcilePayments(paymentClient(stub), {
      publicIds: ["019e4a91"],
      onStatus: (publicId, found) => {
        seen.push([publicId, found.status]);
      },
    });

    expect(stub.calls.map((call) => call.url.split("/v1/")[1])).toEqual([
      "payments/019e4a91",
      "payments/019e4a91/refresh",
    ]);
    expect(seen).toEqual([["019e4a91", "succeeded"]]);
    expect(results[0]?.refreshed).toBe(true);
  });

  it("never refreshes a terminal payment", async () => {
    // A settled payment refreshed again is a PSP round trip that can only return the same answer.
    const stub = fetchStub([jsonResponse(payment({ status: "expired" }))]);
    const results = await reconcilePayments(paymentClient(stub), {
      publicIds: ["019e4a91"],
      onStatus: () => {},
    });

    expect(stub.calls).toHaveLength(1);
    expect(results[0]?.refreshed).toBe(false);
    expect(results[0]?.payment?.status).toBe("expired");
  });

  it("still reports a terminal payment, so a missed webhook is caught up", async () => {
    const stub = fetchStub([jsonResponse(payment({ status: "succeeded", public_id: "019e4a91" }))]);
    const seen: string[] = [];

    await reconcilePayments(paymentClient(stub), {
      publicIds: ["019e4a91"],
      onStatus: (_id, found: Payment) => {
        seen.push(found.status);
      },
    });

    expect(seen).toEqual(["succeeded"]);
  });

  it("does not refresh a status the PSP has already reported", async () => {
    const stub = fetchStub([jsonResponse(payment({ status: "authorized" }))]);
    await reconcilePayments(paymentClient(stub), { publicIds: ["019e4a91"], onStatus: () => {} });
    expect(stub.calls).toHaveLength(1);
  });

  it("serialises per id, because the refresh throttle is per payment", async () => {
    const order: string[] = [];
    const stub = fetchStub([jsonResponse(payment({ status: "succeeded" }))]);
    const client = paymentClient(stub);

    await reconcilePayments(client, {
      publicIds: ["a", "b", "c"],
      onStatus: async (publicId) => {
        order.push(`start:${publicId}`);
        await Promise.resolve();
        order.push(`end:${publicId}`);
      },
    });

    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("surfaces a 429's retry_after without retrying it", async () => {
    // A failed refresh consumes the throttle window too, so a helper that slept and retried would be
    // the loop the throttle exists to prevent.
    const stub = fetchStub([
      jsonResponse(payment({ status: "pending" })),
      problemResponse(429, "urn:payment-service:problem:rate-limit", { retry_after: 5 }),
    ]);

    const results = await reconcilePayments(paymentClient(stub), {
      publicIds: ["019e4a91"],
      onStatus: () => {},
    });

    expect(stub.calls).toHaveLength(2);
    expect(results[0]).toMatchObject({ retryAfter: 5, refreshed: false });
    // The payment read before the throttled refresh is still the freshest thing anyone has.
    expect(results[0]?.payment?.status).toBe("pending");
  });

  it("keeps going when one id fails, and reports which", async () => {
    const stub = fetchStub([
      problemResponse(404, "urn:payment-service:problem:not-found"),
      jsonResponse(payment({ status: "succeeded" })),
    ]);

    const results = await reconcilePayments(paymentClient(stub), {
      publicIds: ["gone", "019e4a91"],
      onStatus: () => {},
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.error).toBeDefined();
    expect(results[0]?.payment).toBeUndefined();
    expect(results[1]?.payment?.status).toBe("succeeded");
  });

  it("does not let a thrown callback abandon the sweep", async () => {
    const stub = fetchStub([jsonResponse(payment({ status: "succeeded" }))]);
    const results = await reconcilePayments(paymentClient(stub), {
      publicIds: ["a", "b"],
      onStatus: (publicId) => {
        if (publicId === "a") throw new Error("the site's own bug");
      },
    });

    expect(results[0]?.error).toBeInstanceOf(Error);
    expect(results[1]?.error).toBeUndefined();
  });

  it("returns one result per id, in the order given", async () => {
    const stub = fetchStub([jsonResponse(payment({ status: "succeeded" }))]);
    const results = await reconcilePayments(paymentClient(stub), {
      publicIds: ["a", "b", "c"],
      onStatus: () => {},
    });
    expect(results.map((result) => result.publicId)).toEqual(["a", "b", "c"]);
  });
});
