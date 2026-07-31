import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import { hmacSha256, toHex } from "../src/crypto.js";
import { verifySignedBody } from "../src/hmac.js";

/**
 * Core must run unchanged on an edge runtime, where `node:crypto` and `Buffer` do not exist.
 *
 * @remarks
 * The static half of this is the important half: no amount of runtime stubbing proves a module
 * will not reach for a Node built-in on a path a test did not take.
 */

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every source file in the package, as text. */
function sources(): { file: string; text: string }[] {
  return listFiles(srcDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file: path.relative(srcDir, file), text: readFileSync(file, "utf8") }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("core depends on no Node built-in", () => {
  it("imports nothing from node:", () => {
    const offenders = sources().filter(({ text }) => /from\s+["']node:/.test(text));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("never mentions Buffer", () => {
    const offenders = sources().filter(({ text }) => /\bBuffer\b/.test(text));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("reaches for crypto only through globalThis", () => {
    // `globalThis.crypto.subtle` is present on Node 20.19+ and on every edge runtime;
    // `require("crypto")` is present on neither uniformly.
    const offenders = sources().filter(({ text }) => /\brequire\(\s*["']crypto/.test(text));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });
});

describe("verification with Node built-ins removed", () => {
  const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";
  const rawBody = '{"event":"payment.succeeded"}';
  const now = 1_770_000_000;

  it("verifies a signature when Buffer and process are undefined", async () => {
    const signature = `sha256=${toHex(await hmacSha256(secret, `${now}.${rawBody}`))}`;

    vi.stubGlobal("Buffer", undefined);
    vi.stubGlobal("process", undefined);

    const verdict = await verifySignedBody({
      secret,
      rawBody,
      signature,
      timestamp: String(now),
      nowSeconds: now,
    });
    expect(verdict.ok).toBe(true);
  });

  it("reports a clear error when Web Crypto itself is missing", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(hmacSha256("secret-value", "message")).rejects.toThrow(
      /globalThis\.crypto\.subtle is unavailable/,
    );
  });
});
