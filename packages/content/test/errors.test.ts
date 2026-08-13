import { describe, expect, it } from "vitest";
import { ContentApiError, parseContentError } from "../src/errors.js";

/** One non-2xx response, as the transport hands it to the parser. */
function context(status: number, body: unknown, requestPath = "/v1/pages/home/values") {
  return { status, body, headers: new Headers(), requestPath };
}

/** One problem document, as content-service serves it. */
function problem(status: number, slug: string, extra: Record<string, unknown> = {}) {
  return {
    type: `urn:content-service:problem:${slug}`,
    title: "Conflict",
    status,
    detail: "stub detail",
    instance: "/v1/pages/home/values",
    ...extra,
  };
}

describe("parseContentError", () => {
  it("reads the slug and the details, and never the title", async () => {
    const error = parseContentError(
      context(
        400,
        problem(400, "validation", {
          detail: "One or more values could not be stored",
          details: {
            unknown_keys: ["hero.titel"],
            invalid: [{ key: "about.stats", message: "Entry 0" }],
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(ContentApiError);
    expect(error.type).toBe("validation");
    expect(error.details?.unknown_keys).toEqual(["hero.titel"]);
    expect(error.retryable).toBe(false);
  });

  it("carries the field errors, which are the machine-readable half", () => {
    const errors = [{ pointer: "#/values", code: "unknown_key", detail: "hero.titel" }];
    const error = parseContentError(context(400, problem(400, "validation", { errors })));
    expect(error.errors).toEqual(errors);
  });

  it("names the service and the request path, and nothing about the credential", () => {
    const error = parseContentError(context(401, problem(401, "unauthorized")));
    expect(error.service).toBe("content-service");
    expect(error.requestPath).toBe("/v1/pages/home/values");
    expect(JSON.stringify(error)).not.toMatch(/csk_|cpk_/);
  });

  it("defines details only when the service sent some", () => {
    const bare = parseContentError(context(404, problem(404, "not-found")));
    expect("details" in bare).toBe(false);
  });

  it("falls back to an unknown slug when no usable body arrived", () => {
    // An HTML error page from an edge proxy has no problem document, and inventing a slug from
    // its status would be a guess presented as a fact from the service.
    expect(parseContentError(context(403, null)).type).toBe("unknown");
    expect(parseContentError(context(404, "not json")).type).toBe("unknown");
  });

  it("ignores a slug that is not in the closed set", () => {
    expect(parseContentError(context(409, problem(409, "invented"))).type).toBe("unknown");
  });

  it("treats internal as retryable, at both statuses", () => {
    expect(parseContentError(context(500, problem(500, "internal"))).retryable).toBe(true);
    expect(parseContentError(context(502, problem(502, "internal"))).retryable).toBe(true);
  });

  it("recognises the 413 slug only content-service sends", () => {
    const error = parseContentError(context(413, problem(413, "payload-too-large")));
    expect(error.type).toBe("payload-too-large");
    expect(error.retryable).toBe(false);
  });

  it("treats a publish conflict with no missing list as the lost race, which is retryable", () => {
    // Two publishes of one page collided on the version number. The service already retried the
    // transaction once; the caller's move is to reload and try again.
    const error = parseContentError(
      context(409, problem(409, "conflict"), "/v1/pages/home/publish"),
    );
    expect(error.retryable).toBe(true);
  });

  it("treats a publish conflict naming missing fields as not retryable", () => {
    const error = parseContentError(
      context(
        409,
        problem(409, "conflict", { details: { missing: ["about.title"] } }),
        "/v1/pages/home/publish",
      ),
    );
    expect(error.retryable).toBe(false);
  });

  it("treats every other conflict as not retryable", () => {
    const duplicateSlug = parseContentError(
      context(409, problem(409, "conflict"), "/v1/collections/news/items"),
    );
    expect(duplicateSlug.retryable).toBe(false);
  });

  it("does not mistake a 422 on a publish path for the lost race", () => {
    // The lost race is a 409 specifically. A 422 is already retryable through core's own rule,
    // and reaching it through the publish branch would hide which rule applied.
    const error = parseContentError(
      context(422, problem(422, "conflict"), "/v1/pages/home/publish"),
    );
    expect(error.retryable).toBe(true);
  });

  it("keeps the detail the service sent, for a log rather than for a branch", () => {
    const error = parseContentError(
      context(413, problem(413, "payload-too-large", { detail: "8 KB" })),
    );
    expect(error.message).toBe("8 KB");
  });

  it("writes its own message when the service sent none", () => {
    expect(parseContentError(context(500, null)).message).toBe("content-service answered 500");
  });
});
