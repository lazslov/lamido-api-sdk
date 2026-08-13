import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentClient, tryCreateContentClient } from "../src/client/create.js";
import { createWebsiteClient, tryCreateWebsiteClient } from "../src/website/create.js";
import { fetchStub, testBaseUrl, testPublishableKey, testSecretKey } from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

/** The variables the two constructors read, cleared so a case controls them entirely. */
const variables = [
  "CONTENT_SERVICE_BASE_URL",
  "CONTENT_SERVICE_SECRET_KEY",
  "CONTENT_SERVICE_PUBLISHABLE_KEY",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  for (const name of variables) delete process.env[name];
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
});

describe("createContentClient", () => {
  it("throws in a browser with a csk_ key, and says to rotate it", () => {
    // A key that reached a bundle has been published to every visitor; hiding it now does nothing.
    inBrowser();
    expect(() => createContentClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /rotate it/,
    );
    expect(() => createContentClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /CONTENT_SERVICE_SECRET_KEY/,
    );
  });

  it("reads its two documented variables", () => {
    process.env.CONTENT_SERVICE_BASE_URL = testBaseUrl;
    process.env.CONTENT_SERVICE_SECRET_KEY = testSecretKey;
    expect(() => createContentClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createContentClient()).toThrow(/CONTENT_SERVICE_BASE_URL/);
    process.env.CONTENT_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createContentClient()).toThrow(/CONTENT_SERVICE_SECRET_KEY/);
  });

  it("has no admin surface", () => {
    const client = createContentClient({ baseUrl: testBaseUrl, apiKey: testSecretKey });
    expect(Object.keys(client).filter((name) => /admin|site|key/i.test(name))).toEqual([]);
  });
});

describe("createWebsiteClient", () => {
  it("does not throw in a browser with a cpk_ key, which is public by design", () => {
    inBrowser();
    expect(() =>
      createWebsiteClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
    ).not.toThrow();
  });

  it("throws in a browser with a csk_ key, which this tier also accepts on a server", () => {
    inBrowser();
    expect(() => createWebsiteClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /server-only/,
    );
  });

  it("prefers the publishable key and falls back to the secret one", async () => {
    process.env.CONTENT_SERVICE_BASE_URL = testBaseUrl;
    process.env.CONTENT_SERVICE_SECRET_KEY = testSecretKey;

    const secretOnly = fetchStub();
    await createWebsiteClient({ fetch: secretOnly.fetch }).listPages();
    expect(secretOnly.lastHeaders().authorization).toBe(`Bearer ${testSecretKey}`);

    process.env.CONTENT_SERVICE_PUBLISHABLE_KEY = testPublishableKey;
    const both = fetchStub();
    await createWebsiteClient({ fetch: both.fetch }).listPages();
    expect(both.lastHeaders().authorization).toBe(`Bearer ${testPublishableKey}`);
  });
});

describe("the try* constructors", () => {
  it("answer null with no environment at all, so a site still boots", () => {
    expect(tryCreateContentClient()).toBeNull();
    expect(tryCreateWebsiteClient()).toBeNull();
  });

  it("answer null when only half the configuration is present", () => {
    process.env.CONTENT_SERVICE_BASE_URL = testBaseUrl;
    expect(tryCreateContentClient()).toBeNull();
  });

  it("still throw for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() => tryCreateContentClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow();
  });

  it("answer a working client once configured", async () => {
    process.env.CONTENT_SERVICE_BASE_URL = testBaseUrl;
    process.env.CONTENT_SERVICE_SECRET_KEY = testSecretKey;
    const stub = fetchStub();
    const client = tryCreateContentClient({ fetch: stub.fetch });
    await client?.getMe();
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/me`);
  });
});

describe("a client never reveals its credential", () => {
  const clients = () => [
    createContentClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    createWebsiteClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
  ];

  it.each(["JSON.stringify", "String", "util.inspect"])(
    "is absent from %s of the client",
    (how) => {
      for (const client of clients()) {
        const rendered =
          how === "JSON.stringify"
            ? JSON.stringify(client)
            : how === "String"
              ? String(client)
              : inspect(client);
        expect(rendered ?? "").not.toContain("csk_");
        expect(rendered ?? "").not.toContain("cpk_");
      }
    },
  );

  it("is absent from a caught error", async () => {
    const stub = fetchStub([
      new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 }),
    ]);
    const client = createContentClient({
      baseUrl: testBaseUrl,
      apiKey: testSecretKey,
      fetch: stub.fetch,
    });

    const caught = await client.getMe().catch((error: unknown) => error);
    expect(JSON.stringify(caught)).not.toContain("csk_");
    expect(inspect(caught)).not.toContain("csk_");
  });
});
