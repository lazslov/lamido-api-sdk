import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { request } from "../src/transport.js";
import { fetchStub, jsonResponse, testApiKey, testConfig, testErrorParser } from "./stubs/fetch.js";

/**
 * The key appears in exactly one place: the `Authorization` header of one request.
 *
 * @remarks
 * A caught client or error object is the thing most likely to be logged with full context, so
 * every routine way of turning one into text is checked here. The key is stored on a
 * non-enumerable property, which is what makes all of these pass at once.
 */

/** A stand-in for the client objects phases 3–5 build: an object holding a resolved config. */
function clientLike() {
  return { service: "content-service", config: testConfig() };
}

describe("the credential does not widen its blast radius", () => {
  it("is not in JSON.stringify of the config", () => {
    expect(JSON.stringify(testConfig())).not.toContain(testApiKey);
  });

  it("is not in JSON.stringify of a client holding the config", () => {
    expect(JSON.stringify(clientLike())).not.toContain(testApiKey);
  });

  it("is not in String() of a client", () => {
    expect(String(clientLike())).not.toContain(testApiKey);
  });

  it("is not in util.inspect of a client", () => {
    expect(inspect(clientLike(), { depth: 10 })).not.toContain(testApiKey);
  });

  it("is not in Object.keys or a spread of the config", () => {
    const config = testConfig();
    expect(Object.keys(config)).not.toContain("apiKey");
    expect(JSON.stringify({ ...config })).not.toContain(testApiKey);
  });

  it("is still readable by the transport, which is the one thing that needs it", async () => {
    const stub = fetchStub();
    await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      onError: testErrorParser,
    });
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApiKey}`);
  });

  it("is not in JSON.stringify of a caught error", async () => {
    const stub = fetchStub(() => jsonResponse({ error: { code: "unauthorized" } }, 401));
    const caught = await request(testConfig({ fetch: stub.fetch }), {
      method: "GET",
      path: "/api/content/pages",
      read: { kind: "data" },
      onError: testErrorParser,
    }).catch((error: unknown) => error);

    expect(JSON.stringify(caught)).not.toContain(testApiKey);
    expect(inspect(caught, { depth: 10 })).not.toContain(testApiKey);
    expect(String(caught)).not.toContain(testApiKey);
  });

  it("is not reachable through onRequest", async () => {
    const seen: unknown[] = [];
    await request(
      testConfig({ fetch: fetchStub().fetch, onRequest: (event) => seen.push(event) }),
      {
        method: "GET",
        path: "/api/health",
        read: { kind: "raw" },
        onError: testErrorParser,
      },
    );
    expect(JSON.stringify(seen)).not.toContain(testApiKey);
  });
});
