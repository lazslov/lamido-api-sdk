// Regenerates packages/content/test/fixtures/revalidation/*.json.
//
//   node packages/content/test/fixtures/revalidation/generate.mjs
//
// Uses node:crypto deliberately: the fixtures must come from an implementation INDEPENDENT of the
// one under test, which reaches for crypto.subtle only. If both sides shared code the fixtures
// would prove nothing. The committed JSON is the pinned artifact; this script is throwaway.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Per ENDPOINT now, not per site. The old per-site secret cannot be carried across.
const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, lowercase hex behind the prefix the service sends. */
const sign = (timestamp, rawBody) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;

/** A fixed "now", in Unix seconds, so every case is deterministic. */
const now = 1_785_168_000;

/** One delivery body, in the estate's standard event envelope. */
const delivery = (eventType, data, overrides = {}) =>
  JSON.stringify({
    event_id: "019fc236-0c4e-7e3f-8203-70fcad1d20e2",
    event_type: eventType,
    contract_version: 1,
    occurred_at: "2026-07-28T09:12:44.101Z",
    service: "content-service",
    account_id: "3f7c1a92-5d84-4e60-b1c7-9a2e0f6b8d43",
    tenant: { kind: "site", public_id: "bb0e8f21-3c4d-4a5b-9e6f-7a8b9c0d1e2f" },
    correlation_id: "019fc236-0c4e-7e3f-8203-70fcad1d20e2",
    causation_id: null,
    hop: 0,
    data,
    ...overrides,
  });

const pagePublished = delivery("page.published", {
  page: { slug: "home", version: 8, locales: ["hu"] },
});
const wholeSite = delivery("site.revalidation_requested", {
  site: { slug: "acme_foundation", scope: null },
});
const itemPublished = delivery("collection_item.published", {
  collection_item: { collection: "news", slug: "elso_hir", status: "published" },
});
// An item with no slug. Slugless items are legal — only ones addressable by URL need one — so a
// receiver reading `data.collection_item.slug` must tolerate null.
const sluglessItem = delivery("collection_item.archived", {
  collection_item: { collection: "news", slug: null, status: "archived" },
});
// A type this SDK has never heard of. It must verify and parse: answering non-2xx for it would
// dead-letter a delivery that was fine, and five of those disable the endpoint.
const unknownType = delivery("page.unpublished", { page: { slug: "home", version: 9 } });

const cases = [
  {
    name: "valid-page",
    describes: "a page publish, the ordinary delivery",
    rawBody: pagePublished,
    expect: { ok: true, event: JSON.parse(pagePublished) },
  },
  {
    name: "valid-whole-site",
    describes: "an operator re-fired the whole site — its own event type now, not a null slug",
    rawBody: wholeSite,
    expect: { ok: true, event: JSON.parse(wholeSite) },
  },
  {
    name: "valid-collection-item",
    describes: "a collection item reaching published, which carries its own status",
    rawBody: itemPublished,
    expect: { ok: true, event: JSON.parse(itemPublished) },
  },
  {
    name: "valid-slugless-item",
    describes: "an item with no slug, which is legal: only URL-addressable items need one",
    rawBody: sluglessItem,
    expect: { ok: true, event: JSON.parse(sluglessItem) },
  },
  {
    name: "valid-unknown-event-type",
    describes: "an event type this SDK does not know, which must still verify and parse",
    rawBody: unknownType,
    expect: { ok: true, event: JSON.parse(unknownType) },
  },
  {
    name: "bad-signature-tampered-slug",
    describes: "the signature of one body presented with another — the slug was edited in flight",
    rawBody: delivery("page.published", { page: { slug: "pricing", version: 8, locales: ["hu"] } }),
    signature: sign(String(now), pagePublished),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: pagePublished,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), pagePublished),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all — an unsigned POST is one any stranger could forge",
    rawBody: pagePublished,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-body",
    describes: "a valid signature over a body that is not an event envelope",
    rawBody: JSON.stringify({ hello: "world" }),
    expect: { ok: false, reason: "malformed_body" },
  },
];

const dir = path.dirname(fileURLToPath(import.meta.url));

for (const testCase of cases) {
  const timestamp = testCase.timestamp ?? String(now);
  const fixture = {
    name: testCase.name,
    describes: testCase.describes,
    secret,
    rawBody: testCase.rawBody,
    timestamp,
    signature:
      testCase.signature === undefined ? sign(timestamp, testCase.rawBody) : testCase.signature,
    nowSeconds: now,
    expect: testCase.expect,
  };
  writeFileSync(
    path.join(dir, `${testCase.name}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8",
  );
}
