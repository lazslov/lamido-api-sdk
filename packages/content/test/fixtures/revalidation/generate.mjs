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

const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, lowercase hex behind the prefix the service sends. */
const sign = (timestamp, rawBody) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;

/** A fixed "now", in Unix seconds, so every case is deterministic. */
const now = 1_785_168_000;

/** One delivery body, as the service composes it. */
const delivery = (overrides) =>
  JSON.stringify({
    site: "acme_foundation",
    type: "page",
    slug: "home",
    collection: null,
    version: 8,
    publishedAt: "2026-07-28T09:12:44.101Z",
    ...overrides,
  });

const pagePublish = delivery({});
const wholeSite = delivery({ slug: null, version: null });
const itemPublish = delivery({
  type: "collection_item",
  slug: "elso_hir",
  collection: "news",
  version: null,
});
// A page delivery whose version is null. Every field of this payload is a slug, a timestamp or an
// enum, so there is no non-ASCII case to pin here — that lives in api-core's own HMAC fixtures.
const nullVersionPage = delivery({ version: null });

const cases = [
  {
    name: "valid-page",
    describes: "a page publish, the ordinary delivery",
    rawBody: pagePublish,
    expect: { ok: true, event: JSON.parse(pagePublish) },
  },
  {
    name: "valid-whole-site",
    describes:
      "a null slug, which means revalidate everything — a staff re-fire or a slugless item",
    rawBody: wholeSite,
    expect: { ok: true, event: JSON.parse(wholeSite) },
  },
  {
    name: "valid-collection-item",
    describes: "a collection item, whose version is null because items have no versions",
    rawBody: itemPublish,
    expect: { ok: true, event: JSON.parse(itemPublish) },
  },
  {
    name: "valid-null-version-on-a-page",
    describes: "a page delivery with a null version, which a whole-site re-fire produces",
    rawBody: nullVersionPage,
    expect: { ok: true, event: JSON.parse(nullVersionPage) },
  },
  {
    name: "bad-signature-tampered-slug",
    describes: "the signature of one body presented with another — the slug was edited in flight",
    rawBody: delivery({ slug: "pricing" }),
    signature: sign(String(now), pagePublish),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: pagePublish,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), pagePublish),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all — an unsigned POST is one any stranger could forge",
    rawBody: pagePublish,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-body",
    describes: "a valid signature over a body that is not a delivery",
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
