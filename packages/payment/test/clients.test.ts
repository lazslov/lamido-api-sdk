import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPaymentClient, tryCreatePaymentClient } from "../src/client.js";
import { fetchStub, jsonResponse, payment, testApiKey, testBaseUrl } from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

const variables = ["PAYMENT_SERVICE_URL", "PAYMENT_SERVICE_KEY"];
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

describe("createPaymentClient", () => {
  it("throws in a browser, and names rotation rather than hiding", () => {
    // By the time the service's own 403 arrives, the key has already shipped to every visitor.
    inBrowser();
    expect(() => createPaymentClient({ baseUrl: testBaseUrl, apiKey: testApiKey })).toThrow(
      /rotate it/,
    );
    expect(() => createPaymentClient({ baseUrl: testBaseUrl, apiKey: testApiKey })).toThrow(
      /PAYMENT_SERVICE_KEY/,
    );
  });

  it("reads PAYMENT_SERVICE_URL, not PAYMENT_SERVICE_BASE_URL", () => {
    // The other two services use _BASE_URL. Harmonising a name a deployment already sets would be an
    // outage on the next deploy.
    process.env.PAYMENT_SERVICE_URL = testBaseUrl;
    process.env.PAYMENT_SERVICE_KEY = testApiKey;
    expect(() => createPaymentClient()).not.toThrow();

    delete process.env.PAYMENT_SERVICE_URL;
    process.env.PAYMENT_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createPaymentClient()).toThrow(/PAYMENT_SERVICE_URL/);
    delete process.env.PAYMENT_SERVICE_BASE_URL;
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createPaymentClient()).toThrow(/PAYMENT_SERVICE_URL/);
    process.env.PAYMENT_SERVICE_URL = testBaseUrl;
    expect(() => createPaymentClient()).toThrow(/PAYMENT_SERVICE_KEY/);
  });

  it("offers the seven merchant endpoints and nothing else", () => {
    const client = createPaymentClient({ baseUrl: testBaseUrl, apiKey: testApiKey });
    expect(Object.keys(client).sort()).toEqual([
      "createPayment",
      "createRefund",
      "getPayment",
      "getRefund",
      "listRefunds",
      "listWebhookDeliveries",
      "refreshPayment",
    ]);
  });
});

describe("tryCreatePaymentClient", () => {
  it("answers null with no environment at all, so a checkout still renders", () => {
    expect(tryCreatePaymentClient()).toBeNull();
  });

  it("answers null when only half the configuration is present", () => {
    process.env.PAYMENT_SERVICE_URL = testBaseUrl;
    expect(tryCreatePaymentClient()).toBeNull();
  });

  it("still throws for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() => tryCreatePaymentClient({ baseUrl: testBaseUrl, apiKey: testApiKey })).toThrow();
  });

  it("answers a working client once configured", async () => {
    process.env.PAYMENT_SERVICE_URL = testBaseUrl;
    process.env.PAYMENT_SERVICE_KEY = testApiKey;
    const stub = fetchStub([jsonResponse(payment())]);
    await tryCreatePaymentClient({ fetch: stub.fetch })?.getPayment("019e4a91");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/payments/019e4a91`);
  });
});

describe("a client never reveals its credential", () => {
  const client = () => createPaymentClient({ baseUrl: testBaseUrl, apiKey: testApiKey });

  it.each(["JSON.stringify", "String", "util.inspect"])(
    "is absent from %s of the client",
    (how) => {
      const rendered =
        how === "JSON.stringify"
          ? JSON.stringify(client())
          : how === "String"
            ? String(client())
            : inspect(client());
      expect(rendered ?? "").not.toContain("pmk_");
    },
  );

  it("is absent from a caught error", async () => {
    const stub = fetchStub([
      new Response(
        JSON.stringify({ type: "urn:payment-service:problem:unauthorized", detail: "no" }),
        {
          status: 401,
        },
      ),
    ]);
    const caught = await createPaymentClient({
      baseUrl: testBaseUrl,
      apiKey: testApiKey,
      fetch: stub.fetch,
    })
      .getPayment("019e4a91")
      .catch((error: unknown) => error);

    expect(JSON.stringify(caught)).not.toContain("pmk_");
    expect(inspect(caught)).not.toContain("pmk_");
  });
});
