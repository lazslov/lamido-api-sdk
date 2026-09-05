import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as webshop from "../src/index.js";

/**
 * What this package promises, and what it promises *not* to offer. Several of phase 9's exit criteria
 * are about an absence — no admin endpoint, no inbound receiver, no cron route, no arithmetic on
 * amounts — and an absence is only enforceable from the surface and from the source text.
 */

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every hand-written source file. The generated contract is excluded deliberately. */
function sourceFiles(): string[] {
  return listFiles(srcDir).filter(
    (file) => file.endsWith(".ts") && !file.includes(`${path.sep}generated${path.sep}`),
  );
}

/** Every hand-written source file, as text. */
function sourceText(): string {
  return sourceFiles()
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

/**
 * The same text with comments removed.
 *
 * @remarks
 * These assertions are about what the package *does*, and the doc comments necessarily quote what it
 * does not — the inbound receiver it never calls, the admin tier it never reaches, the `Origin` header
 * it never sets. Grepping the prose would fail on the very sentences that explain the rule.
 */
function codeOnly(): string {
  return sourceText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const exported = Object.keys(webshop).sort();

describe("the runtime exports", () => {
  it("are exactly what phase 9 specifies", () => {
    expect(exported).toEqual([
      "VERSION",
      "WebshopApiError",
      "createWebshopClient",
      "createWebshopPublicClient",
      "deliveryIdHeader",
      "eventIdHeader",
      "isConfirmed",
      "isKnownEvent",
      "isTerminal",
      "parseWebshopWebhookEvent",
      "signatureHeader",
      "timestampHeader",
      "tryCreateWebshopClient",
      "tryCreateWebshopPublicClient",
      "verifyWebshopWebhook",
    ]);
  });

  it("performs no arithmetic on amounts", () => {
    // Every total on this service is computed in one place, and it is not this package. A helper that
    // summed lines would disagree with the cart the moment a line went unavailable.
    const arithmetic =
      /^(add|sum|subtract|minus|plus|total|multiply|divide|negate|format)([A-Z_]|$)/;
    expect(exported.filter((name) => arithmetic.test(name))).toEqual([]);
  });

  it("re-exports no paginator, which is core's", () => {
    expect(exported).not.toContain("collectAllCursor");
  });

  it("keeps VERSION in step with package.json", () => {
    const manifest = JSON.parse(readFileSync(path.join(srcDir, "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(webshop.VERSION).toBe(manifest.version);
  });
});

describe("the code", () => {
  it("names no admin endpoint, no inbound receiver and no cron route", () => {
    // `/v1/hooks/payment-service` is payment-service's traffic into webshop-service — never ours.
    expect(codeOnly()).not.toMatch(/["'`]\/v1\/admin/);
    expect(codeOnly()).not.toMatch(/\/admin\//);
    expect(codeOnly()).not.toMatch(/\/v1\/hooks/);
    expect(codeOnly()).not.toMatch(/\/api\/cron/);
  });

  it("names no deployment host, and carries no default base URL", () => {
    // Over the full text, comments included: a host in a doc comment is a host in the tarball.
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
    expect(sourceText()).not.toMatch(/webshop\.lamido/);
  });

  it("sets no fetch mode and no Origin header", () => {
    // The tripwire keys on `Origin` or `Sec-Fetch-Dest`. A helpful `Origin` is a 403 before the key
    // is even looked up.
    expect(codeOnly()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
    expect(codeOnly()).not.toMatch(/["']Origin["']\s*:/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    expect(codeOnly()).not.toMatch(/setTimeout|AbortController/);
  });

  it("never reads a problem's detail to decide anything", () => {
    // Every branch is on `status`, `code` and `provider_error` — the service gives a machine-readable
    // member for every case, so unlike payment-service there is no documented exception here.
    expect(codeOnly()).not.toMatch(/detail\.toLowerCase\(\)|detail\.includes\(/);
  });

  it("mints no idempotency key of its own", () => {
    // A key derived from a clock or a random source is correct in the happy path and is a second order
    // the moment a retry happens.
    expect(codeOnly()).not.toMatch(/randomUUID|Date\.now\(\)|Math\.random/);
  });
});
