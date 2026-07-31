import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as payment from "../src/index.js";

/**
 * What this package promises, and what it promises *not* to offer. Several of phase 5's exit criteria
 * are about an absence — no admin endpoint, no arithmetic on money, no conversion to invoice-service's
 * major units — and an absence is only enforceable from the surface and from the source text.
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
 * does not — the browser tripwire it declines to satisfy, the callback routes it never calls, the
 * random key it refuses to mint. Grepping the prose would fail on the very sentences that explain the
 * rule. Whole comment lines and block comments go; a trailing comment after code would survive, which
 * is why none of these patterns appears in one.
 */
function codeOnly(): string {
  return sourceText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const exported = Object.keys(payment).sort();

describe("the runtime exports", () => {
  it("are exactly what phase 5 specifies", () => {
    expect(exported).toEqual([
      "PaymentApiError",
      "VERSION",
      "classifyProviderOutcome",
      "createPaymentClient",
      "deliveryIdHeader",
      "eurCents",
      "eventIdHeader",
      "huf",
      "isFulfillable",
      "isTerminal",
      "minorUnits",
      "parsePaymentWebhookEvent",
      "reconcilePayments",
      "signatureHeader",
      "timestampHeader",
      "tryCreatePaymentClient",
      "verifyPaymentWebhook",
    ]);
  });

  it("performs no arithmetic on amounts", () => {
    // Totals in the service are always grouped by currency and never summed across them. An SDK helper
    // that summed a list of MinorUnits would have to either ignore currency or become a money library.
    // Anchored and word-bounded: `timestampHeader` is not a multiplication.
    const arithmetic = /^(add|sum|subtract|minus|plus|total|multiply|divide|negate)([A-Z_]|$)/;
    expect(exported.filter((name) => arithmetic.test(name))).toEqual([]);
  });

  it("offers no conversion to or from invoice-service's major-unit amounts", () => {
    // The two services disagree by a factor of 100, and that conversion belongs in the site, written
    // once, visibly.
    const conversion = /(gross|major|toForint|fromForint|toDecimal|fromMinor|toMinor)/i;
    expect(exported.filter((name) => conversion.test(name))).toEqual([]);
    expect(sourceText()).not.toMatch(/grossAmount/);
  });

  it("re-exports no paginator, because the merchant tier is not paginated", () => {
    expect(exported).not.toContain("collectAll");
  });

  it("exposes no way to ask for a mode, because mode is a property of the credential", () => {
    // Whole names, not substrings: `deliveryIdHeader` contains "live".
    const asking = /^(sandbox|live|testMode|setMode|useSandbox|useLive)$/i;
    expect(exported.filter((name) => asking.test(name))).toEqual([]);
  });
});

describe("the code", () => {
  it("names no admin endpoint and no provider callback route", () => {
    // `/v1/providers/*` is inbound PSP traffic — never ours to call.
    expect(codeOnly()).not.toMatch(/["'`]\/admin\//);
    expect(codeOnly()).not.toMatch(/\/v1\/providers/);
  });

  it("names no deployment host, and carries no default base URL", () => {
    // Over the full text, comments included: a host in a doc comment is a host in the tarball.
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
    expect(sourceText()).not.toMatch(/payment\.lamido\.hu/);
  });

  it("sets no fetch mode", () => {
    // The service's Origin / Sec-Fetch-Mode check is a tripwire, not a boundary, so there is nothing
    // for the SDK to satisfy — and `mode: "same-origin"` is a habit worth not carrying between these
    // services.
    expect(codeOnly()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    expect(codeOnly()).not.toMatch(/setTimeout|AbortController/);
  });

  it("reads a problem's detail in exactly two modules, both documented", () => {
    // Branch on `type`, never on `detail` — with two deliberate exceptions: the 502 triage, and telling
    // an in-flight 409 from a key reused with a different body. Both are the difference between a safe
    // retry and a double charge, and both fail closed.
    const readers = sourceFiles()
      .filter((file) => /detail\.toLowerCase\(\)|prose\.includes/.test(readFileSync(file, "utf8")))
      .map((file) => path.basename(file))
      .sort();
    expect(readers).toEqual(["errors.ts", "provider-outcome.ts"]);
  });

  it("mints no idempotency key of its own", () => {
    // A key derived from a clock or a random source is correct in the happy path and reintroduces
    // exactly the double charge the requirement exists to prevent.
    expect(codeOnly()).not.toMatch(/randomUUID|Date\.now\(\)|Math\.random/);
  });
});
