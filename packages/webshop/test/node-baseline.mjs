/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/webshop/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: the CI leg that runs on the floor (Node 20.19)
 * installs nothing at all, because pnpm 11 refuses to start below Node 22.13 — so `node:test`, which
 * ships with the runtime, is the only runner available there. It also imports `dist/` rather than
 * `src/`, so what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: the status predicate, the webhook verifier on this runtime's Web Crypto, one
 * checkout that carries its idempotency key, the public tier's 304 handling, and the `./next` subpath —
 * which is here because it is the only place that can prove the route handler needs no `next` at all.
 * The behaviour itself is the Vitest suites' job.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const {
  createWebshopClient,
  createWebshopPublicClient,
  isConfirmed,
  parseWebshopWebhookEvent,
  verifyWebshopWebhook,
} = await import(pathToFileURL(path.join(here, "..", "dist", "index.js")).href);

test("nothing is confirmed but a confirmed or fulfilled order", () => {
  assert.equal(isConfirmed("pending"), false);
  assert.equal(isConfirmed("paid"), false);
  assert.equal(isConfirmed("confirmed"), true);
  assert.equal(isConfirmed("fulfilled"), true);
});

test("verifyWebshopWebhook agrees with every pinned fixture on this runtime", async () => {
  const fixturesDir = path.join(here, "fixtures", "webhook");
  const fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")));

  assert.ok(fixtures.length > 0, "expected pinned fixtures to be present");

  for (const fixture of fixtures) {
    const headers = new Headers();
    if (fixture.signature !== null) headers.set("X-Signature", fixture.signature);
    if (fixture.timestamp !== null) headers.set("X-Signature-Timestamp", fixture.timestamp);

    const verdict = await verifyWebshopWebhook({
      secret: fixture.secret,
      rawBody: fixture.rawBody,
      headers,
      nowSeconds: fixture.nowSeconds,
    });
    assert.deepEqual(verdict, fixture.expect, `${fixture.name}: ${fixture.describes}`);
  }
});

test("a webhook event parses into the estate envelope with its order block", () => {
  const rawBody = JSON.stringify({
    event_id: "019f1c40-0000-7000-8000-0000000000a1",
    event_type: "order.confirmed",
    contract_version: 1,
    occurred_at: "2026-08-17T09:14:31.204Z",
    service: "webshop-service",
    account_id: null,
    tenant: { kind: "shop", public_id: "019f1c40-0000-7000-8000-0000000000b2" },
    correlation_id: "019f1c40-0000-7000-8000-0000000000a1",
    causation_id: null,
    hop: 0,
    data: {
      order: {
        public_id: "019f1c40-0000-7000-8000-0000000000c3",
        status: "confirmed",
        currency: "HUF",
        subtotal: "12000",
        discount_total: "0",
        shipping_total: "1490",
        tax_total: "2854",
        grand_total: "13490",
        shipping_method_name: null,
        shipping_method_price: null,
        coupon_code: null,
        coupon_discount: null,
        items: [],
        created_at: "2026-08-17T09:12:02.881Z",
      },
    },
  });

  const event = parseWebshopWebhookEvent(rawBody);
  assert.equal(event.data.order.public_id, "019f1c40-0000-7000-8000-0000000000c3");
  assert.equal(event.data.order.grand_total, "13490");
  assert.equal(event.correlation_id, event.event_id);
  assert.equal(event.hop, 0);
});

test("a checkout carries its idempotency key to fetch", async () => {
  const calls = [];
  const client = createWebshopClient({
    baseUrl: "https://webshop.example.com",
    apiKey: "wsk_YOUR_SECRET_KEY_test000",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ public_id: "019e", status: "pending", payment: null, payment_ref: null }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });

  const { order, replayed } = await client.checkout(
    "019e-cart",
    {
      guest_email: "ada@example.com",
      shipping_address: {
        name: "Ada Lovelace",
        line1: "Kossuth Lajos utca 12",
        city: "Budapest",
        postal_code: "1053",
        country: "HU",
      },
    },
    // A branded key, built here the way core builds one — this file cannot import a type.
    "checkout-019e-cart-attempt-1",
  );

  assert.equal(replayed, false);
  assert.equal(order.payment, null);
  assert.equal(calls[0].url, "https://webshop.example.com/v1/carts/019e-cart/checkout");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "checkout-019e-cart-attempt-1");
  assert.equal(calls[0].init.mode, undefined);
});

test("the public tier turns a 304 into notModified on this runtime", async () => {
  const catalog = createWebshopPublicClient({
    baseUrl: "https://webshop.example.com",
    apiKey: "wpk_YOUR_PUBLISHABLE_KEY_test0",
    fetch: async () => new Response(null, { status: 304, headers: { etag: '"v1"' } }),
  });

  const read = await catalog.listProducts({ limit: 1, ifNoneMatch: '"v1"' });
  assert.equal(read.notModified, true);
  assert.equal(read.etag, '"v1"');
});

test("the ./next subpath imports and runs with no framework installed", async () => {
  // The point of this case is the import itself: if the handler reached for `next` anywhere, this line
  // would throw — which is why this package declares no peer dependency.
  const { createWebshopWebhookHandler } = await import(
    pathToFileURL(path.join(here, "..", "dist", "next", "index.js")).href
  );

  const marked = [];
  const handler = createWebshopWebhookHandler({
    secret: "whsec_EXAMPLE_TEST_SECRET_0123456789",
    alreadyProcessed: async (id) => marked.includes(id),
    markProcessed: async (id) => void marked.push(id),
    onEvent: async () => {},
  });

  // An unsigned delivery, so this exercises the verification path without pinning a signature here —
  // the signed cases are the Vitest suite's.
  const answer = await handler(
    new Request("https://site.example.com/api/webhooks/webshop", { method: "POST", body: "{}" }),
  );

  assert.equal(answer.status, 401);
  assert.match(await answer.text(), /runtime = "nodejs"/);
  assert.deepEqual(marked, []);
});
