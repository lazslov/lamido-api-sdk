import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  type AuthProblemCode,
  authProblemCodes,
  parseAuthError,
} from "../src/errors.js";

/** One problem response, as the transport hands it to the parser. */
function context(
  status: number,
  problem: Record<string, unknown> | null,
  requestPath = "/v1/authorize",
  headers: Record<string, string> = {},
) {
  return { status, body: problem, headers: new Headers(headers), requestPath };
}

/** A problem document with the type the service pairs with this status. */
function problem(status: number, slug: string, extra: Record<string, unknown> = {}) {
  return {
    type: `urn:auth-service:problem:${slug}`,
    title: "Error",
    status,
    detail: "stub detail",
    instance: "/v1/authorize",
    request_id: "019fe8ee-fc09-71eb-bca3-25225321ffe3",
    ...extra,
  };
}

/**
 * The thirty codes conventions.md documents, in its own order.
 *
 * @remarks
 * Annotated with the union, so a code missing from the type is a compile error here — and the
 * `Missing` check below makes a code missing from this list a compile error too. Together they pin the
 * hand-written union to the documented table in both directions.
 */
const documented = [
  "rate_limited",
  "token_invalid",
  "token_expired",
  "token_consumed",
  "idempotency_body_mismatch",
  "idempotency_in_flight",
  "oauth_state_invalid",
  "oauth_denied",
  "oauth_email_unverified",
  "provider_unavailable",
  "domain_taken",
  "domain_not_verified",
  "login_method_disabled",
  "oauth_not_configured",
  "no_active_organization",
  "invitation_consumed",
  "invitation_revoked",
  "invitation_expired",
  "plan_retired",
  "feature_unknown",
  "permission_unknown",
  "subscription_transition_invalid",
  "system_role_immutable",
  "role_organization_mismatch",
  "role_in_use",
  "assignment_exists",
  "membership_exists",
  "key_exists",
  "override_exists",
  "endpoint_limit_reached",
] as const satisfies readonly AuthProblemCode[];

/** `never` when every member of the union is in the list above; a type error otherwise. */
type Missing = Exclude<AuthProblemCode, (typeof documented)[number]>;
const nothingMissing: Missing extends never ? true : false = true;

describe("parseAuthError", () => {
  it("reads the problem type, which is what a caller branches on", () => {
    const error = parseAuthError(context(400, problem(400, "validation")));
    expect(error).toBeInstanceOf(AuthApiError);
    expect(error.name).toBe("AuthApiError");
    expect(error.service).toBe("auth-service");
    // The slug, not the URN: the namespace differs per service and the slug set is shared.
    expect(error.type).toBe("validation");
    expect("code" in error).toBe(false);
  });

  it("keeps title and detail without ever branching on them", () => {
    const error = parseAuthError(
      context(422, problem(422, "conflict", { title: "Unprocessable Entity" })),
    );
    expect(error.title).toBe("Unprocessable Entity");
    expect(error.detail).toBe("stub detail");
    expect(error.type).toBe("conflict");
  });

  it("carries the request id, which is the only handle a human has on a deny", () => {
    const error = parseAuthError(context(404, problem(404, "not-found")));
    expect(error.requestId).toBe("019fe8ee-fc09-71eb-bca3-25225321ffe3");
  });

  it("reports an unknown slug when no problem body arrived", () => {
    // An HTML error page from an edge proxy carries no `type`. Deriving one from the status would be
    // a guess presented as a fact from the service.
    expect(parseAuthError(context(403, null)).type).toBe("unknown");
    expect(parseAuthError(context(500, null)).message).toBe("auth-service answered 500");
  });

  it("exposes a documented code and ignores one it does not know", () => {
    expect(
      parseAuthError(context(409, problem(409, "conflict", { code: "token_consumed" }))).code,
    ).toBe("token_consumed");
    expect(
      parseAuthError(context(409, problem(409, "conflict", { code: "invented" }))).code,
    ).toBeUndefined();
  });

  it("recognises every code conventions.md documents, and nothing else", () => {
    expect(nothingMissing).toBe(true);
    expect([...authProblemCodes].sort()).toEqual([...documented].sort());
    for (const code of documented) {
      const error = parseAuthError(context(409, problem(409, "conflict", { code })));
      expect(error.code, `${code} was not recognised`).toBe(code);
    }
  });

  it("never sees a code on a 401, whose body is byte-identical for every cause", () => {
    const error = parseAuthError(context(401, problem(401, "unauthorized")));
    expect("code" in error).toBe(false);
    expect(error.retryable).toBe(false);
  });

  it("attaches provider_error as it arrived, on a 502", () => {
    const error = parseAuthError(
      context(
        502,
        problem(502, "internal", { code: "provider_unavailable", provider_error: "status_401" }),
      ),
    );
    expect(error.code).toBe("provider_unavailable");
    expect(error.providerError).toBe("status_401");
  });

  it("reads the field errors a 400 carries, every bad field at once", () => {
    const error = parseAuthError(
      context(
        400,
        problem(400, "validation", {
          errors: [
            { pointer: "/email", code: "invalid", detail: "Invalid email" },
            { pointer: "/redirect", code: "unknown_field" },
          ],
        }),
      ),
    );
    expect(error.errors?.map((entry) => entry.pointer)).toEqual(["/email", "/redirect"]);
  });

  it("leaves absent members undefined rather than defining them", () => {
    const error = parseAuthError(context(401, problem(401, "unauthorized")));
    expect("providerError" in error).toBe(false);
    expect("retryAfter" in error).toBe(false);
    expect("advice" in error).toBe(false);
  });
});

