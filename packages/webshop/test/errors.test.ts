import { describe, expect, it } from "vitest";
import {
  parseWebshopError,
  WebshopApiError,
  type WebshopProblemCode,
  type WebshopProviderError,
} from "../src/errors.js";

/** One problem response, as the transport hands it to the parser. */
function context(
  status: number,
  problem: Record<string, unknown> | null,
  requestPath = "/v1/carts",
  headers: Record<string, string> = {},
) {
  return { status, body: problem, headers: new Headers(headers), requestPath };
}

/** A problem document with the type the service pairs with this status. */
function problem(status: number, type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    title: "Error",
    status,
    detail: "stub detail",
    instance: "/v1/carts",
    request_id: "0191f3c5-1a02-7d11-b8c0-5e7a9d4f22b1",
    ...extra,
  };
}

const conflict = "urn:webshop-service:problem:conflict";
const internal = "urn:webshop-service:problem:internal";
const rateLimit = "urn:webshop-service:problem:rate-limit";
const checkoutPath = "/v1/carts/0191f3c4-8b21-7c4e-9a55-2f6b0d3e91aa/checkout";

describe("parseWebshopError", () => {
  it("reads the problem type, which is what a caller branches on with status", () => {
    const error = parseWebshopError(
      context(400, problem(400, "urn:webshop-service:problem:validation")),
    );
    expect(error).toBeInstanceOf(WebshopApiError);
    expect(error.type).toBe("validation");
    expect("code" in error).toBe(false);
  });

  it("keeps title and detail without ever branching on them", () => {
    const error = parseWebshopError(
      context(422, problem(422, conflict, { title: "Unprocessable Entity" })),
    );
    // A 422 whose type is `conflict` reads "Unprocessable Entity" — which is why title is not a branch.
    expect(error.title).toBe("Unprocessable Entity");
    expect(error.detail).toBe("stub detail");
    expect(error.type).toBe("conflict");
  });

  it("records the request path from the request, not from the problem's instance", () => {
    const error = parseWebshopError(
      context(
        404,
        problem(404, "urn:webshop-service:problem:not-found", { instance: "/rewritten" }),
      ),
    );
    expect(error.requestPath).toBe("/v1/carts");
  });

  it("reports an unknown slug when no problem body arrived", () => {
    expect(parseWebshopError(context(403, null)).type).toBe("unknown");
    expect(parseWebshopError(context(500, null)).message).toBe("webshop-service answered 500");
  });

  it("recognises every code the contract declares, and nothing else", () => {
    // The runtime allow-list and the generated union have to agree. The annotation is the compile-time
    // half — a code missing here is a type error — and the loop is the runtime half.
    const declared: readonly WebshopProblemCode[] = [
      "key_revoked",
      "invalid_transition",
      "variant_unavailable",
      "insufficient_stock",
      "cart_expired",
      "cart_converted",
      "order_terminal",
      "coupon_invalid",
      "coupon_expired",
      "coupon_exhausted",
      "coupon_minimum_not_met",
      "shipping_method_inactive",
      "idempotency_key_reused",
      "idempotency_in_flight",
      "endpoint_limit_reached",
      "key_self_revoke",
      "last_managing_key",
    ];

    for (const code of declared) {
      const status =
        code.startsWith("idempotency_") || code === "endpoint_limit_reached" ? 409 : 422;
      const error = parseWebshopError(context(status, problem(status, conflict, { code })));
      expect(error.code, `${code} was not recognised`).toBe(code);
    }

    expect(
      parseWebshopError(context(422, problem(422, conflict, { code: "invented" }))).code,
    ).toBeUndefined();
  });

  it("recognises both provider errors on a 502, and drops an invented one", () => {
    const declared: readonly WebshopProviderError[] = [
      "payment_create_rejected",
      "payment_create_unknown",
    ];
    for (const provider_error of declared) {
      const error = parseWebshopError(
        context(502, problem(502, internal, { provider_error }), checkoutPath),
      );
      expect(error.providerError).toBe(provider_error);
    }

    const invented = parseWebshopError(
      context(502, problem(502, internal, { provider_error: "psp_on_fire" }), checkoutPath),
    );
    expect(invented.providerError).toBeUndefined();
  });

  it("leaves absent members undefined rather than defining them", () => {
    const error = parseWebshopError(
      context(401, problem(401, "urn:webshop-service:problem:unauthorized")),
    );
    expect("providerError" in error).toBe(false);
    expect("retryAfter" in error).toBe(false);
    expect("code" in error).toBe(false);
    expect("advice" in error).toBe(false);
  });
});

