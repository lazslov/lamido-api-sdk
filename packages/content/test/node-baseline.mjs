/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/content/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: Vitest 4 requires Node ^20.19 || >=22.12, so it
 * cannot run on Node 18.17 — the floor this package declares in `engines`. This file uses only
 * `node:test` and `node:assert`, available since Node 18, and it imports `dist/` rather than `src/`,
 * so what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: both entry points resolve, the webhook verifier works on this runtime's Web
 * Crypto, and one read goes out and comes back. The behaviour itself is the Vitest suites' job.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const dist = (entry) => pathToFileURL(path.join(here, "..", "dist", entry)).href;

const { createWebsiteClient, tryCreateContentClient, verifyRevalidationWebhook } = await import(
  dist("index.js")
);
const { asText, isValidContentUrl, prepareValues } = await import(dist("fields/index.js"));

test("the fields entry point resolves on its own, without the main entry", () => {
  // What makes it safe in a client component: no transport, no credential handling.
  assert.equal(asText({ title: "" }, "title"), "");
  assert.equal(isValidContentUrl("/rolunk"), true);
  assert.deepEqual(
    prepareValues(
      {
        key: "about",
        label: "About",
        summary: "",
        previewHref: "/",
        fields: [{ key: "title", label: "Heading", type: "text" }],
      },
      { title: "New" },
      { title: "Old" },
    ),
    { ok: true, values: { "about.title": "New" } },
  );
});

test("verifyRevalidationWebhook accepts every pinned valid fixture", async () => {
  const fixturesDir = path.join(here, "fixtures", "revalidation");
  const fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")));

  assert.ok(fixtures.length > 0, "expected pinned fixtures to be present");

  for (const fixture of fixtures) {
    const headers = new Headers();
    if (fixture.signature !== null) headers.set("X-Content-Signature", fixture.signature);
    if (fixture.timestamp !== null) headers.set("X-Content-Timestamp", fixture.timestamp);

    const verdict = await verifyRevalidationWebhook({
      secret: fixture.secret,
      rawBody: fixture.rawBody,
      headers,
      nowSeconds: fixture.nowSeconds,
    });
    assert.deepEqual(verdict, fixture.expect, `${fixture.name}: ${fixture.describes}`);
  }
});

test("a website read reaches fetch and degrades a 404 to null", async () => {
  const calls = [];
  const client = createWebsiteClient({
    baseUrl: "https://content.example.com",
    apiKey: "cpk_YOUR_PUBLISHABLE_KEY_test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { code: "not_found", message: "nope" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(await client.getPage("unpublished"), null);
  assert.equal(calls[0].url, "https://content.example.com/api/content/pages/unpublished");
  assert.equal(calls[0].init.headers.Authorization, "Bearer cpk_YOUR_PUBLISHABLE_KEY_test");
});

test("a site with no configuration still boots", () => {
  const saved = {
    baseUrl: process.env.CONTENT_SERVICE_BASE_URL,
    secretKey: process.env.CONTENT_SERVICE_SECRET_KEY,
  };
  delete process.env.CONTENT_SERVICE_BASE_URL;
  delete process.env.CONTENT_SERVICE_SECRET_KEY;
  try {
    assert.equal(tryCreateContentClient(), null);
  } finally {
    if (saved.baseUrl !== undefined) process.env.CONTENT_SERVICE_BASE_URL = saved.baseUrl;
    if (saved.secretKey !== undefined) process.env.CONTENT_SERVICE_SECRET_KEY = saved.secretKey;
  }
});
