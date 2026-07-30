import { describe, expect, it } from "vitest";
import { LamidoApiError, NotConfiguredError } from "../src/errors.js";

describe("LamidoApiError", () => {
  const error = new LamidoApiError({
    service: "payment-service",
    status: 422,
    code: "https://example.com/problems/payment-not-refundable",
    message: "the payment cannot be refunded in its current state",
    requestPath: "/v1/payments/pay_1/refunds",
    retryable: true,
    details: { state: "pending" },
  });

  it("is an Error, so existing handling still works", () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("the payment cannot be refunded in its current state");
    expect(error.name).toBe("LamidoApiError");
  });

  it("carries the fields a caller can act on", () => {
    expect(error.service).toBe("payment-service");
    expect(error.status).toBe(422);
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ state: "pending" });
  });

  it("omits details entirely when there are none", () => {
    const bare = new LamidoApiError({
      service: "content-service",
      status: 404,
      code: "page_not_found",
      message: "no such page",
      requestPath: "/api/content/pages/nope",
      retryable: false,
    });
    expect("details" in bare).toBe(false);
  });

  it("carries a path, never a full URL", () => {
    // payment-service does the same in its RFC 7807 `instance` member, and for the same
    // reason: a provider id in a query string has no business in anyone's logs.
    expect(error.requestPath).toBe("/v1/payments/pay_1/refunds");
    expect(error.requestPath).not.toMatch(/https?:\/\//);
    expect(error.requestPath).not.toContain("?");
    // `code` may well be a URI — an RFC 7807 problem type is one, as above — which is exactly
    // why core keeps `code` a plain string and lets each package widen it.
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
    expect(error.code).toBe("not_configured");
    expect(error.retryable).toBe(false);
  });
});
