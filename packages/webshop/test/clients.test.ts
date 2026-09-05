import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebshopClient, tryCreateWebshopClient } from "../src/client.js";
import { createWebshopPublicClient, tryCreateWebshopPublicClient } from "../src/public-client.js";
import {
  fetchStub,
  jsonResponse,
  listResponse,
  product,
  testBaseUrl,
  testPublishableKey,
  testSecretKey,
} from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

const variables = ["WEBSHOP_SERVICE_BASE_URL", "WEBSHOP_SECRET_KEY", "WEBSHOP_PUBLISHABLE_KEY"];
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

describe("createWebshopClient", () => {
  it("throws in a browser, and names rotation rather than hiding", () => {
    // By the time the service's own 403 arrives, the key has already shipped to every visitor.
    inBrowser();
    expect(() => createWebshopClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /rotate it/,
    );
    expect(() => createWebshopClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /WEBSHOP_SECRET_KEY/,
    );
  });

  it("reads WEBSHOP_SECRET_KEY, the knowledge base's own name", () => {
    // workflows.md §1 reads `process.env.WEBSHOP_SECRET_KEY`. Harmonising a name a deployment already
    // sets would be an outage on the next deploy.
    process.env.WEBSHOP_SERVICE_BASE_URL = testBaseUrl;
    process.env.WEBSHOP_SECRET_KEY = testSecretKey;
    expect(() => createWebshopClient()).not.toThrow();

    delete process.env.WEBSHOP_SECRET_KEY;
    process.env.WEBSHOP_SERVICE_SECRET_KEY = testSecretKey;
    expect(() => createWebshopClient()).toThrow(/WEBSHOP_SECRET_KEY/);
    delete process.env.WEBSHOP_SERVICE_SECRET_KEY;
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createWebshopClient()).toThrow(/WEBSHOP_SERVICE_BASE_URL/);
    process.env.WEBSHOP_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createWebshopClient()).toThrow(/WEBSHOP_SECRET_KEY/);
  });

  it("offers the sixteen storefront endpoints and nothing else", () => {
    const client = createWebshopClient({ baseUrl: testBaseUrl, apiKey: testSecretKey });
    expect(Object.keys(client).sort()).toEqual([
      "addCartItem",
      "applyCoupon",
      "cancelOrder",
      "checkout",
      "createCart",
      "getCart",
      "getMe",
      "getOrder",
      "getProduct",
      "listOrders",
      "listProducts",
      "listShippingOptions",
      "removeCartItem",
      "removeCoupon",
      "setCartItemQuantity",
      "setShippingMethod",
    ]);
  });
});

describe("tryCreateWebshopClient", () => {
  it("answers null with no environment at all, so a storefront still renders", () => {
    expect(tryCreateWebshopClient()).toBeNull();
  });

  it("answers null when only half the configuration is present", () => {
    process.env.WEBSHOP_SERVICE_BASE_URL = testBaseUrl;
    expect(tryCreateWebshopClient()).toBeNull();
  });

  it("still throws for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() => tryCreateWebshopClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow();
  });

  it("answers a working client once configured", async () => {
    process.env.WEBSHOP_SERVICE_BASE_URL = testBaseUrl;
    process.env.WEBSHOP_SECRET_KEY = testSecretKey;
    const stub = fetchStub([jsonResponse(product())]);
    await tryCreateWebshopClient({ fetch: stub.fetch })?.getProduct("espresso_beans");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/products/espresso_beans`);
  });
});

describe("createWebshopPublicClient", () => {
  it("constructs in a browser with a wpk_ key — that is the whole point of the tier", () => {
    inBrowser();
    expect(() =>
      createWebshopPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
    ).not.toThrow();
  });

  it("throws in a browser with a wsk_ key, naming the secret variable", () => {
    // The guard is per key, not per client: a secret key in a public-client call site is still a leak.
    inBrowser();
    expect(() =>
      createWebshopPublicClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    ).toThrow(/WEBSHOP_SECRET_KEY/);
  });

  it("reads WEBSHOP_PUBLISHABLE_KEY and does not fall back to the secret key", () => {
    // The path names the credential: a wsk_ on /v1/public is a 403 from the service, so silently
    // borrowing it here would trade a configuration error for a runtime one.
    process.env.WEBSHOP_SERVICE_BASE_URL = testBaseUrl;
    process.env.WEBSHOP_SECRET_KEY = testSecretKey;
    expect(() => createWebshopPublicClient()).toThrow(/WEBSHOP_PUBLISHABLE_KEY/);

    process.env.WEBSHOP_PUBLISHABLE_KEY = testPublishableKey;
    expect(() => createWebshopPublicClient()).not.toThrow();
  });

  it("offers the two public reads and nothing else", () => {
    const client = createWebshopPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey });
    expect(Object.keys(client).sort()).toEqual(["getProduct", "listProducts"]);
  });
});

describe("tryCreateWebshopPublicClient", () => {
  it("answers null with no environment at all", () => {
    expect(tryCreateWebshopPublicClient()).toBeNull();
  });

  it("still throws for a wsk_ key in a browser", () => {
    inBrowser();
    expect(() =>
      tryCreateWebshopPublicClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    ).toThrow();
  });

  it("answers a working client once configured", async () => {
    process.env.WEBSHOP_SERVICE_BASE_URL = testBaseUrl;
    process.env.WEBSHOP_PUBLISHABLE_KEY = testPublishableKey;
    const stub = fetchStub([listResponse([product()])]);
    await tryCreateWebshopPublicClient({ fetch: stub.fetch })?.listProducts({ limit: 1 });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/products?limit=1`);
  });
});

describe("a client never reveals its credential", () => {
  const client = () => createWebshopClient({ baseUrl: testBaseUrl, apiKey: testSecretKey });

  it.each(["JSON.stringify", "String", "util.inspect"])(
    "is absent from %s of the client",
    (how) => {
      const rendered =
        how === "JSON.stringify"
          ? JSON.stringify(client())
          : how === "String"
            ? String(client())
            : inspect(client());
      expect(rendered ?? "").not.toContain("wsk_");
    },
  );

  it("is absent from a caught error", async () => {
    const stub = fetchStub([
      new Response(
        JSON.stringify({ type: "urn:webshop-service:problem:unauthorized", detail: "no" }),
        { status: 401 },
      ),
    ]);
    const caught = await createWebshopClient({
      baseUrl: testBaseUrl,
      apiKey: testSecretKey,
      fetch: stub.fetch,
    })
      .getMe()
      .catch((error: unknown) => error);

    expect(JSON.stringify(caught)).not.toContain("wsk_");
    expect(inspect(caught)).not.toContain("wsk_");
  });
});
