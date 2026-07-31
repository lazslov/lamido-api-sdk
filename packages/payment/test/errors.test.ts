import { describe, expect, it } from "vitest";
import { PaymentApiError, parsePaymentError } from "../src/errors.js";

/** One problem response, as the transport hands it to the parser. */
function context(
  status: number,
  problem: Record<string, unknown> | null,
  requestPath = "/v1/payments",
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
    instance: "/v1/payments",
    ...extra,
  };
}

const conflict = "urn:payment-service:problem:conflict";
const internal = "urn:payment-service:problem:internal";

describe("parsePaymentError", () => {
  it("reads the problem type, which is what a caller branches on", () => {
    const error = parsePaymentError(
      context(400, problem(400, "urn:payment-service:problem:validation")),
    );
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.type).toBe("urn:payment-service:problem:validation");
    // Also as core's `code`, so cross-service code can read one field on any @lazslov error.
    expect(error.code).toBe(error.type);
  });

  it("keeps title and detail without ever branching on them", () => {
    const error = parsePaymentError(
      context(422, problem(422, conflict, { title: "Unprocessable Entity" })),
    );
    // A 422 whose type is `conflict` reads "Unprocessable Entity" — which is why title is not a branch.
    expect(error.title).toBe("Unprocessable Entity");
    expect(error.detail).toBe("stub detail");
    expect(error.type).toBe(conflict);
  });

  it("records the request path from the request, not from the problem's instance", () => {
    const error = parsePaymentError(
      context(
        404,
        problem(404, "urn:payment-service:problem:not-found", { instance: "/rewritten" }),
      ),
    );
    expect(error.requestPath).toBe("/v1/payments");
  });

  it("falls back to the status when no problem body arrived", () => {
    expect(parsePaymentError(context(403, null)).type).toBe(
      "urn:payment-service:problem:forbidden",
    );
    expect(parsePaymentError(context(500, null)).type).toBe(internal);
    expect(parsePaymentError(context(500, null)).message).toBe("payment-service answered 500");
  });

  it("ignores a type it does not know", () => {
    const error = parsePaymentError(
      context(409, problem(409, "urn:payment-service:problem:invented")),
    );
    expect(error.type).toBe(conflict);
  });

  it("exposes the 422 code extension member as conflictCode", () => {
    // Not `code`: core already uses that for the machine value, and two fields called `code` on one
    // error would be a trap in exactly the place where money is involved.
    const error = parsePaymentError(
      context(422, problem(422, conflict, { code: "refund_exceeds_remaining" })),
    );
    expect(error.conflictCode).toBe("refund_exceeds_remaining");
    expect(error.code).toBe(conflict);
  });

  it("ignores a conflict code it does not know", () => {
    expect(
      parsePaymentError(context(422, problem(422, conflict, { code: "invented" }))).conflictCode,
    ).toBeUndefined();
  });
});

describe("retryable", () => {
  it("is true for a 422, because the resource's state can change", () => {
    const error = parsePaymentError(
      context(422, problem(422, conflict, { code: "payment_not_refundable" })),
    );
    expect(error.retryable).toBe(true);
  });

  it("is false for a 409 whose key was reused with a different body", () => {
    const error = parsePaymentError(
      context(
        409,
        problem(409, conflict, {
          detail: "A request with this Idempotency-Key used a different body",
        }),
      ),
    );
    expect(error.retryable).toBe(false);
    expect(error.advice).toBeUndefined();
  });

  it("is true for a 409 while an attempt is in flight, and says to reuse the key", () => {
    const error = parsePaymentError(
      context(
        409,
        problem(409, conflict, {
          detail: "A request with this Idempotency-Key is currently in flight",
        }),
      ),
    );
    expect(error.retryable).toBe(true);
    // The naive reading of a 409 is "use a new key", which here is a second payment.
    expect(error.advice).toMatch(/Pause and retry the SAME key/);
    expect(error.message).toMatch(/in flight/);
  });

  it("is true for a 429 and a 500", () => {
    expect(
      parsePaymentError(context(429, problem(429, "urn:payment-service:problem:rate-limit")))
        .retryable,
    ).toBe(true);
    expect(parsePaymentError(context(500, problem(500, internal))).retryable).toBe(true);
  });

  it("is false for a 400, a 401, a 403 and a 404", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(parsePaymentError(context(status, null)).retryable, String(status)).toBe(false);
    }
  });
});

