import { describe, expect, it } from "vitest";
import { BookingApiError, type BookingProblemCode, parseBookingError } from "../src/errors.js";

/** One problem response, as the transport hands it to the parser. */
function context(
  status: number,
  problem: Record<string, unknown> | null,
  requestPath = "/v1/bookings",
  headers: Record<string, string> = {},
) {
  return { status, body: problem, headers: new Headers(headers), requestPath };
}

/** A problem document with the type the service pairs with this status. */
function problem(status: number, slug: string, extra: Record<string, unknown> = {}) {
  return {
    type: `urn:booking-service:problem:${slug}`,
    title: "Error",
    status,
    detail: "stub detail",
    instance: "/v1/bookings",
    request_id: "019e5c31-0000-7000-8000-0000000000ff",
    ...extra,
  };
}

/**
 * Every code the service documents, with the status it rides.
 *
 * @remarks
 * Annotated `Record<BookingProblemCode, …>`, so the compiler checks it in **both** directions: a
 * code missing here is an error, and a code here that the contract does not declare is one too.
 * The runtime allow-list in `errors.ts` is then checked against this table below.
 */
const documentedCodes: Record<BookingProblemCode, 403 | 409 | 422> = {
  slot_taken: 409,
  hold_not_yours: 409,
  idempotency_mismatch: 409,
  idempotency_in_flight: 409,
  endpoint_limit_reached: 409,
  hold_expired: 422,
  already_confirmed: 422,
  pending_expired: 422,
  public_create_disabled: 422,
  outside_reschedule_window: 422,
  outside_cancel_window: 422,
  booking_terminal: 422,
  employee_unavailable: 422,
  service_inactive: 422,
  lead_time_violated: 422,
  horizon_exceeded: 422,
  invalid_confirmation_token: 403,
};

describe("parseBookingError", () => {
  it("reads the problem type, which pairs with status for the branch", () => {
    const error = parseBookingError(context(400, problem(400, "validation")));
    expect(error).toBeInstanceOf(BookingApiError);
    expect(error.name).toBe("BookingApiError");
    expect(error.service).toBe("booking-service");
    // The slug, not the URN: the namespace differs per service and the slug set is shared.
    expect(error.type).toBe("validation");
    expect("code" in error).toBe(false);
  });

  it("keeps title and detail without ever branching on them", () => {
    const error = parseBookingError(
      context(422, problem(422, "conflict", { title: "Unprocessable Entity" })),
    );
    // A 422 whose type is `conflict` reads "Unprocessable Entity" — which is why title is not a branch.
    expect(error.title).toBe("Unprocessable Entity");
    expect(error.detail).toBe("stub detail");
    expect(error.type).toBe("conflict");
  });

  it("records the request path from the request, not from the problem's instance", () => {
    const error = parseBookingError(
      context(404, problem(404, "not-found", { instance: "/rewritten" })),
    );
    expect(error.requestPath).toBe("/v1/bookings");
  });

  it("carries the request id, which is the only thread to the service's logs", () => {
    const error = parseBookingError(context(500, problem(500, "internal")));
    expect(error.requestId).toBe("019e5c31-0000-7000-8000-0000000000ff");
  });

  it("reports an unknown slug when no problem body arrived", () => {
    // An HTML error page from an edge proxy carries no `type`. Deriving one from the status would be
    // a guess presented as a fact from the service.
    expect(parseBookingError(context(403, null)).type).toBe("unknown");
    expect(parseBookingError(context(500, null)).message).toBe("booking-service answered 500");
  });

  it("ignores a type it does not know", () => {
    expect(parseBookingError(context(409, problem(409, "invented"))).type).toBe("unknown");
  });

  it("recognises every documented code on its documented status, and nothing else", () => {
    for (const [code, status] of Object.entries(documentedCodes)) {
      const slug = status === 403 ? "forbidden" : "conflict";
      const error = parseBookingError(context(status, problem(status, slug, { code })));
      expect(error.code, `${code} was not recognised`).toBe(code);
    }
    expect(
      parseBookingError(context(422, problem(422, "conflict", { code: "invented" }))).code,
    ).toBeUndefined();
  });

  it("carries the one code that rides a 403", () => {
    // The booking provably exists; the caller presented the wrong capability. Not a 404.
    const error = parseBookingError(
      context(403, problem(403, "forbidden", { code: "invalid_confirmation_token" })),
    );
    expect(error.status).toBe(403);
    expect(error.type).toBe("forbidden");
    expect(error.code).toBe("invalid_confirmation_token");
  });
});

