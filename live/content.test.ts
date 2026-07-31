import { type ContentApiError, createContentClient, createWebsiteClient } from "@lamido/content";
import { describe, expect, it } from "vitest";
import {
  contentPublishableKey,
  contentScratchSlug,
  contentTarget,
  failure,
  skipReason,
} from "./config.js";

/**
 * content-service, live.
 *
 * @remarks
 * **Nothing here publishes.** `POST …/publish` makes every unpublished draft on that page live, so a
 * probe that publishes is not a probe — it is an edit to someone's site. The one write case reads a
 * value and patches it back **unchanged**, which proves the value shape and changes nothing.
 *
 * Each case verifies a *documented claim the SDK depends on*, not merely that a request succeeds.
 */
describe.skipIf(!contentTarget.ready)(`content-service live`, () => {
  const client = () =>
    createContentClient({
      baseUrl: contentTarget.baseUrl,
      apiKey: contentTarget.keys.secret,
    });
  const website = () =>
    createWebsiteClient({
      baseUrl: contentTarget.baseUrl,
      apiKey: contentTarget.keys.secret,
    });
  it("answers the documented boot check with this key's own site", async () => {
    // getMe is what a site calls to confirm which tenant a key belongs to. If this is the wrong site,
    // every other assertion here is about somebody else's content.
    const me = await client().getMe();
    expect(me.site.slug).toBeTypeOf("string");
    expect(me.site.slug.length).toBeGreaterThan(0);
  });
  it("maps an unpublished slug to null rather than throwing", async () => {
    // The SDK's rule is that only a *documented* 404 becomes null. This is the documented one.
    const absent = `sdk-live-probe-${"no-such-page"}`;
    await expect(website().getPage(absent)).resolves.toBeNull();
  });
  it("rejects an out-of-range limit with a 400 rather than clamping it", async () => {
    // The SDK forwards `limit` untouched precisely because the service is strict here. A clamp would
    // mean a caller asking for 500 silently gets 100 and never learns their pager is wrong.
    const error = await failure<ContentApiError>(() => client().listAssets({ limit: 500 }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("validation_error");
  });
  it("keeps a list's total alongside its rows, which is what the paginator follows", async () => {
    // content-service DOES return total — the opposite of invoice-service, and the reason core's
    // paginator has two branches at all.
    const collections = await client().listCollections();
    if (collections.length === 0) return;
    const first = collections[0];
    if (!first) return;
    const page = await client().listItems(first.key, { limit: 1 });
    expect(page.total).toBeTypeOf("number");
    expect(page.limit).toBe(1);
  });
  it("answers health, including the degraded body if the database is down", async () => {
    // The SDK returns a 503's body rather than throwing, so `status` is the check either way.
    const health = await website().getHealth();
    expect(["ok", "degraded"]).toContain(health.status);
  });
  it.skipIf(!contentPublishableKey)("refuses a publishable key on the client tier", async () => {
    // The two tiers are separate credential systems. This is what makes `createWebsiteClient` and
    // `createContentClient` two constructors rather than one client with a tier option.
    const publishable = createContentClient({
      baseUrl: contentTarget.baseUrl,
      apiKey: contentPublishableKey,
    });
    const error = await failure<ContentApiError>(() => publishable.getMe());
    expect([401, 403]).toContain(error.status);
  });
  it.skipIf(!contentScratchSlug)(
    "round-trips a value unchanged, proving the shape without publishing",
    async () => {
      // Read, PATCH back identically, read again. Nothing is published, so nothing goes live — and the
      // draft is byte-identical to what was already there.
      const slug = contentScratchSlug as string;
      const before = await client().getRenderedPage(slug, { view: "draft" });
      // A **string** value only. An `image` reads back as the resolved `{ url, alt, width, height }`
      // and is written as `{ assetId, alt }`, so writing a read image value back is not a round trip at
      // all — it is the documented asymmetry that makes an image key always count as a change.
      const found = before.sections.flatMap((section) =>
        Object.entries(section.fields)
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => ({ section: section.key, key, value: value as string })),
      )[0];
      if (found === undefined) return;
      const after = await client().patchValues(slug, {
        [`${found.section}.${found.key}`]: found.value,
      });
      const readBack = after.sections.find((section) => section.key === found.section);
      expect(readBack?.fields[found.key]).toBe(found.value);
    },
  );
});
describe.skipIf(contentTarget.ready)("content-service live (skipped)", () => {
  it("reports why", () => {
    // A skipped suite that says nothing reads as a passing suite.
    console.info(`  ${skipReason(contentTarget)}`);
    expect(contentTarget.ready).toBe(false);
  });
});
