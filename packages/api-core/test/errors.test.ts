import { describe, expect, it } from "vitest";
import { LamidoApiError, NotConfiguredError } from "../src/errors.js";

describe("LamidoApiError", () => {
  const error = new LamidoApiError({
    service: "payment-service",
    status: 422,
    type: "conflict",
    code: "payment_not_refundable",
    message: "the payment cannot be refunded in its current state",
    requestPath: "/v1/payments/pay_1/refunds",
    retryable: true,
    details: { state: "pending" },
    requestId: "019e4a91-3f2b-7c14-9d5e-2a6b8c0d1f33",
  });

  it("is an Error, so existing handling still works", () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("the payment cannot be refunded in its current state");
    expect(error.name).toBe("LamidoApiError");
  });

  it("carries the fields a caller can act on", () => {
    expect(error.service).toBe("payment-service");
    expect(error.status).toBe(422);
    expect(error.type).toBe("conflict");
    expect(error.code).toBe("payment_not_refundable");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ state: "pending" });
  });

  it("carries the request id, which is what a support ticket quotes", () => {
    expect(error.requestId).toBe("019e4a91-3f2b-7c14-9d5e-2a6b8c0d1f33");
  });

  it("omits every optional field entirely when there is nothing to put in it", () => {
    const bare = new LamidoApiError({
      service: "content-service",
      status: 404,
      type: "not-found",
      message: "no such page",
      requestPath: "/v1/public/pages/nope",
      retryable: false,
    });
    // Absence is the honest signal, and it keeps a logged error down to what it carries.
    expect("details" in bare).toBe(false);
    expect("code" in bare).toBe(false);
    expect("errors" in bare).toBe(false);
    expect("retryAfter" in bare).toBe(false);
    expect("requestId" in bare).toBe(false);
  });

  it("carries a path, never a full URL", () => {
    // The services do the same in the problem document's `instance` member, and for the same
    // reason: a download token in a query string has no business in anyone's logs.
    expect(error.requestPath).toBe("/v1/payments/pay_1/refunds");
    expect(error.requestPath).not.toMatch(/https?:\/\//);
    expect(error.requestPath).not.toContain("?");
  });
});

describe("NotConfiguredError", () => {
  const error = new NotConfiguredError({
    service: "content-service",
    message: "no base URL",
  });

  it("is a LamidoApiError, so one error translator handles it", () => {
    // A missing environment variable and a real 401 reach a site through the same channel.
    expect(error).toBeInstanceOf(LamidoApiError);
    expect(error.name).toBe("NotConfiguredError");
  });

  it("uses the status 0 sentinel to mean the request was never made", () => {
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(false);
  });

  it("reports an unknown problem type, because no problem document exists", () => {
    // Nothing left the process, so there is nothing to classify. Claiming `unauthorized`
    // here would be a guess dressed as a fact from the service.
    expect(error.type).toBe("unknown");
    expect(error.code).toBe("not_configured");
  });
});
