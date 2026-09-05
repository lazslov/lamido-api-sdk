import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as booking from "../src/index.js";

/**
 * What this package promises, and what it promises *not* to offer. Several of the exit criteria are
 * about an absence — no admin endpoint, no key management, no arithmetic on money, no read of a
 * problem's prose — and an absence is only enforceable from the surface and from the source text.
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
 * does not — the admin tier it declines to reach, the `mode` it refuses to set, the `detail` it never
 * branches on. Grepping the prose would fail on the very sentences that explain the rule.
 */
function codeOnly(): string {
  return sourceText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const exported = Object.keys(booking).sort();

describe("the runtime exports", () => {
  it("are exactly what the phase-9 plan specifies", () => {
    expect(exported).toEqual([
      "BookingApiError",
      "VERSION",
      "bookingTokenHeader",
      "createBookingClient",
      "createBookingPublicClient",
      "deliveryIdHeader",
      "eventIdHeader",
      "isKnownEvent",
      "parseBookingWebhookEvent",
      "signatureHeader",
      "timestampHeader",
      "tryCreateBookingClient",
      "tryCreateBookingPublicClient",
      "verifyBookingWebhook",
    ]);
  });

  it("performs no arithmetic on amounts, and offers no money helper at all", () => {
    // `price_minor` is read, never computed. HUF is zero-decimal, so a helper that divided by 100
    // would be the exact bug the knowledge base warns about.
    const money =
      /^(add|sum|subtract|minus|plus|total|multiply|divide|negate|huf|toForint|fromMinor|toMinor|minorUnits)([A-Z_]|$)/i;
    expect(exported.filter((name) => money.test(name))).toEqual([]);
    expect(codeOnly()).not.toMatch(/\/\s*100\b|\*\s*100\b/);
  });

  it("re-exports no paginator; core's collectAllCursor works on the pages as they are", () => {
    expect(exported).not.toContain("collectAllCursor");
    expect(exported).not.toContain("collectAll");
  });

  it("mints no capability token and no nonce", () => {
    // Both are the service's or the caller's to produce; a helper here would look authoritative.
    expect(exported.filter((name) => /nonce|mintToken|generateToken/i.test(name))).toEqual([]);
  });
});

describe("the code", () => {
  it("names no admin, provider, cron or key-management route", () => {
    // `/v1/providers/*` is Google's traffic and `/api/cron/*` is the scheduler's — never ours.
    expect(codeOnly()).not.toMatch(/\/v1\/admin/);
    expect(codeOnly()).not.toMatch(/\/v1\/providers/);
    expect(codeOnly()).not.toMatch(/\/api\/cron/);
    expect(codeOnly()).not.toMatch(/\/v1\/keys/);
  });

  it("names no deployment host, and carries no default base URL", () => {
    // Over the full text, comments included: a host in a doc comment is a host in the tarball.
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
    expect(sourceText()).not.toMatch(/lamido\.hu/);
  });

  it("sets no fetch mode", () => {
    // The service's Origin / Sec-Fetch-Dest check is a tripwire, not a boundary, and its docs say to
    // delete any inherited `mode: 'same-origin'`.
    expect(codeOnly()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    expect(codeOnly()).not.toMatch(/setTimeout|AbortController/);
  });

  it("never reads a problem's detail to decide anything", () => {
    // The knowledge base's first rule: branch on `code`, never on `detail`. Payment has to read prose
    // for its 502 triage; this service's `code` set covers every branch, so nothing here does.
    expect(codeOnly()).not.toMatch(/detail\.toLowerCase\(\)|detail\.includes\(|detail\.match\(/);
  });

  it("maps a 404 to null in exactly one place, the calendar connection", () => {
    const users = sourceFiles()
      .filter((file) => path.basename(file) !== "call.ts")
      // `[<(]` because the one call site supplies a type argument — `callOrNull<CalendarConnection>(`
      // — which a bare `\(` misses, and the import line ends in a comma so it never matches.
      .filter((file) => /callOrNull[<(]/.test(readFileSync(file, "utf8")))
      .map((file) => path.basename(file));
    expect(users).toEqual(["calendar.ts"]);
  });

  it("mints no idempotency key of its own", () => {
    // A key derived from a clock or a random source is correct in the happy path and reintroduces
    // exactly the double booking the requirement exists to prevent.
    expect(codeOnly()).not.toMatch(/randomUUID|Date\.now\(\)|Math\.random/);
  });

  it("never puts a capability token in a URL", () => {
    // A token in a query string ends up in referrer headers, history and every log in between. The
    // management token travels in a header, the confirmation token in a body.
    expect(codeOnly()).not.toMatch(/query:\s*\{[^}]*token/i);
    expect(codeOnly()).not.toMatch(/\?token=/);
  });
});

describe("the documentation", () => {
  it("states that the service sends nothing, on the package entry", () => {
    // The most expensive thing to discover late, so it is the first thing the index says.
    const index = readFileSync(path.join(srcDir, "index.ts"), "utf8");
    expect(index).toMatch(/this service sends nothing/i);
    expect(index).toMatch(/No email, no SMS, no push/);
  });
});
