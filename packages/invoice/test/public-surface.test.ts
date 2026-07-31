import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as invoicePackage from "../src/index.js";

/**
 * What this package promises, and what it promises *not* to offer.
 *
 * @remarks
 * Several of phase 4's exit criteria are about an absence — no admin endpoint, no `mode`, no conversion
 * to payment's minor units, no webhook verifier — and an absence is only enforceable from the surface
 * and from the source text.
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
 * does not — the admin tier it never calls, the `mode` it declines to set, the public PDF route it
 * refuses to fetch. Grepping the prose would fail on the very sentences that explain the rule. Whole
 * comment lines and block comments go; a trailing comment after code would survive, which is why none
 * of these patterns appears in one.
 */
function codeOnly(): string {
  return sourceText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const exported = Object.keys(invoicePackage).sort();

describe("the runtime exports", () => {
  it("are exactly what phase 4 specifies", () => {
    expect(exported).toEqual([
      "InvoiceApiError",
      "InvoiceNotDownloadableError",
      "VERSION",
      "createInvoiceClient",
      "isoDate",
      "tryCreateInvoiceClient",
    ]);
  });

  it("offers no conversion to or from payment-service's minor-unit amounts", () => {
    // The two services disagree by a factor of 100 — grossAmount is a major-unit number here, a
    // decimal string of minor units there — and that conversion belongs in the site, written once,
    // visibly. A shared money type would imply the two services agree.
    const conversion = /(minor|toMinor|fromMinor|huf|forint|cents|toMajor|money|amount)/i;
    expect(exported.filter((name) => conversion.test(name))).toEqual([]);
    expect(sourceText()).not.toMatch(/MinorUnits/);
    expect(sourceText()).not.toMatch(/@lamido\/payment["']/);
  });

  it("exports no webhook verifier, because the service never calls you", () => {
    const webhook = /(webhook|verifySigned|signature|parseEvent)/i;
    expect(exported.filter((name) => webhook.test(name))).toEqual([]);
  });

  it("mints no idempotency key of its own", () => {
    // A key derived from a clock or a random source is correct in the happy path and removes the
    // double-invoice protection entirely.
    expect(exported.filter((name) => /idempot/i.test(name))).toEqual([]);
    expect(codeOnly()).not.toMatch(/randomUUID|Math\.random/);
  });
});

describe("the code", () => {
  it("names no admin endpoint", () => {
    // The admin tier is the larger half of this service and is operator-only.
    expect(codeOnly()).not.toMatch(/["'`]\/api\/admin/);
    expect(codeOnly()).not.toMatch(/\/api\/admin\//);
  });

  it("never fetches the public tokenized PDF route", () => {
    // It is a URL to hand to a browser; fetching it through an authenticated client is pointless.
    expect(codeOnly()).not.toMatch(/\/api\/public\//);
  });

  it("names no deployment host, and carries no default base URL", () => {
    // Over the full text, comments included: a host in a doc comment is a host in the tarball.
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
  });

  it("sets no fetch mode", () => {
    // invoice-service's ADMIN tier rejects `Sec-Fetch-Mode: cors`, and `mode: "same-origin"` is the
    // documented workaround for it — but v1 does not cover that tier, and content-service's own docs
    // warn integrators not to copy the workaround across. So there is nothing to satisfy here.
    expect(codeOnly()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    // Especially here: an automatic retry of a create would reuse a spent key and return the same
    // failed invoice, or mint a new one and double-invoice.
    expect(codeOnly()).not.toMatch(/setTimeout|AbortController/);
  });

  it("reads the service's message in exactly one module, documented and failing closed", () => {
    // Branch on `code`, never on `message`. The one exception lifts the invoice's status out of the
    // not-downloadable message as a hint on a named error, and answers null when the wording changes.
    const readers = sourceFiles()
      .filter((file) => /\(status:/.test(readFileSync(file, "utf8")))
      .map((file) => path.basename(file))
      .sort();
    expect(readers).toEqual(["errors.ts"]);
  });

  it("declares no whole-invoice write, because an issued invoice can only be cancelled", () => {
    // No modification endpoint exists in the service; there is no PATCH and no PUT anywhere.
    expect(codeOnly()).not.toMatch(/method:\s*["'](?:PATCH|PUT|DELETE)["']/);
  });
});
