import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config.js";
import { NotConfiguredError } from "../src/errors.js";

/** Resolve with the two documented-looking variable names this suite uses. */
function resolve(config?: Parameters<typeof resolveConfig>[0]["config"]) {
  return resolveConfig({
    serviceName: "content-service",
    env: { baseUrl: "CONTENT_SERVICE_BASE_URL", apiKey: "CONTENT_SERVICE_SECRET_KEY" },
    ...(config ? { config } : {}),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveConfig", () => {
  it("reads the environment when no config is given", () => {
    vi.stubEnv("CONTENT_SERVICE_BASE_URL", "https://content.example.com");
    vi.stubEnv("CONTENT_SERVICE_SECRET_KEY", "csk_YOUR_SECRET_KEY");
    expect(resolve().baseUrl).toBe("https://content.example.com");
  });

  it("prefers explicit config over the environment, so two tenants can coexist", () => {
    vi.stubEnv("CONTENT_SERVICE_BASE_URL", "https://tenant-a.example.com");
    vi.stubEnv("CONTENT_SERVICE_SECRET_KEY", "csk_YOUR_SECRET_KEY");
    const resolved = resolve({ baseUrl: "https://tenant-b.example.com" });
    expect(resolved.baseUrl).toBe("https://tenant-b.example.com");
  });

  it("strips trailing slashes so path concatenation cannot double them", () => {
    expect(
      resolve({ baseUrl: "https://content.example.com///", apiKey: "csk_YOUR_SECRET_KEY" }).baseUrl,
    ).toBe("https://content.example.com");
  });

  it("throws NotConfiguredError with status 0 when the base URL is missing", () => {
    const caught = (() => {
      try {
        return resolve({ apiKey: "csk_YOUR_SECRET_KEY" });
      } catch (error) {
        return error;
      }
    })();

    expect(caught).toBeInstanceOf(NotConfiguredError);
    const error = caught as NotConfiguredError;
    expect(error.status).toBe(0);
    expect(error.code).toBe("not_configured");
    // The message must name the variable to set, and say there is no default.
    expect(error.message).toContain("CONTENT_SERVICE_BASE_URL");
    expect(error.message).toContain("no default host");
  });

  it("throws when the API key is missing", () => {
    expect(() => resolve({ baseUrl: "https://content.example.com" })).toThrow(NotConfiguredError);
  });

  it.each([
    ["a relative path", "/api"],
    ["a host with no scheme", "content.example.com"],
    ["a non-HTTP scheme", "ftp://content.example.com"],
  ])("rejects %s as a base URL at construction", (_label, baseUrl) => {
    expect(() => resolve({ baseUrl, apiKey: "csk_YOUR_SECRET_KEY" })).toThrow(NotConfiguredError);
  });

  it("does not throw a ReferenceError on a runtime with no process", () => {
    // An edge worker has no `process`; a missing base URL must still be a reported error.
    const original = globalThis.process;
    try {
      Reflect.deleteProperty(globalThis, "process");
      expect(() => resolve()).toThrow(NotConfiguredError);
    } finally {
      Object.defineProperty(globalThis, "process", { value: original, configurable: true });
    }
  });

  it("defaults fetch to the platform one and defaultInit to an empty object", () => {
    const resolved = resolve({
      baseUrl: "https://content.example.com",
      apiKey: "csk_YOUR_SECRET_KEY",
    });
    expect(resolved.fetch).toBe(globalThis.fetch);
    expect(resolved.defaultInit).toEqual({});
  });

  it("omits onRequest entirely when none was supplied", () => {
    const resolved = resolve({
      baseUrl: "https://content.example.com",
      apiKey: "csk_YOUR_SECRET_KEY",
    });
    expect("onRequest" in resolved).toBe(false);
  });
});