describe("retryable", () => {
  it("is true for the 422s that describe a state that can change", () => {
    for (const code of [
      "variant_unavailable",
      "insufficient_stock",
      "coupon_minimum_not_met",
      "invalid_transition",
    ]) {
      expect(
        parseWebshopError(context(422, problem(422, conflict, { code }))).retryable,
        code,
      ).toBe(true);
    }
  });

  it("is false for the 422s whose identical request can never succeed", () => {
    // The service's own table marks these "no": the cart is gone, the order is terminal, the campaign
    // is over, the carriage is withdrawn. Core's flat `true` for a 422 would send a caller into a loop.
    for (const code of [
      "cart_expired",
      "cart_converted",
      "order_terminal",
      "coupon_invalid",
      "coupon_expired",
      "coupon_exhausted",
      "shipping_method_inactive",
    ]) {
      expect(
        parseWebshopError(context(422, problem(422, conflict, { code }))).retryable,
        code,
      ).toBe(false);
    }
  });

  it("is true for an in-flight lease and false for a reused key, both 409", () => {
    const inFlight = parseWebshopError(
      context(409, problem(409, conflict, { code: "idempotency_in_flight" })),
    );
    expect(inFlight.retryable).toBe(true);
    expect(inFlight.advice).toMatch(/SAME key/);

    const reused = parseWebshopError(
      context(409, problem(409, conflict, { code: "idempotency_key_reused" })),
    );
    expect(reused.retryable).toBe(false);
    expect(reused.advice).toMatch(/different body/);
  });

  it("is true for a 429 and a 500", () => {
    expect(parseWebshopError(context(429, problem(429, rateLimit))).retryable).toBe(true);
    expect(parseWebshopError(context(500, problem(500, internal))).retryable).toBe(true);
  });

  it("is false for a 400, a 401, a 403 and a 404", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(parseWebshopError(context(status, null)).retryable, String(status)).toBe(false);
    }
  });
});

describe("a 502 from the payment step", () => {
  const provider = (provider_error: string) =>
    parseWebshopError(context(502, problem(502, internal, { provider_error }), checkoutPath));

  it("is not retryable when payment-service rejected the credential, and says the order exists", () => {
    const error = provider("payment_create_rejected");
    expect(error.retryable).toBe(false);
    expect(error.advice).toMatch(/payment credential/);
    expect(error.advice).toMatch(/SAME Idempotency-Key/);
  });

  it("is retryable under the same key when the outcome is unknown", () => {
    const error = provider("payment_create_unknown");
    expect(error.retryable).toBe(true);
    expect(error.advice).toMatch(/A payment may or may not exist/);
    expect(error.advice).toMatch(/Do not start a new cart/);
  });

  it("keeps core's verdict and the resume rule for an unrecognised provider_error", () => {
    // Retrying the same key is always safe here — the resume is idempotent by design — so an
    // unclassified 502 is not made stricter than the service's own table.
    const error = provider("psp_on_fire");
    expect(error.retryable).toBe(true);
    expect(error.advice).toMatch(/SAME Idempotency-Key/);
  });

  it("carries the type the contract says, which is internal and not bad-gateway", () => {
    expect(provider("payment_create_unknown").type).toBe("internal");
  });
});

describe("a 429", () => {
  it("names the committed order on the checkout path", () => {
    // The throttle is consumed AFTER the transaction commits, so the order exists and holds stock.
    const error = parseWebshopError(
      context(429, problem(429, rateLimit, { retry_after: 37 }), checkoutPath),
    );
    expect(error.retryAfter).toBe(37);
    expect(error.advice).toMatch(/committed/);
    expect(error.advice).toMatch(/SAME Idempotency-Key/);
  });

  it("carries no resume advice on any other path", () => {
    // The public catalog's per-IP throttle committed nothing.
    const error = parseWebshopError(
      context(429, problem(429, rateLimit, { retry_after: 5 }), "/v1/public/products"),
    );
    expect(error.retryable).toBe(true);
    expect(error.advice).toBeUndefined();
  });

  it("falls back to the Retry-After header", () => {
    const error = parseWebshopError(
      context(429, problem(429, rateLimit), "/v1/products", { "retry-after": "9" }),
    );
    expect(error.retryAfter).toBe(9);
  });
});

describe("a 404", () => {
  it("names the wrong-shop and malformed-id possibilities in its message", () => {
    const error = parseWebshopError(
      context(404, problem(404, "urn:webshop-service:problem:not-found"), "/v1/carts/019e"),
    );
    expect(error.message).toMatch(/another shop's row or a malformed id/);
    expect(error.message).toMatch(/WEBSHOP_SECRET_KEY/);
    expect(error.detail).toBe("stub detail");
  });
});
