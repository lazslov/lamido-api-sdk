import { describe, expect, it } from "vitest";
import type { ErrorContext } from "../src/errors.js";
import { problemParser } from "../src/problem.js";

const parse = problemParser("invoice-service");

/** An error context with a problem document, as the transport assembles one. */
function context(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ErrorContext {
  return { status, body, headers: new Headers(headers), requestPath: "/v1/invoices" };
}

/** One problem document, as all three services serve it. */
function problem(status: number, slug: string, extra: Record<string, unknown> = {}) {
  return {
    type: `urn:invoice-service:problem:${slug}`,
    title: "Bad Request",
    status,
    detail: "json must have required property 'items'",
    instance: "/v1/invoices",
    request_id: "019839c2-7f3a-7a11-b0c1-4d2e6f8a9b01",
    ...extra,
  };
}

describe("problemParser", () => {
  it("lifts the slug out of the URN and ignores the namespace", () => {
    // The namespace differs per service; the slug set is shared verbatim. Branching on the
    // full URN would be three parsers again.
    expect(parse(context(400, problem(400, "validation"))).type).toBe("validation");
  });

  it("branches on detail for the message, never on title", () => {
    const error = parse(context(400, problem(400, "validation")));
    expect(error.message).toBe("json must have required property 'items'");
  });

  it("falls back to title, then to a plain sentence, when detail is absent", () => {
    expect(parse(context(500, { title: "Internal Server Error" })).message).toBe(
      "Internal Server Error",
    );
    expect(parse(context(503, null)).message).toBe("invoice-service answered 503");
  });

  it("reads the request id from the document, then from the header", () => {
    expect(parse(context(400, problem(400, "validation"))).requestId).toBe(
      "019839c2-7f3a-7a11-b0c1-4d2e6f8a9b01",
    );
    // An edge proxy can strip the body but keep the header.
    expect(parse(context(502, null, { "x-request-id": "from-header" })).requestId).toBe(
      "from-header",
    );
  });

  it("carries every field error at once, because the services report them all", () => {
    const errors = [
      { pointer: "/items", code: "required", detail: "Required" },
      { pointer: "#/query/limit", code: "invalid" },
    ];
    expect(parse(context(400, problem(400, "validation", { errors }))).errors).toEqual(errors);
  });

  it("ignores an errors member that is not the promised shape", () => {
    const error = parse(context(400, problem(400, "validation", { errors: ["oops", 42] })));
    expect("errors" in error).toBe(false);
  });

  describe("the retry verdict", () => {
    // Straight from the three services' error tables, which agree.
    it.each([
      [400, "validation", false],
      [401, "unauthorized", false],
      [403, "forbidden", false],
      [404, "not-found", false],
      [409, "conflict", false],
      [422, "conflict", true],
      [429, "rate-limit", true],
      [500, "internal", true],
      [502, "internal", true],
    ])("%i %s → retryable %s", (status, slug, retryable) => {
      expect(parse(context(status, problem(status, slug))).retryable).toBe(retryable);
    });

    it("separates the two conflicts, because only one can change on its own", () => {
      // 409 is a duplicate or a lost race; 422 is a state that the identical request may
      // find different later. The slug alone cannot tell them apart.
      expect(parse(context(409, problem(409, "conflict"))).retryable).toBe(false);
      expect(parse(context(422, problem(422, "conflict"))).retryable).toBe(true);
    });
  });

  describe("retry_after", () => {
    it("prefers the member, which is already seconds", () => {
      const error = parse(context(429, problem(429, "rate-limit", { retry_after: 30 })));
      expect(error.retryAfter).toBe(30);
    });

    it("falls back to the header", () => {
      expect(parse(context(429, null, { "retry-after": "12" })).retryAfter).toBe(12);
    });

    it("ignores an HTTP-date header rather than guessing a number", () => {
      const error = parse(context(429, null, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }));
      expect("retryAfter" in error).toBe(false);
    });
  });

  describe("a body that never came from the service", () => {
    it("survives an HTML error page from an edge proxy", () => {
      // `parseJsonSafe` hands us null; the error must still be usable.
      const error = parse(context(504, null));
      expect(error.type).toBe("unknown");
      expect(error.status).toBe(504);
      expect(error.message).toBe("invoice-service answered 504");
    });

    it("reports an unrecognised slug as unknown rather than passing it through", () => {
      // The set is closed. A new member is an API change, so an unseen one means this SDK is
      // older than the service — and inventing a retry verdict for it would be a guess.
      const error = parse(context(418, problem(418, "teapot")));
      expect(error.type).toBe("unknown");
      expect(error.retryable).toBe(false);
    });
  });

  it("names the service it was bound to", () => {
    expect(problemParser("content-service")(context(404, null)).service).toBe("content-service");
  });
});

describe("payload-too-large, which only content-service sends", () => {
  const parseContent = problemParser("content-service");

  it("is recognised rather than falling through to unknown", () => {
    const body = { type: "urn:content-service:problem:payload-too-large", status: 413 };
    const error = parseContent(context(413, body));
    expect(error.type).toBe("payload-too-large");
  });

  it("is not retryable — the record has to get smaller first", () => {
    const body = { type: "urn:content-service:problem:payload-too-large", status: 413 };
    expect(parseContent(context(413, body)).retryable).toBe(false);
  });
});
