import { describe, expect, it } from "vitest";
import { PaymentApiError, type PaymentConflictCode, parsePaymentError } from "../src/errors.js";

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

const conflict = "conflict";
const internal = "internal";

describe("parsePaymentError", () => {
  it("reads the problem type, which is what a caller branches on", () => {
    const error = parsePaymentError(
      context(400, problem(400, "urn:payment-service:problem:validation")),
    );
    expect(error).toBeInstanceOf(PaymentApiError);
    // The slug, not the URN: the namespace differs per service and the slug set is shared, so
    // cross-service code reads one field with one set of values on any @lazslov error.
    expect(error.type).toBe("validation");
    // `code` is the extension member now, and a plain validation problem carries none.
    expect("code" in error).toBe(false);
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

  it("reports an unknown slug when no problem body arrived", () => {
    // An HTML error page from an edge proxy carries no `type`. Deriving one from the status
    // would be a guess presented as a fact from the service — and on a 502 that guess decides
    // whether a payment gets retried.
    expect(parsePaymentError(context(403, null)).type).toBe("unknown");
    expect(parsePaymentError(context(500, null)).type).toBe("unknown");
    expect(parsePaymentError(context(500, null)).message).toBe("payment-service answered 500");
  });

  it("ignores a type it does not know", () => {
    const error = parsePaymentError(
      context(409, problem(409, "urn:payment-service:problem:invented")),
    );
    expect(error.type).toBe("unknown");
  });

  it("exposes the 422 code extension member as code", () => {
    // `code` used to be spelled `conflictCode` here, because core's `code` held the problem type
    // and two fields called `code` on one error would be a trap where money is involved. Core
    // holds the slug in `type` now, so the two have merged onto the member the wire calls `code`.
    const error = parsePaymentError(
      context(422, problem(422, conflict, { code: "refund_exceeds_remaining" })),
    );
    expect(error.code).toBe("refund_exceeds_remaining");
    expect(error.type).toBe(conflict);
  });

  it("ignores a conflict code it does not know", () => {
    expect(
      parsePaymentError(context(422, problem(422, conflict, { code: "invented" }))).code,
    ).toBeUndefined();
  });

  it("recognises every code the contract declares, and nothing else", () => {
    // The runtime allow-list and the generated union have to agree: a code the service adds
    // upstream must not be silently dropped on the floor by the parser that widened its type.
    // The annotation is the compile-time half — a code missing here is a type error.
    const declared: readonly PaymentConflictCode[] = [
      "payment_not_refundable",
      "currency_mismatch",
      "refund_target_unknown",
      "refund_exceeds_remaining",
      "not_releasable",
      "known_to_provider",
      "already_attached",
      "endpoint_disabled",
      "endpoint_limit_reached",
    ];

    for (const code of declared) {
      const status = code === "endpoint_limit_reached" ? 409 : 422;
      const error = parsePaymentError(context(status, problem(status, conflict, { code })));
      expect(error.code, `${code} was not recognised`).toBe(code);
    }
  });

  it("separates the one conflict code that is a 409, not a 422", () => {
    // Eight are wrong-state 422s, which a state change can clear. Reaching the webhook-endpoint
    // cap is a 409: no retry clears it, and a caller keying off `retryable` must see the
    // difference even though both carry `type: conflict`.
    const capped = parsePaymentError(
      context(409, problem(409, conflict, { code: "endpoint_limit_reached", limit: 5 })),
    );
    expect(capped.retryable).toBe(false);

    const wrongState = parsePaymentError(
      context(422, problem(422, conflict, { code: "payment_not_refundable" })),
    );
    expect(wrongState.retryable).toBe(true);
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
    expect(error.retryAfter).toBe(4);
  });

  it("falls back to the Retry-After header", () => {
    const error = parsePaymentError(
      context(429, problem(429, "urn:payment-service:problem:rate-limit"), "/v1/payments", {
        "retry-after": "9",
      }),
    );
    expect(error.retryAfter).toBe(9);
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
    expect("retryAfter" in error).toBe(false);
    expect("code" in error).toBe(false);
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
