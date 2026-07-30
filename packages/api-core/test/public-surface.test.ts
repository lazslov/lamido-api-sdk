import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as core from "../src/index.js";

/**
 * Core owns what is true of all three services, and the surface is the place that claim is
 * enforceable. If a service-specific name appears here, something has leaked in from a phase
 * that should have bound it instead.
 */

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every source file in the package, as text. */
function sourceText(): string {
  return listFiles(srcDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("the public surface", () => {
  it("exports exactly what phase 2 specifies", () => {
    expect(Object.keys(core).sort()).toEqual([
      "LamidoApiError",
      "NotConfiguredError",
      "VERSION",
      "assertServerOnly",
      "buildQuery",
      "collectAll",
      "derivedIdempotencyKey",
      "idempotencyKey",
      "request",
      "resolveConfig",
      "verifySignedBody",
    ]);
  });
});

describe("core carries nothing service-specific", () => {
  it("contains no default or fallback base URL", () => {
    // Every absolute URL in the source is a documentation example inside a doc comment.
    const assignments = /(?:baseUrl|BASE_URL|url)\s*[=:]\s*["'`]https?:\/\//g;
    expect(sourceText().match(assignments)).toBeNull();
  });

  it("names no environment variable", () => {
    // The names differ per service and are supplied by each package, never known here.
    const envNames = /\b(CONTENT|INVOICE|PAYMENT)_SERVICE_[A-Z_]+\b/g;
    expect(sourceText().match(envNames)).toBeNull();
  });

  it("reads no environment variable by a hard-coded name", () => {
    // `process.env[name]` is fine; `process.env.SOMETHING` is not.
    expect(sourceText()).not.toMatch(/process\.env\.[A-Za-z_]/);
  });

  it("contains no service-specific error code or problem type", () => {
    const codes = /"(page_not_found|invoice_provider_error|payment_not_refundable)"/;
    expect(sourceText()).not.toMatch(codes);
  });

  it("contains no webhook header name, which each package binds", () => {
    // X-Signature vs X-Content-Signature is exactly the seam phases 3 and 5 bind to.
    expect(sourceText()).not.toMatch(/X-(Content-)?Signature/);
  });

  it("hard-codes no money handling, because nothing generic is true of it", () => {
    // invoice is a major-unit number, payment a minor-unit decimal string.
    expect(sourceText()).not.toMatch(/\b(amount_minor|amountMinor|currencyExponent)\b/);
  });

  it("exports no function that returns an idempotency key without an argument", () => {
    expect(core.idempotencyKey.length).toBe(1);
    expect(core.derivedIdempotencyKey.length).toBe(2);
  });
});
