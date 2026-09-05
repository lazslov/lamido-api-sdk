import { describe, expect, it } from "vitest";
import { EmailApiError, type EmailProblemCode, parseEmailError } from "../src/errors.js";

/** One problem response, as the transport hands it to the parser. */
function context(
  status: number,
  problem: Record<string, unknown> | null,
  requestPath = "/v1/messages",
  headers: Record<string, string> = {},
) {
  return { status, body: problem, headers: new Headers(headers), requestPath };
}

/** A problem document with the type the service pairs with this status. */
function problem(status: number, slug: string, extra: Record<string, unknown> = {}) {
  return {
    type: `urn:email-service:problem:${slug}`,
    title: "Error",
    status,
    detail: "stub detail",
    instance: "/v1/messages",
    ...extra,
  };
}

describe("parseEmailError", () => {
  it("reads the problem type, which pairs with status for a branch", () => {
    const error = parseEmailError(context(400, problem(400, "validation")));
    expect(error).toBeInstanceOf(EmailApiError);
    expect(error.service).toBe("email-service");
    // The slug, not the URN: the namespace differs per service and the slug set is shared.
    expect(error.type).toBe("validation");
    // A plain validation problem carries no code — `errors[]` is where its detail lives.
    expect("code" in error).toBe(false);
  });

  it("keeps title and detail without ever branching on them", () => {
    const error = parseEmailError(
      context(422, problem(422, "conflict", { title: "Unprocessable Entity" })),
    );
    // A 422 reads "Unprocessable Entity" whatever went wrong — which is why title is not a branch.
    expect(error.title).toBe("Unprocessable Entity");
    expect(error.detail).toBe("stub detail");
    expect(error.type).toBe("conflict");
  });

  it("records the request path from the request, not from the problem's instance", () => {
    const error = parseEmailError(
      context(404, problem(404, "not-found", { instance: "/rewritten" })),
    );
    expect(error.requestPath).toBe("/v1/messages");
  });

  it("reports an unknown slug when no problem body arrived", () => {
    // An HTML error page from an edge proxy carries no `type`. Deriving one from the status would be
    // a guess presented as a fact from the service.
    expect(parseEmailError(context(403, null)).type).toBe("unknown");
    expect(parseEmailError(context(500, null)).message).toBe("email-service answered 500");
  });

  it("exposes the code extension member as code", () => {
    const error = parseEmailError(
      context(409, problem(409, "conflict", { code: "recipient_suppressed" })),
    );
    expect(error.code).toBe("recipient_suppressed");
  });

  it("ignores a code it does not know, so a caller falls through to the status", () => {
    expect(
      parseEmailError(context(409, problem(409, "conflict", { code: "invented" }))).code,
    ).toBeUndefined();
  });

  it("recognises every code the contract declares, and nothing else", () => {
    // The runtime allow-list and the generated union have to agree: a code the service adds
    // upstream must not be silently dropped by the parser that widened its type. The annotation is
    // the compile-time half — a code missing here is a type error.
    const declared: readonly EmailProblemCode[] = [
      "recipient_suppressed",
      "identity_not_verified",
      "identity_paused",
      "quota_exceeded",
      "rate_limited",
      "unknown_template",
      "template_variable_missing",
      "template_variable_invalid",
      "attachment_too_large",
      "attachment_count_exceeded",
      "idempotency_mismatch",
      "idempotency_in_flight",
      "credential_missing",
      "credential_invalid",
      "provider_rejected",
      "provider_unavailable",
      "stream_closed",
      "marketing_requires_consent",
    ];

    for (const code of declared) {
      const error = parseEmailError(context(409, problem(409, "conflict", { code })));
      expect(error.code, `${code} was not recognised`).toBe(code);
    }
  });
});

