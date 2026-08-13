import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type ContentWebhookVerdict,
  signatureHeader,
  subjectOf,
  timestampHeader,
  verifyContentWebhook,
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
  readonly expect: ContentWebhookVerdict;
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

describe("verifyContentWebhook against pinned fixtures", () => {
  it("covers the catalogue and the two shapes a receiver crashes on", () => {
    const events = fixtures.flatMap((fixture) => (fixture.expect.ok ? [fixture.expect.event] : []));
    const types = events.map((event) => event.event_type);

    expect(types).toContain("page.published");
    expect(types).toContain("collection_item.published");
    // Its own event type now. It used to arrive as `slug: null` on an ordinary delivery.
    expect(types).toContain("site.revalidation_requested");
    // A slugless item is legal: only items addressable by URL need one.
    expect(
      events.some(
        (event) => (event.data.collection_item as { slug?: unknown } | undefined)?.slug === null,
      ),
    ).toBe(true);
    // A type this SDK has never heard of must still verify and parse.
    expect(types.some((type) => type === "page.unpublished")).toBe(true);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    async (_name, fixture) => {
      const verdict = await verifyContentWebhook({
        secret: fixture.secret,
        rawBody: fixture.rawBody,
        headers: headers(fixture),
        nowSeconds: fixture.nowSeconds,
      });
      expect(verdict, fixture.describes).toEqual(fixture.expect);
    },
  );
});

describe("verifyContentWebhook behaviour", () => {
  const valid = fixtures.find((fixture) => fixture.name === "valid-page");
  if (!valid) throw new Error("the valid-page fixture is missing");

  it("binds the estate's house header names, so a consumer names neither", async () => {
    // The four house headers are shared across every service that sends webhooks, which is why
    // they are not prefixed per service.
    expect(signatureHeader).toBe("X-Signature");
    expect(timestampHeader).toBe("X-Signature-Timestamp");

    // Header lookup is case-insensitive, which is what an edge runtime actually delivers.
    const lowercased = new Headers({
      "x-signature": valid.signature ?? "",
      "x-signature-timestamp": valid.timestamp ?? "",
    });
    const verdict = await verifyContentWebhook({
      secret: valid.secret,
      rawBody: valid.rawBody,
      headers: lowercased,
      nowSeconds: valid.nowSeconds,
    });
    expect(verdict.ok).toBe(true);
  });

  it("does not expose the event unless the signature held", async () => {
    // "Verify before you parse" is structural rather than a rule to remember.
    const verdict = await verifyContentWebhook({
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
    const verdict = await verifyContentWebhook({
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
    await expect(verifyContentWebhook(input)).resolves.toEqual(valid.expect);
    await expect(verifyContentWebhook(input)).resolves.toEqual(valid.expect);
  });

  it("never throws, whatever arrives", async () => {
    await expect(
      verifyContentWebhook({
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

    const verdict = await verifyContentWebhook({
      secret: stale.secret,
      rawBody: stale.rawBody,
      headers: headers(stale),
      nowSeconds: stale.nowSeconds,
      toleranceSeconds: 600,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("subjectOf", () => {
  /** One event, with whatever `data` a case needs. */
  function event(eventType: string, data: Record<string, unknown>) {
    return {
      event_id: "e1",
      event_type: eventType,
      contract_version: 1,
      occurred_at: "2026-07-28T09:12:44.101Z",
      service: "content-service",
      account_id: null,
      tenant: { kind: "site", public_id: "s1" },
      correlation_id: "e1",
      causation_id: null,
      hop: 0,
      data,
    };
  }

  it("finds the block named by the type's prefix", () => {
    const page = { slug: "home", version: 8 };
    expect(subjectOf(event("page.published", { page }))).toEqual(page);
  });

  it("works for a multi-word prefix", () => {
    const item = { collection: "news", slug: null, status: "archived" };
    expect(subjectOf(event("collection_item.archived", { collection_item: item }))).toEqual(item);
  });

  it("finds the subject of an event type this SDK has never seen", () => {
    // The point of resolving by prefix rather than by a per-type branch: one line locates the
    // subject of any event, including types that do not exist yet.
    const page = { slug: "home", version: 9 };
    expect(subjectOf(event("page.unpublished", { page }))).toEqual(page);
  });

  it("answers undefined rather than throwing when the block is absent", () => {
    expect(subjectOf(event("page.published", {}))).toBeUndefined();
  });
});
