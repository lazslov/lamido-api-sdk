import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as email from "../src/index.js";

/**
 * What this package promises, and what it promises *not* to offer. Several exit criteria are about
 * an absence — no admin endpoint, no inbound receiver, no body field, no minted key — and an absence
 * is only enforceable from the surface and from the source text.
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
 * does not — the admin tier it declines to reach, the receivers it never calls, the random key it
 * refuses to mint. Grepping the prose would fail on the very sentences that explain the rule.
 */
function codeOnly(): string {
  return sourceText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const exported = Object.keys(email).sort();

describe("the runtime exports", () => {
  it("are exactly what phase 9 specifies", () => {
    expect(exported).toEqual([
      "EmailApiError",
      "VERSION",
      "createEmailClient",
      "deliveryIdHeader",
      "eventIdHeader",
      "isCancellable",
      "isKnownEvent",
      "isMessageEvent",
      "minorAmount",
      "parseEmailWebhookEvent",
      "signatureHeader",
      "timestampHeader",
      "tryCreateEmailClient",
      "verifyEmailWebhook",
    ]);
  });

  it("performs no arithmetic on amounts, and offers no currency conversion", () => {
    // An amount here is for display in a template. Formatting it is the service's job, with BigInt
    // and no float on the path; converting it is nobody's.
    const arithmetic = /^(add|sum|subtract|minus|plus|total|multiply|divide|negate|convert|format)/;
    expect(exported.filter((name) => arithmetic.test(name))).toEqual([]);
  });

  it("re-exports no paginator, which stays in api-core", () => {
    expect(exported).not.toContain("collectAllCursor");
  });

  it("offers no publishable-tier constructor, because the service has no publishable tier", () => {
    // A browser-safe email key is an open relay with the key printed in the page source.
    expect(exported.filter((name) => /publishable|browser|public/i.test(name))).toEqual([]);
  });
});

describe("the code", () => {
  it("names no admin endpoint, no provider callback, no inbound receiver and no cron", () => {
    expect(codeOnly()).not.toMatch(/\/v1\/admin/);
    expect(codeOnly()).not.toMatch(/\/v1\/providers/);
    expect(codeOnly()).not.toMatch(/\/v1\/hooks/);
    expect(codeOnly()).not.toMatch(/\/api\/cron/);
    expect(codeOnly()).not.toMatch(/\/healthz/);
  });

  it("names no deployment host, and carries no default base URL", () => {
    // Over the full text, comments included: a host in a doc comment is a host in the tarball.
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
    expect(sourceText()).not.toMatch(/lamido\.hu/);
  });

  it("sets no fetch mode", () => {
    // The tripwire keys on Sec-Fetch-Dest, which undici does not send, so there is nothing to
    // satisfy — and `mode: "same-origin"` is the obsolete workaround the service says to delete.
    expect(codeOnly()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    expect(codeOnly()).not.toMatch(/setTimeout|AbortController/);
  });

  it("never reads a problem's detail or title to decide anything", () => {
    // Branch on `code`, never on `detail` or `title`. Unlike payment-service there is no 502 triage
    // here — the send is asynchronous and provider failures never come back on the request.
    expect(codeOnly()).not.toMatch(/detail\.toLowerCase\(\)|detail\.includes|title\.includes/);
  });

  it("mints no idempotency key of its own", () => {
    // A key derived from a clock or a random source is correct in the happy path and reintroduces
    // exactly the duplicate email the requirement exists to prevent.
    expect(codeOnly()).not.toMatch(/randomUUID|Date\.now\(\)|Math\.random/);
  });

  it("declares no body or html field on the send input", () => {
    // Template-only sending is the control that makes a leaked key unable to compose arbitrary mail.
    const types = readFileSync(path.join(srcDir, "types.ts"), "utf8");
    expect(types).not.toMatch(/^\s*readonly (body|html|text)\??:/m);
  });
});
