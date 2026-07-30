import { afterEach, describe, expect, it, vi } from "vitest";
import { assertServerOnly } from "../src/browser-guard.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertServerOnly", () => {
  it("does nothing on a server, where there is no window", () => {
    expect(() =>
      assertServerOnly("csk_YOUR_SECRET_KEY", {
        serverOnlyPrefixes: ["csk_"],
        serviceName: "content-service",
      }),
    ).not.toThrow();
  });

  it.each([
    ["csk_", "content-service", "csk_YOUR_SECRET_KEY"],
    ["isk_", "invoice-service", "isk_YOUR_CLIENT_KEY"],
    ["pmk_", "payment-service", "pmk_YOUR_MERCHANT_KEY"],
  ])("throws in a browser for a %s key", (prefix, serviceName, apiKey) => {
    inBrowser();
    expect(() => assertServerOnly(apiKey, { serverOnlyPrefixes: [prefix], serviceName })).toThrow(
      new RegExp(`${prefix} key is server-only`),
    );
  });

  it("does not throw for a cpk_ key, which is public by design", () => {
    inBrowser();
    expect(() =>
      assertServerOnly("cpk_YOUR_PUBLISHABLE_KEY", {
        serverOnlyPrefixes: ["csk_"],
        serviceName: "content-service",
      }),
    ).not.toThrow();
  });

  it("tells the reader to rotate, not to hide", () => {
    // A key that reached a bundle has been published to every visitor.
    inBrowser();
    expect(() =>
      assertServerOnly("csk_YOUR_SECRET_KEY", {
        serverOnlyPrefixes: ["csk_"],
        serviceName: "content-service",
        envVar: "CONTENT_SERVICE_SECRET_KEY",
      }),
    ).toThrow(/rotate it/);
  });

  it("names the environment variable when it is given one", () => {
    inBrowser();
    expect(() =>
      assertServerOnly("csk_YOUR_SECRET_KEY", {
        serverOnlyPrefixes: ["csk_"],
        serviceName: "content-service",
        envVar: "CONTENT_SERVICE_SECRET_KEY",
      }),
    ).toThrow(/CONTENT_SERVICE_SECRET_KEY/);
  });

  it("recommends server-only, because a build error beats a runtime throw", () => {
    inBrowser();
    expect(() =>
      assertServerOnly("pmk_YOUR_MERCHANT_KEY", {
        serverOnlyPrefixes: ["pmk_"],
        serviceName: "payment-service",
      }),
    ).toThrow(/server-only/);
  });
});
