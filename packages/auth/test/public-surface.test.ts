import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import * as auth from "../src/index.js";

/**
 * What this package promises, and what it promises *not* to offer. Several of phase 9's exit criteria
 * are about an absence — no operator route, no provider callback, no scheduler, no inbound receiver,
 * no widened decision — and an absence is only enforceable from the surface and from the source text.
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
 * does not — the operator tier it declines to reach, the callbacks a browser navigates to. Grepping the
 * prose would fail on the very sentences that explain the rule.
 */
function codeOnly(): string {
  return sourceText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const exported = Object.keys(auth).sort();

describe("the runtime exports", () => {
  it("are exactly what phase 9 specifies", () => {
    expect(exported).toEqual([
      "AuthApiError",
      "VERSION",
      "authProblemCodes",
      "createAuthClient",
      "createAuthPublicClient",
      "customerSessionCookie",
      "deliveryIdHeader",
      "eventIdHeader",
      "isCustomerEvent",
      "isKnownEvent",
      "isPingEvent",
      "isSubscriptionEvent",
      "isTerminalLoginStatus",
      "parseAuthWebhookEvent",
      "pingEventType",
      "platformSessionCookie",
      "sessionTokenFromSetCookie",
      "sessionTokenHeader",
      "signatureHeader",
      "timestampHeader",
      "tryCreateAuthClient",
      "tryCreateAuthPublicClient",
      "verifyAuthWebhook",
    ]);
  });

  it("re-exports no paginator; core's collectAllCursor is the one to use", () => {
    expect(exported).not.toContain("collectAll");
    expect(exported).not.toContain("collectAllCursor");
  });

  it("mints no session and reads no health, because neither is a consumer surface", () => {
    const forbidden = /^(mintSession|createSession|getHealth|health)$/i;
    expect(exported.filter((name) => forbidden.test(name))).toEqual([]);
  });
});

describe("the code", () => {
  it("names no operator route, no provider callback, no scheduler and no inbound receiver", () => {
    const code = codeOnly();
    expect(code).not.toMatch(/["'`]\/v1\/admin/);
    expect(code).not.toMatch(/\/v1\/providers/);
    expect(code).not.toMatch(/\/api\/cron/);
    expect(code).not.toMatch(/\/v1\/hooks/);
    expect(code).not.toMatch(/\/healthz/);
  });

  it("names no deployment host, and carries no default base URL", () => {
    // Over the full text, comments included: a host in a doc comment is a host in the tarball.
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
    expect(sourceText()).not.toMatch(/lamido\.hu/);
  });

  it("sets no fetch mode", () => {
    // The service's Origin / Sec-Fetch-Dest check is a tripwire, not a boundary, so there is nothing
    // for the SDK to satisfy.
    expect(codeOnly()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    expect(codeOnly()).not.toMatch(/setTimeout|AbortController/);
  });

  it("never branches on a problem's title or detail", () => {
    // Branch on `type` and `code`, never on prose. There is no documented exception on this service.
    expect(codeOnly()).not.toMatch(/detail\.(toLowerCase|includes|match|startsWith)/);
    expect(codeOnly()).not.toMatch(/title\.(toLowerCase|includes|match|startsWith)/);
  });

  it("mints no idempotency key of its own", () => {
    expect(codeOnly()).not.toMatch(/randomUUID|Date\.now\(\)|Math\.random/);
  });

  it("widens no decision: allow and deny are hard-coded and nothing else compares to them", () => {
    // The one enum in this API that cannot grow. `string & {}` is used on every other status union,
    // and must never appear next to the decision.
    const decision = /AuthorizationDecision\s*=\s*[^;]*string/;
    expect(sourceText()).not.toMatch(decision);
  });
});
