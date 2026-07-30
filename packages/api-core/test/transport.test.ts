import { describe, expect, it, vi } from "vitest";
import { LamidoApiError } from "../src/errors.js";
import { request } from "../src/transport.js";
import { fetchStub, jsonResponse, testApiKey, testConfig, testErrorParser } from "./stubs/fetch.js";

describe("request", () => {
  it("builds the URL from the base, path and query", async () => {
    const stub = fetchStub(() => jsonResponse({ data: [] }));
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/content/pages",
      query: { limit: 10, published: true, cursor: undefined },
      read: { kind: "data" },
      onError: testErrorParser,
    });
    expect(stub.calls[0]?.url).toBe(
      "https://content.example.com/api/content/pages?limit=10&published=true",
    );
  });

  it("sends the credential as a bearer token", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApiKey}`);
  });

  it("omits Content-Type when there is no body", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.lastHeaders()["content-type"]).toBeUndefined();
  });

  it("sends a JSON body with Content-Type when there is one", async () => {
    const stub = fetchStub(() => jsonResponse({ data: { id: "1" } }, 201));
    await request(testConfig({ fetch: stub.fetch }), {
      method: "POST",
      path: "/api/client/pages",
      body: { slug: "about" },
      read: { kind: "data" },
      onError: testErrorParser,
    });
    expect(stub.lastHeaders()["content-type"]).toBe("application/json");
    expect(stub.calls[0]?.init.body).toBe('{"slug":"about"}');
  });

  it("rejects a path that does not start with a slash", async () => {
    await expect(
      request(testConfig(), {
        method: "GET",
        path: "api/health",
        read: { kind: "raw" },
        onError: testErrorParser,
      }),
    ).rejects.toThrow(/must start with "\/"/);
  });

  it("calls onRequest with the method and path, and nothing else", async () => {
    const onRequest = vi.fn();
    await request(testConfig({ fetch: fetchStub().fetch, onRequest }), {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    // No headers, no body, no key — there is no code path that can log a credential.
    expect(onRequest).toHaveBeenCalledWith({ method: "GET", path: "/api/health" });
  });
});

describe("request read modes", () => {
  it("unwraps data", async () => {
    const stub = fetchStub(() => jsonResponse({ data: { slug: "about" }, requestId: "r1" }));
    const result = await request<{ slug: string }>(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/content/pages/about",
      read: { kind: "data" },
      onError: testErrorParser,
    });
    expect(result).toEqual({ slug: "about" });
  });

  it("returns an envelope whole, so sibling metadata survives", async () => {
    // The reason `read` is explicit: a blanket unwrap would discard `total` and `interval`.
    const stub = fetchStub(() => jsonResponse({ data: [1, 2], total: 57, interval: "day" }));
    const result = await request<{ data: number[]; total: number; interval: string }>(
      testConfig({ fetch: stub.fetch }),
      {
        method: "GET",
        path: "/api/client/stats",
        read: { kind: "envelope" },
        onError: testErrorParser,
      },
    );
    expect(result).toEqual({ data: [1, 2], total: 57, interval: "day" });
  });

  it("returns a raw body untouched", async () => {
    const stub = fetchStub(() => jsonResponse({ id: "pay_1", status: "succeeded" }));
    const result = await request<{ id: string }>(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/v1/payments/pay_1",
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(result).toEqual({ id: "pay_1", status: "succeeded" });
  });

  it("returns bytes and the content type for a non-JSON body", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const stub = fetchStub(
      () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const result = await request<{ bytes: ArrayBuffer; contentType: string | null }>(
      testConfig({ fetch: stub.fetch }),
      {
        method: "GET",
        path: "/api/invoices/inv_1/pdf",
        read: { kind: "bytes" },
        onError: testErrorParser,
      },
    );
    expect(new Uint8Array(result.bytes)).toEqual(pdf);
    expect(result.contentType).toBe("application/pdf");
  });

  it("returns undefined for a 204", async () => {
    const stub = fetchStub(() => new Response(null, { status: 204 }));
    const result = await request(testConfig({ fetch: stub.fetch }), {
      method: "DELETE",
      path: "/api/client/pages/about",
      read: { kind: "none" },
      onError: testErrorParser,
    });
    expect(result).toBeUndefined();
  });

  it("exposes the status and headers when withMeta is set", async () => {
    // The distinction idempotency exists to express: 201 is new, 200 is a replay.
    const stub = fetchStub(
      () =>
        new Response(JSON.stringify({ id: "pay_1" }), {
          status: 200,
          headers: { "content-type": "application/json", "idempotent-replay": "true" },
        }),
    );
    const result = await request<{ id: string }>(testConfig({ fetch: stub.fetch }), {
      method: "POST",
      path: "/v1/payments",
      body: {},
      read: { kind: "raw", withMeta: true },
      onError: testErrorParser,
    });
    expect(result.value).toEqual({ id: "pay_1" });
    expect(result.status).toBe(200);
    expect(result.headers.get("idempotent-replay")).toBe("true");
  });
});

describe("request error handling", () => {
  it("parses the error body and hands it to the service's parser", async () => {
    const stub = fetchStub(() =>
      jsonResponse({ error: { code: "page_not_found", details: { slug: "nope" } } }, 404),
    );
    const caught = await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/content/pages/nope",
      read: { kind: "data" },
      onError: testErrorParser,
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(LamidoApiError);
    const error = caught as LamidoApiError;
    expect(error.status).toBe(404);
    expect(error.code).toBe("page_not_found");
    expect(error.details).toEqual({ slug: "nope" });
    expect(error.requestPath).toBe("/api/content/pages/nope");
  });

  it("degrades a non-JSON error body to null rather than throwing a parse error", async () => {
    const stub = fetchStub(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const caught = (await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      onError: testErrorParser,
    }).catch((error: unknown) => error)) as LamidoApiError;

    expect(caught.status).toBe(502);
    expect(caught.code).toBe("unknown");
  });

  it("never puts the query string in requestPath", async () => {
    const stub = fetchStub(() => jsonResponse({}, 400));
    const caught = (await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/v1/payments",
      query: { paymentId: "secret-provider-id" },
      read: { kind: "raw" },
      onError: testErrorParser,
    }).catch((error: unknown) => error)) as LamidoApiError;

    expect(caught.requestPath).toBe("/v1/payments");
    expect(JSON.stringify(caught)).not.toContain("secret-provider-id");
  });
});

describe("request init pass-through", () => {
  it("passes framework cache hints to fetch intact", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/content/pages",
      init: { next: { tags: ["content"] } } as RequestInit,
      read: { kind: "data" },
      onError: testErrorParser,
    });
    expect((stub.calls[0]?.init as { next?: unknown } | undefined)?.next).toEqual({
      tags: ["content"],
    });
  });

  it("passes an AbortSignal through", async () => {
    const stub = fetchStub();
    const controller = new AbortController();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      init: { signal: controller.signal },
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.calls[0]?.init.signal).toBe(controller.signal);
  });

  it("merges defaultInit beneath the per-call init", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch, defaultInit: { cache: "force-cache" } }), {
      method: "GET",
      path: "/api/health",
      init: { cache: "no-store" },
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.calls[0]?.init.cache).toBe("no-store");
  });

  it("does not let a caller's init overwrite Authorization", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      init: { headers: { Authorization: "Bearer attacker-supplied" } },
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApiKey}`);
  });

  it("never sets mode, which content-service warns against copying from invoice-service", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.calls[0]?.init.mode).toBeUndefined();
  });
});
