import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthClient,
  createAuthPublicClient,
  tryCreateAuthClient,
  tryCreateAuthPublicClient,
} from "../src/client.js";
import {
  collection,
  fetchStub,
  jsonResponse,
  testApplicationKey,
  testBaseUrl,
  testPublishableKey,
} from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

const variables = [
  "AUTH_SERVICE_BASE_URL",
  "AUTH_SERVICE_PUBLISHABLE_KEY",
  "AUTH_SERVICE_APPLICATION_KEY",
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

describe("createAuthPublicClient", () => {
  it("does not throw in a browser with an apk_ key, which is publishable by design", () => {
    inBrowser();
    expect(() =>
      createAuthPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
    ).not.toThrow();
  });

  it("throws in a browser with an ask_ key, and says to rotate it", () => {
    // An ask_ key must never appear on this tier. By the time the service's own 403 on the other tier
    // would catch it, the key has already shipped to every visitor.
    inBrowser();
    expect(() =>
      createAuthPublicClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey }),
    ).toThrow(/rotate it/);
    expect(() =>
      createAuthPublicClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey }),
    ).toThrow(/AUTH_SERVICE_APPLICATION_KEY/);
  });

  it("reads AUTH_SERVICE_BASE_URL and AUTH_SERVICE_PUBLISHABLE_KEY", () => {
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    process.env.AUTH_SERVICE_PUBLISHABLE_KEY = testPublishableKey;
    expect(() => createAuthPublicClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createAuthPublicClient()).toThrow(/AUTH_SERVICE_BASE_URL/);
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createAuthPublicClient()).toThrow(/AUTH_SERVICE_PUBLISHABLE_KEY/);
  });

  it("does not fall back to the application key", () => {
    // Unlike content-service's website tier, which accepts a secret key on a server, the browser tier
    // here never takes an ask_ — so there is nothing to fall back to.
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    process.env.AUTH_SERVICE_APPLICATION_KEY = testApplicationKey;
    expect(() => createAuthPublicClient()).toThrow(/AUTH_SERVICE_PUBLISHABLE_KEY/);
  });

  it("offers both sign-in surfaces and the invitation pages, and nothing else", () => {
    const client = createAuthPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey });
    expect(Object.keys(client).sort()).toEqual([
      "acceptInvitation",
      "declineInvitation",
      "exchangeCustomerMagicLink",
      "exchangeMagicLink",
      "getCustomerMagicLinkStatus",
      "getInvitation",
      "getMagicLinkStatus",
      "requestCustomerMagicLink",
      "requestMagicLink",
      "startCustomerGoogle",
      "startGoogle",
    ]);
  });
});

describe("createAuthClient", () => {
  it("throws in a browser, and names rotation rather than hiding", () => {
    inBrowser();
    expect(() => createAuthClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey })).toThrow(
      /rotate it/,
    );
    expect(() => createAuthClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey })).toThrow(
      /AUTH_SERVICE_APPLICATION_KEY/,
    );
  });

  it("reads AUTH_SERVICE_BASE_URL and AUTH_SERVICE_APPLICATION_KEY", () => {
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    process.env.AUTH_SERVICE_APPLICATION_KEY = testApplicationKey;
    expect(() => createAuthClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createAuthClient()).toThrow(/AUTH_SERVICE_BASE_URL/);
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createAuthClient()).toThrow(/AUTH_SERVICE_APPLICATION_KEY/);
  });

  it("offers every client-tier route the knowledge base documents, and nothing else", () => {
    const client = createAuthClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey });
    expect(Object.keys(client).sort()).toEqual([
      "addDomain",
      "authorize",
      "createCustomer",
      "createInvitation",
      "createOrganization",
      "createWebsite",
      "getBranding",
      "getCustomer",
      "getLoginSettings",
      "getMe",
      "getOrganization",
      "getWebsite",
      "listCustomers",
      "listDomains",
      "listFeatures",
      "listInvitations",
      "listOrganizations",
      "listPermissions",
      "listPlans",
      "listSessions",
      "listSubscriptions",
      "listWebsiteKeys",
      "listWebsites",
      "logout",
      "mintWebsiteKey",
      "removeDomain",
      "revokeInvitation",
      "revokeSession",
      "revokeWebsiteKey",
      "switchOrganization",
      "updateBranding",
      "updateLoginSettings",
      "updateWebsite",
      "verifyCustomerSession",
      "verifyDomain",
    ]);
  });
});

describe("the try* constructors", () => {
  it("answer null with no environment at all, so a site still boots", () => {
    expect(tryCreateAuthPublicClient()).toBeNull();
    expect(tryCreateAuthClient()).toBeNull();
  });

  it("answer null when only half the configuration is present", () => {
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    expect(tryCreateAuthPublicClient()).toBeNull();
    expect(tryCreateAuthClient()).toBeNull();
  });

  it("still throw for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() =>
      tryCreateAuthClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey }),
    ).toThrow();
    expect(() =>
      tryCreateAuthPublicClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey }),
    ).toThrow();
  });

  it("answer a working client once configured", async () => {
    process.env.AUTH_SERVICE_BASE_URL = testBaseUrl;
    process.env.AUTH_SERVICE_PUBLISHABLE_KEY = testPublishableKey;
    process.env.AUTH_SERVICE_APPLICATION_KEY = testApplicationKey;

    const browser = fetchStub([jsonResponse({ status: "pending", poll_interval_ms: 2000 })]);
    await tryCreateAuthPublicClient({ fetch: browser.fetch })?.getMagicLinkStatus("handle");
    expect(browser.lastUrl()).toBe(`${testBaseUrl}/v1/public/auth/magic-link/handle/status`);

    const backend = fetchStub([collection([])]);
    await tryCreateAuthClient({ fetch: backend.fetch })?.listPlans();
    expect(backend.lastUrl()).toBe(`${testBaseUrl}/v1/plans`);
  });
});

describe("a client never reveals its credential", () => {
  const clients = () => [
    createAuthPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
    createAuthClient({ baseUrl: testBaseUrl, apiKey: testApplicationKey }),
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
        expect(rendered ?? "").not.toContain("apk_");
        expect(rendered ?? "").not.toContain("ask_");
      }
    },
  );

  it("is absent from a caught error", async () => {
    const stub = fetchStub([
      new Response(JSON.stringify({ type: "urn:auth-service:problem:unauthorized" }), {
        status: 401,
      }),
    ]);
    const caught = await createAuthClient({
      baseUrl: testBaseUrl,
      apiKey: testApplicationKey,
      fetch: stub.fetch,
    })
      .listPlans()
      .catch((error: unknown) => error);

    // The whole key, not the `ask_` prefix. Node's own stack carries
    // `node:internal/process/task_queues`, whose name contains that prefix — so a prefix check on
    // an error's rendering reports a leak on every asynchronous failure and proves nothing.
    expect(JSON.stringify(caught)).not.toContain(testApplicationKey);
    expect(inspect(caught)).not.toContain(testApplicationKey);
  });
});
