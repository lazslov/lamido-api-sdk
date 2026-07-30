import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { constantTimeEqual, hmacSha256, toHex } from "../src/crypto.js";
import { type VerifyFailure, verifySignedBody } from "../src/hmac.js";

/** One pinned fixture. See test/fixtures/hmac/generate.mjs for how they were produced. */
interface HmacFixture {
  readonly name: string;
  readonly describes: string;
  readonly secret: string;
  readonly rawBody: string;
  readonly signature: string | null;
  readonly timestamp: string | null;
  readonly nowSeconds: number;
  readonly expect: { ok: true } | { ok: false; reason: VerifyFailure };
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "hmac");

const fixtures: HmacFixture[] = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")) as HmacFixture);

describe("verifySignedBody against pinned fixtures", () => {
  it("has a fixture for every failure reason, and at least one valid case", () => {
    const reasons = new Set(
      fixtures.flatMap((fixture) => (fixture.expect.ok ? [] : [fixture.expect.reason])),
    );
    expect(reasons).toEqual(
      new Set<VerifyFailure>([
        "missing_signature",
        "malformed_timestamp",
        "stale_timestamp",
        "bad_signature",
      ]),
    );
    expect(fixtures.some((fixture) => fixture.expect.ok)).toBe(true);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    async (_name, fixture) => {
      const verdict = await verifySignedBody({
        secret: fixture.secret,
        rawBody: fixture.rawBody,
        signature: fixture.signature,
        timestamp: fixture.timestamp,
        nowSeconds: fixture.nowSeconds,
      });
      expect(verdict, fixture.describes).toEqual(fixture.expect);
    },
  );
});

describe("verifySignedBody behaviour", () => {
  const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";
  const rawBody = '{"event":"page.published"}';
  const now = 1_770_000_000;

  /** Sign with the implementation under test, for cases about inputs rather than digests. */
  async function sign(timestamp: string, body: string): Promise<string> {
    return `sha256=${toHex(await hmacSha256(secret, `${timestamp}.${body}`))}`;
  }

  it("accepts a body exactly at the tolerance boundary", async () => {
    const timestamp = String(now - 300);
    const verdict = await verifySignedBody({
      secret,
      rawBody,
      timestamp,
      signature: await sign(timestamp, rawBody),
      nowSeconds: now,
    });
    expect(verdict.ok).toBe(true);
  });

  it("honours a custom tolerance", async () => {
    const timestamp = String(now - 30);
    const signature = await sign(timestamp, rawBody);
    expect(
      (await verifySignedBody({ secret, rawBody, timestamp, signature, nowSeconds: now })).ok,
    ).toBe(true);
    expect(
      await verifySignedBody({
        secret,
        rawBody,
        timestamp,
        signature,
        nowSeconds: now,
        toleranceSeconds: 10,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("treats an empty signature as missing", async () => {
    expect(
      await verifySignedBody({
        secret,
        rawBody,
        timestamp: String(now),
        signature: "",
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("rejects a re-serialised body, which is why rawBody is a string", async () => {
    // Same data, different key order and whitespace: the digest changes.
    const original = '{"a":1,"b":2}';
    const reserialised = JSON.stringify({ b: 2, a: 1 });
    const verdict = await verifySignedBody({
      secret,
      rawBody: reserialised,
      timestamp: String(now),
      signature: await sign(String(now), original),
      nowSeconds: now,
    });
    expect(verdict).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("never throws for a malformed input", async () => {
    await expect(
      verifySignedBody({ secret, rawBody: "", signature: null, timestamp: null, nowSeconds: now }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });

  it("checks skew before the digest, so a stale body with a wrong signature reads as stale", async () => {
    expect(
      await verifySignedBody({
        secret,
        rawBody,
        timestamp: String(now - 10_000),
        signature: "sha256=deadbeef",
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });
});

describe("crypto primitives", () => {
  it("encodes a digest as lowercase hex", () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe("000fa0ff");
  });

  it("uses the whole secret, prefix included", async () => {
    const withPrefix = toHex(await hmacSha256("whsec_EXAMPLE_KEY", "1.body"));
    const stripped = toHex(await hmacSha256("EXAMPLE_KEY", "1.body"));
    expect(withPrefix).not.toBe(stripped);
  });

  it("handles a non-ASCII message by its UTF-8 bytes", async () => {
    const accented = toHex(await hmacSha256("secret-value", "Árvíztűrő"));
    expect(accented).toMatch(/^[0-9a-f]{64}$/);
    expect(accented).not.toBe(toHex(await hmacSha256("secret-value", "Arvizturo")));
  });

  it("compares equal strings as equal and unequal ones as unequal", async () => {
    await expect(constantTimeEqual("sha256=abc", "sha256=abc")).resolves.toBe(true);
    await expect(constantTimeEqual("sha256=abc", "sha256=abd")).resolves.toBe(false);
  });

  it("compares strings of different lengths without throwing", async () => {
    // node:crypto.timingSafeEqual throws here, which is why double-HMAC is used instead.
    await expect(constantTimeEqual("short", "considerably longer")).resolves.toBe(false);
  });
});
