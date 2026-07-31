import { describe, expect, it } from "vitest";
import { ContentApiError, parseContentError } from "../src/errors.js";

/** One non-2xx response, as the transport hands it to the parser. */
function context(status: number, body: unknown, requestPath = "/api/client/pages/home/values") {
  return { status, body, headers: new Headers(), requestPath };
}

describe("parseContentError", () => {
  it("reads the service's code and details, and never the message", async () => {
    const error = parseContentError(
      context(400, {
        error: {
          code: "validation_error",
          message: "One or more content values could not be stored",
          details: {
            unknownKeys: ["hero.titel"],
            invalid: [{ key: "about.stats", message: "Entry 0" }],
          },
        },
      }),
    );

    expect(error).toBeInstanceOf(ContentApiError);
    expect(error.code).toBe("validation_error");
    expect(error.details?.unknownKeys).toEqual(["hero.titel"]);
    expect(error.retryable).toBe(false);
  });

  it("names the service and the request path, and nothing about the credential", () => {
    const error = parseContentError(
      context(401, { error: { code: "unauthorized", message: "x" } }),
    );
    expect(error.service).toBe("content-service");
    expect(error.requestPath).toBe("/api/client/pages/home/values");
    expect(JSON.stringify(error)).not.toMatch(/csk_|cpk_/);
  });

  it("defines details only when the service sent some", () => {
    const bare = parseContentError(context(404, { error: { code: "not_found", message: "x" } }));
    expect("details" in bare).toBe(false);
  });

  it("falls back to the status when no usable body arrived", () => {
    // An HTML error page from an edge proxy has no error.code, and inventing one from prose would
    // be branching on a message.
    expect(parseContentError(context(403, null)).code).toBe("forbidden");
    expect(parseContentError(context(502, null)).code).toBe("internal_error");
    expect(parseContentError(context(404, "not json")).code).toBe("not_found");
  });

  it("ignores a code that is not in the documented set", () => {
    expect(
      parseContentError(context(409, { error: { code: "invented", message: "x" } })).code,
    ).toBe("conflict");
  });

  it("treats internal_error as retryable once", () => {
    expect(
      parseContentError(context(500, { error: { code: "internal_error", message: "x" } }))
        .retryable,
    ).toBe(true);
  });

  it("treats a publish conflict with no missing list as the lost race, which is retryable", () => {
    const error = parseContentError(
      context(409, { error: { code: "conflict", message: "x" } }, "/api/client/pages/home/publish"),
    );
    expect(error.retryable).toBe(true);
  });

  it("treats a publish conflict naming missing fields as not retryable", () => {
    const error = parseContentError(
      context(
        409,
        { error: { code: "conflict", message: "x", details: { missing: ["about.title"] } } },
        "/api/client/pages/home/publish",
      ),
    );
    expect(error.retryable).toBe(false);
  });

  it("treats every other conflict as not retryable", () => {
    const duplicateSlug = parseContentError(
      context(
        409,
        { error: { code: "conflict", message: "x" } },
        "/api/client/collections/news/items",
      ),
    );
    expect(duplicateSlug.retryable).toBe(false);
  });

  it("keeps a message the service sent, for a log rather than for a branch", () => {
    const error = parseContentError(
      context(413, { error: { code: "payload_too_large", message: "8 KB" } }),
    );
    expect(error.message).toBe("8 KB");
  });

  it("writes its own message when the service sent none", () => {
    expect(parseContentError(context(500, null)).message).toBe("content-service answered 500");
  });
});
