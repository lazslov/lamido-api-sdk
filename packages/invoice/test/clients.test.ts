import { inspect } from "node:util";
import { NotConfiguredError } from "@lamido/api-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceClient, tryCreateInvoiceClient } from "../src/client.js";
import { fetchStub, testBaseUrl, testClientKey } from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

/** The variables the constructor reads, cleared so a case controls them entirely. */
const variables = ["INVOICE_SERVICE_BASE_URL", "INVOICE_SERVICE_CLIENT_KEY"];

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

describe("createInvoiceClient", () => {
  it("throws in a browser, and says to rotate the key rather than hide it", () => {
    // No CORS headers are served on any route, so a browser call fails anyway — but opaquely, and
    // only after the isk_ key has shipped to every visitor.
    inBrowser();
    const construct = () => createInvoiceClient({ baseUrl: testBaseUrl, apiKey: testClientKey });
    expect(construct).toThrow(/rotate it/);
    expect(construct).toThrow(/INVOICE_SERVICE_CLIENT_KEY/);
  });

  it("reads its two documented variables", () => {
    process.env.INVOICE_SERVICE_BASE_URL = testBaseUrl;
    process.env.INVOICE_SERVICE_CLIENT_KEY = testClientKey;
    expect(() => createInvoiceClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createInvoiceClient()).toThrow(NotConfiguredError);
    expect(() => createInvoiceClient()).toThrow(/INVOICE_SERVICE_BASE_URL/);
    process.env.INVOICE_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createInvoiceClient()).toThrow(/INVOICE_SERVICE_CLIENT_KEY/);
  });

  it("reports not_configured, so a site can translate it like a real 401", () => {
    let caught: NotConfiguredError | null = null;
    try {
      createInvoiceClient();
    } catch (error) {
      caught = error as NotConfiguredError;
    }
    expect(caught?.code).toBe("not_configured");
    expect(caught?.status).toBe(0);
  });

  it("has no default base URL to fall back to", () => {
    // Core carries none and neither does this package: a missing base URL is reported, never guessed.
    expect(() => createInvoiceClient({ apiKey: testClientKey })).toThrow(NotConfiguredError);
  });

  it("exposes the six client-tier endpoints plus health, and nothing else", () => {
    const client = createInvoiceClient({ baseUrl: testBaseUrl, apiKey: testClientKey });
    expect(Object.keys(client).sort()).toEqual([
      "cancelInvoice",
      "createDownloadLink",
      "createInvoice",
      "getHealth",
      "getInvoice",
      "getInvoicePdf",
      "listAllInvoices",
      "listInvoices",
    ]);
  });

  it("has no admin, client-management or credential surface", () => {
    const client = createInvoiceClient({ baseUrl: testBaseUrl, apiKey: testClientKey });
    const admin = /admin|client(s|ial)|credential|integration|reconcile|stats|audit|rotate/i;
    expect(Object.keys(client).filter((name) => admin.test(name))).toEqual([]);
  });
});

describe("tryCreateInvoiceClient", () => {
  it("answers null with no environment at all, so an order route still renders", () => {
    expect(tryCreateInvoiceClient()).toBeNull();
  });

  it("answers null when only half the configuration is present", () => {
    process.env.INVOICE_SERVICE_BASE_URL = testBaseUrl;
    expect(tryCreateInvoiceClient()).toBeNull();
  });

  it("still throws for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() => tryCreateInvoiceClient({ baseUrl: testBaseUrl, apiKey: testClientKey })).toThrow();
  });

  it("answers a working client once configured", async () => {
    process.env.INVOICE_SERVICE_BASE_URL = testBaseUrl;
    process.env.INVOICE_SERVICE_CLIENT_KEY = testClientKey;
    const stub = fetchStub();
    await tryCreateInvoiceClient({ fetch: stub.fetch })?.getInvoice("6f1c2c8e");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/invoices/6f1c2c8e`);
  });
});

describe("a client never reveals its credential", () => {
  const client = () => createInvoiceClient({ baseUrl: testBaseUrl, apiKey: testClientKey });

  it.each(["JSON.stringify", "String", "util.inspect"])("is absent from %s of it", (how) => {
    const rendered =
      how === "JSON.stringify"
        ? JSON.stringify(client())
        : how === "String"
          ? String(client())
          : inspect(client());
    expect(rendered ?? "").not.toContain("isk_");
  });
});