describe("retryable", () => {
  it("is false for every 422, because each names a rule rather than a passing state", () => {
    // Core's estate default says a 422 conflict is retryable later. This service's own table marks
    // every 422 code No, so the package narrows it.
    for (const [code, status] of Object.entries(documentedCodes)) {
      if (status !== 422) continue;
      const error = parseBookingError(context(422, problem(422, "conflict", { code })));
      expect(error.retryable, code).toBe(false);
    }
  });

  it("is false for a 409 — except an identical request still in flight", () => {
    for (const code of [
      "slot_taken",
      "hold_not_yours",
      "idempotency_mismatch",
      "endpoint_limit_reached",
    ]) {
      const error = parseBookingError(context(409, problem(409, "conflict", { code })));
      expect(error.retryable, code).toBe(false);
      expect(error.advice, code).toBeUndefined();
    }

    const inFlight = parseBookingError(
      context(409, problem(409, "conflict", { code: "idempotency_in_flight" })),
    );
    expect(inFlight.retryable).toBe(true);
    // The naive reading of a 409 is "use a new key", which here is a second appointment.
    expect(inFlight.advice).toMatch(/retry the SAME key/);
    expect(inFlight.message).toMatch(/SAME key/);
  });

  it("is false for a 409 with no code, because a proxy's 409 is not a lease", () => {
    expect(parseBookingError(context(409, problem(409, "conflict"))).retryable).toBe(false);
  });

  it("is true for a 429, a 500 and a 502", () => {
    // A 500 releases the idempotency reservation, so the same key is reusable. The 502 freebusy
    // pre-check runs before anything is written.
    expect(parseBookingError(context(429, problem(429, "rate-limit"))).retryable).toBe(true);
    expect(parseBookingError(context(500, problem(500, "internal"))).retryable).toBe(true);
    expect(parseBookingError(context(502, problem(502, "internal"))).retryable).toBe(true);
  });

  it("is false for a 400, a 401, a 403, a 404 and a 413", () => {
    for (const status of [400, 401, 403, 404, 413]) {
      expect(parseBookingError(context(status, null)).retryable, String(status)).toBe(false);
    }
  });
});

describe("advice", () => {
  it("says a second confirm is a success", () => {
    const error = parseBookingError(
      context(422, problem(422, "conflict", { code: "already_confirmed" })),
    );
    expect(error.advice).toMatch(/Treat this as success/);
    expect(error.message).toBe(`stub detail — ${error.advice}`);
  });

  it("is absent where the status means what it says", () => {
    const error = parseBookingError(
      context(422, problem(422, "conflict", { code: "outside_cancel_window" })),
    );
    expect("advice" in error).toBe(false);
    expect(error.message).toBe("stub detail");
  });
});

describe("extension members", () => {
  it("reads retry_after from the problem, and falls back to the header", () => {
    expect(
      parseBookingError(context(429, problem(429, "rate-limit", { retry_after: 4 }))).retryAfter,
    ).toBe(4);
    expect(
      parseBookingError(
        context(429, problem(429, "rate-limit"), "/v1/bookings", { "retry-after": "9" }),
      ).retryAfter,
    ).toBe(9);
  });

  it("reads the field errors of a 400 with their JSON Pointers", () => {
    const error = parseBookingError(
      context(
        400,
        problem(400, "validation", {
          errors: [{ pointer: "/customer/email", detail: "Invalid email" }],
        }),
      ),
    );
    expect(error.errors).toEqual([{ pointer: "/customer/email", detail: "Invalid email" }]);
  });

  it("attaches provider_error on a 502 as it arrived, and nowhere else", () => {
    const upstream = parseBookingError(
      context(502, problem(502, "internal", { provider_error: "Google said no" })),
    );
    expect(upstream.providerError).toBe("Google said no");
    expect(upstream.type).toBe("internal");
    expect(upstream.status).toBe(502);

    const ours = parseBookingError(context(500, problem(500, "internal")));
    expect("providerError" in ours).toBe(false);
  });

  it("leaves absent members undefined rather than defining them", () => {
    const error = parseBookingError(context(401, problem(401, "unauthorized")));
    expect("code" in error).toBe(false);
    expect("retryAfter" in error).toBe(false);
    expect("advice" in error).toBe(false);
    expect("providerError" in error).toBe(false);
  });
});