describe("retryable", () => {
  it("is true for the in-flight lease alone among the 409s", () => {
    const inFlight = parseEmailError(
      context(409, problem(409, "conflict", { code: "idempotency_in_flight" })),
    );
    expect(inFlight.retryable).toBe(true);
    // The naive reading of a 409 is "use a new key", which here is a second email.
    expect(inFlight.advice).toMatch(/retry the SAME key/);

    for (const code of ["recipient_suppressed", "stream_closed", "idempotency_mismatch"]) {
      const error = parseEmailError(context(409, problem(409, "conflict", { code })));
      expect(error.retryable, code).toBe(false);
    }
  });

  it("is false for a 422, overriding core's 'state can change' default", () => {
    // On this service a 422's state changes only when an operator acts (a send) or never (a
    // cancel). The anti-pattern table: retry a 422 unchanged — a retry cannot fix it.
    for (const code of ["identity_not_verified", "identity_paused", "credential_missing"]) {
      const error = parseEmailError(context(422, problem(422, "conflict", { code })));
      expect(error.retryable, code).toBe(false);
      expect(error.advice).toMatch(/operator fixes it; then retry the SAME key/);
    }
  });

  it("is true for a 429 and a 500", () => {
    expect(
      parseEmailError(context(429, problem(429, "rate-limit", { code: "rate_limited" }))).retryable,
    ).toBe(true);
    expect(parseEmailError(context(500, problem(500, "internal"))).retryable).toBe(true);
  });

  it("is false for a 400, a 401, a 403, a 404 and a 413", () => {
    for (const status of [400, 401, 403, 404, 413]) {
      expect(parseEmailError(context(status, null)).retryable, String(status)).toBe(false);
    }
  });
});

describe("advice", () => {
  it("tells the two 429s apart by code, because only code does", () => {
    const quota = parseEmailError(
      context(429, problem(429, "rate-limit", { code: "quota_exceeded", retry_after: 86400 })),
    );
    expect(quota.advice).toMatch(/BINDING period/);
    expect(quota.retryAfter).toBe(86400);

    const throttle = parseEmailError(
      context(429, problem(429, "rate-limit", { code: "rate_limited", retry_after: 3 })),
    );
    expect(throttle.advice).toBeUndefined();
    expect(throttle.retryAfter).toBe(3);
  });

  it("says a suppression is not a thing to work around", () => {
    const error = parseEmailError(
      context(409, problem(409, "conflict", { code: "recipient_suppressed" })),
    );
    expect(error.advice).toMatch(/key is consumed/);
    expect(error.advice).toMatch(/Do not retry under a new key/);
    expect(error.message).toMatch(/ask an operator/);
  });

  it("says a mismatch means the first message stands", () => {
    const error = parseEmailError(
      context(409, problem(409, "conflict", { code: "idempotency_mismatch" })),
    );
    expect(error.advice).toMatch(/already used with a different body/);
  });

  it("names the wrong-tenant possibility on a 404", () => {
    const error = parseEmailError(context(404, problem(404, "not-found"), "/v1/messages/0194c7a1"));
    expect(error.message).toMatch(/different tenant/);
    expect(error.message).toMatch(/EMAIL_SERVICE_API_KEY/);
    // And the service's own prose is still available verbatim.
    expect(error.detail).toBe("stub detail");
  });

  it("reads a 422 on the cancel path as 'no longer queued', not as provisioning", () => {
    const error = parseEmailError(
      context(422, problem(422, "conflict"), "/v1/messages/0194c7a1/cancel"),
    );
    expect(error.advice).toMatch(/Only a queued message/);
    expect(error.retryable).toBe(false);
  });

  it("is absent where the status reads plainly", () => {
    const error = parseEmailError(context(401, problem(401, "unauthorized")));
    expect("advice" in error).toBe(false);
    expect("code" in error).toBe(false);
    expect("retryAfter" in error).toBe(false);
  });
});

describe("extension members", () => {
  it("reads every offending field from errors[] on a 400", () => {
    const error = parseEmailError(
      context(
        400,
        problem(400, "validation", {
          code: "template_variable_missing",
          errors: [
            { pointer: "/variables/orderNumber", code: "required" },
            { pointer: "/variables/total", code: "invalid_type", detail: "expected a string" },
          ],
        }),
      ),
    );
    expect(error.code).toBe("template_variable_missing");
    expect(error.errors?.map((entry) => entry.pointer)).toEqual([
      "/variables/orderNumber",
      "/variables/total",
    ]);
  });

  it("falls back to the Retry-After header", () => {
    const error = parseEmailError(
      context(429, problem(429, "rate-limit"), "/v1/messages", { "retry-after": "9" }),
    );
    expect(error.retryAfter).toBe(9);
  });

  it("carries the request id for a support ticket", () => {
    const error = parseEmailError(
      context(500, problem(500, "internal", { request_id: "0194c7a1-req" })),
    );
    expect(error.requestId).toBe("0194c7a1-req");
  });
});
