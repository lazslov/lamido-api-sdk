import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailClient, tryCreateEmailClient } from "../src/client.js";
import { fetchStub, jsonResponse, message, testApiKey, testBaseUrl } from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

const variables = ["EMAIL_SERVICE_BASE_URL", "EMAIL_SERVICE_API_KEY"];
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

describe("createEmailClient", () => {
  it("throws in a browser, and names rotation rather than hiding", () => {
    // By the time the service's own 403 arrives, the key has already shipped to every visitor — and
    // a leaked esk_ yields the email that convinces a victim, not merely a link.
    inBrowser();
    expect(() => createEmailClient({ baseUrl: testBaseUrl, apiKey: testApiKey })).toThrow(
      /rotate it/,
    );
    expect(() => createEmailClient({ baseUrl: testBaseUrl, apiKey: testApiKey })).toThrow(
      /EMAIL_SERVICE_API_KEY/,
    );
  });

  it("reads EMAIL_SERVICE_BASE_URL and EMAIL_SERVICE_API_KEY, the documented names", () => {
    process.env.EMAIL_SERVICE_BASE_URL = testBaseUrl;
    process.env.EMAIL_SERVICE_API_KEY = testApiKey;
    expect(() => createEmailClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createEmailClient()).toThrow(/EMAIL_SERVICE_BASE_URL/);
    process.env.EMAIL_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createEmailClient()).toThrow(/EMAIL_SERVICE_API_KEY/);
  });

  it("offers the five tenant endpoints and nothing else", () => {
    const client = createEmailClient({ baseUrl: testBaseUrl, apiKey: testApiKey });
    expect(Object.keys(client).sort()).toEqual([
      "cancelMessage",
      "getMessage",
      "listMessages",
      "sendMessage",
      "startGoogleOauth",
    ]);
  });
});

describe("tryCreateEmailClient", () => {
  it("answers null with no environment at all, so an order flow still completes", () => {
    expect(tryCreateEmailClient()).toBeNull();
  });

  it("answers null when only half the configuration is present", () => {
    process.env.EMAIL_SERVICE_BASE_URL = testBaseUrl;
    expect(tryCreateEmailClient()).toBeNull();
  });

  it("still throws for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() => tryCreateEmailClient({ baseUrl: testBaseUrl, apiKey: testApiKey })).toThrow();
  });

  it("answers a working client once configured", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = testBaseUrl;
    process.env.EMAIL_SERVICE_API_KEY = testApiKey;
    const stub = fetchStub([jsonResponse(message())]);
    await tryCreateEmailClient({ fetch: stub.fetch })?.getMessage("0194c7a1");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/messages/0194c7a1`);
  });
});

describe("a client never reveals its credential", () => {
  const client = () => createEmailClient({ baseUrl: testBaseUrl, apiKey: testApiKey });

  it.each(["JSON.stringify", "String", "util.inspect"])(
    "is absent from %s of the client",
    (how) => {
      const rendered =
        how === "JSON.stringify"
          ? JSON.stringify(client())
          : how === "String"
            ? String(client())
            : inspect(client());
      expect(rendered ?? "").not.toContain("esk_");
    },
  );

  it("is absent from a caught error", async () => {
    const stub = fetchStub([
      new Response(
        JSON.stringify({ type: "urn:email-service:problem:unauthorized", detail: "no" }),
        { status: 401 },
      ),
    ]);
    const caught = await createEmailClient({
      baseUrl: testBaseUrl,
      apiKey: testApiKey,
      fetch: stub.fetch,
    })
      .getMessage("0194c7a1")
      .catch((error: unknown) => error);

    expect(JSON.stringify(caught)).not.toContain("esk_");
    expect(inspect(caught)).not.toContain("esk_");
  });
});
