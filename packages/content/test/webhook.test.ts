import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type RevalidationVerdict,
  signatureHeader,
  timestampHeader,
  verifyRevalidationWebhook,
} from "../src/webhook.js";

/** One pinned fixture. See test/fixtures/revalidation/generate.mjs for how they were produced. */
interface RevalidationFixture {
  readonly name: string;
  readonly describes: string;
  readonly secret: string;
  readonly rawBody: string;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly nowSeconds: number;
  readonly expect: RevalidationVerdict;
}

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "revalidation",
);

const fixtures: RevalidationFixture[] = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .map(
    (file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")) as RevalidationFixture,
  );

/** The headers the service sends, as a route handler would receive them. */
function headers(fixture: RevalidationFixture): Headers {
  const built = new Headers();
  if (fixture.signature !== null) built.set(signatureHeader, fixture.signature);
  if (fixture.timestamp !== null) built.set(timestampHeader, fixture.timestamp);
  return built;
}

describe("verifyRevalidationWebhook against pinned fixtures", () => {
  it("covers the two documented nulls, both easy to crash on", () => {
    const events = fixtures.flatMap((fixture) => (fixture.expect.ok ? [fixture.expect.event] : []));
    expect(events.some((event) => event.slug === null)).toBe(true);
    expect(events.some((event) => event.version === null && event.type === "page")).toBe(true);
    expect(events.some((event) => event.type === "collection_item")).toBe(true);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    async (_name, fixture) => {
      const verdict = await verifyRevalidationWebhook({
        secret: fixture.secret,
        rawBody: fixture.rawBody,
        headers: headers(fixture),
        nowSeconds: fixture.nowSeconds,
      });
      expect(verdict, fixture.describes).toEqual(fixture.expect);
    },
  );
});

describe("verifyRevalidationWebhook behaviour", () => {
  const valid = fixtures.find((fixture) => fixture.name === "valid-page");
  if (!valid) throw new Error("the valid-page fixture is missing");

  it("binds the service's own header names, so a consumer names neither", async () => {
    expect(signatureHeader).toBe("X-Content-Signature");
    expect(timestampHeader).toBe("X-Content-Timestamp");

    // Header lookup is case-insensitive, which is what an edge runtime actually delivers.
    const lowercased = new Headers({
      "x-content-signature": valid.signature ?? "",
      "x-content-timestamp": valid.timestamp ?? "",
    });
    const verdict = await verifyRevalidationWebhook({
      secret: valid.secret,
      rawBody: valid.rawBody,
      headers: lowercased,
      nowSeconds: valid.nowSeconds,
    });
    expect(verdict.ok).toBe(true);
  });

  it("does not expose the event unless the signature held", async () => {
    // "Verify before you parse" is structural rather than a rule to remember.
    const verdict = await verifyRevalidationWebhook({
      secret: valid.secret,
      rawBody: valid.rawBody,
      headers: new Headers({ "x-content-timestamp": valid.timestamp ?? "" }),
      nowSeconds: valid.nowSeconds,
    });
    expect(verdict).toEqual({ ok: false, reason: "missing_signature" });
    expect(verdict).not.toHaveProperty("event");
  });

  it("rejects a re-serialised body, which is why rawBody is text", async () => {
    const reserialised = JSON.stringify(
      JSON.parse(valid.rawBody),
      Object.keys(JSON.parse(valid.rawBody)).reverse(),
    );
    const verdict = await verifyRevalidationWebhook({
      secret: valid.secret,
      rawBody: reserialised,
      headers: headers(valid),
      nowSeconds: valid.nowSeconds,
    });
    expect(verdict).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is idempotent: the identical delivery verifies twice", async () => {
    // The service retries once with the identical body, timestamp and signature.
    const input = {
      secret: valid.secret,
      rawBody: valid.rawBody,
      headers: headers(valid),
      nowSeconds: valid.nowSeconds,
    };
    await expect(verifyRevalidationWebhook(input)).resolves.toEqual(valid.expect);
    await expect(verifyRevalidationWebhook(input)).resolves.toEqual(valid.expect);
  });

  it("never throws, whatever arrives", async () => {
    await expect(
      verifyRevalidationWebhook({
        secret: valid.secret,
        rawBody: "not json at all",
        headers: new Headers(),
        nowSeconds: valid.nowSeconds,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_signature" });
  });

  it("honours a custom tolerance", async () => {
    const stale = fixtures.find((fixture) => fixture.name === "stale-timestamp");
    if (!stale) throw new Error("the stale-timestamp fixture is missing");

    const verdict = await verifyRevalidationWebhook({
      secret: stale.secret,
      rawBody: stale.rawBody,
      headers: headers(stale),
      nowSeconds: stale.nowSeconds,
      toleranceSeconds: 600,
    });
    expect(verdict.ok).toBe(true);
  });
});