describe("a 502", () => {
  const provider = (detail: string) =>
    parsePaymentError(
      context(502, problem(502, internal, { detail, provider_error: "psp said no" })),
    );

  it("classifies a definitive rejection as retryable with the same key", () => {
    const error = provider("The provider rejected the payment request");
    expect(error.providerOutcome).toBe("rejected");
    expect(error.retryable).toBe(true);
    expect(error.advice).toMatch(/SAME Idempotency-Key/);
  });

  it("classifies an unknown outcome as retryable under the same key only", () => {
    const error = provider("The provider could not be reached and the outcome is unknown");
    expect(error.providerOutcome).toBe("unknown");
    expect(error.retryable).toBe(true);
    expect(error.advice).toMatch(/a new key is a second payment/);
  });

  it("classifies a refund with an unknown outcome as not retryable", () => {
    const error = provider("The refund was sent but the provider did not answer");
    expect(error.providerOutcome).toBe("refund_unknown");
    expect(error.retryable).toBe(false);
    expect(error.advice).toMatch(/read the refund/i);
  });

  it("classifies an untrusted response as not retryable", () => {
    const error = provider("The provider response could not be trusted");
    expect(error.providerOutcome).toBe("untrusted");
    expect(error.retryable).toBe(false);
  });

  it("treats an unrecognised message as unclassified and not retryable", () => {
    const error = provider("Upstream exploded in a novel way");
    expect(error.providerOutcome).toBe("unclassified");
    expect(error.retryable).toBe(false);
    expect(error.advice).toMatch(/do not retry blind/);
  });

  it("attaches provider_error as it arrived", () => {
    expect(provider("The provider rejected it").providerError).toBe("psp said no");
  });

  it("classifies nothing on any other status", () => {
    expect(parsePaymentError(context(500, problem(500, internal))).providerOutcome).toBeUndefined();
  });
});

describe("extension members", () => {
  it("reads retry_after from the problem, on the refresh throttle", () => {
    const error = parsePaymentError(
      context(
        429,
        problem(429, "urn:payment-service:problem:rate-limit", { retry_after: 4 }),
        "/v1/payments/x/refresh",
      ),
    );
    expect(error.retryAfterSeconds).toBe(4);
  });

  it("falls back to the Retry-After header", () => {
    const error = parsePaymentError(
      context(429, problem(429, "urn:payment-service:problem:rate-limit"), "/v1/payments", {
        "retry-after": "9",
      }),
    );
    expect(error.retryAfterSeconds).toBe(9);
  });

  it("reads supported_events from a 400", () => {
    const error = parsePaymentError(
      context(
        400,
        problem(400, "urn:payment-service:problem:validation", {
          supported_events: ["payment.succeeded", 7],
        }),
      ),
    );
    expect(error.supportedEvents).toEqual(["payment.succeeded"]);
  });

  it("leaves absent members undefined rather than defining them", () => {
    const error = parsePaymentError(
      context(401, problem(401, "urn:payment-service:problem:unauthorized")),
    );
    expect("providerOutcome" in error).toBe(false);
    expect("retryAfterSeconds" in error).toBe(false);
    expect("conflictCode" in error).toBe(false);
  });
});

describe("a 404", () => {
  it("names the wrong-tenant possibility in its message", () => {
    // Every read is scoped to the key's merchant inside the same SQL predicate that fetches the row.
    const error = parsePaymentError(
      context(404, problem(404, "urn:payment-service:problem:not-found"), "/v1/payments/019e"),
    );
    expect(error.message).toMatch(/different merchant/);
    expect(error.message).toMatch(/PAYMENT_SERVICE_KEY/);
    // And the service's own prose is still available verbatim.
    expect(error.detail).toBe("stub detail");
  });
});