describe("retryable", () => {
  it("is false for every 422, unlike core's default for conflict", () => {
    // Every 422 code the service documents needs a different request or a configuration change.
    for (const code of [
      "login_method_disabled",
      "oauth_not_configured",
      "no_active_organization",
      "plan_retired",
      "feature_unknown",
      "permission_unknown",
      "subscription_transition_invalid",
      "system_role_immutable",
    ]) {
      const error = parseAuthError(context(422, problem(422, "conflict", { code })));
      expect(error.retryable, code).toBe(false);
    }
  });

  it("is true for idempotency_in_flight alone among the 409s", () => {
    expect(
      parseAuthError(context(409, problem(409, "conflict", { code: "idempotency_in_flight" })))
        .retryable,
    ).toBe(true);
    for (const code of [
      "token_invalid",
      "token_consumed",
      "idempotency_body_mismatch",
      "domain_taken",
      "assignment_exists",
    ]) {
      expect(parseAuthError(context(409, problem(409, "conflict", { code }))).retryable, code).toBe(
        false,
      );
    }
  });

  it("is true for a 429, with its retry_after, and for a 500 and a 502", () => {
    const throttled = parseAuthError(
      context(429, problem(429, "rate-limit", { code: "rate_limited", retry_after: 7 })),
    );
    expect(throttled.retryable).toBe(true);
    expect(throttled.retryAfter).toBe(7);
    expect(parseAuthError(context(500, problem(500, "internal"))).retryable).toBe(true);
    expect(
      parseAuthError(context(502, problem(502, "internal", { code: "provider_unavailable" })))
        .retryable,
    ).toBe(true);
  });

  it("is false for a 400, a 401, a 403 and a 404", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(parseAuthError(context(status, null)).retryable, String(status)).toBe(false);
    }
  });
});

describe("a 404", () => {
  it("names the other three readings in its message, and both key variables", () => {
    const error = parseAuthError(context(404, problem(404, "not-found"), "/v1/customers/019f"));
    expect(error.message).toMatch(/another tenant/);
    expect(error.message).toMatch(/required `website`/);
    expect(error.message).toMatch(/AUTH_SERVICE_APPLICATION_KEY/);
    expect(error.message).toMatch(/AUTH_SERVICE_PUBLISHABLE_KEY/);
    // And the service's own prose is still available verbatim.
    expect(error.detail).toBe("stub detail");
  });
});
