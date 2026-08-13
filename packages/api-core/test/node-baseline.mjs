/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/api-core/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: the CI leg that runs on the floor (Node
 * 20.19) installs nothing at all, because pnpm 11 refuses to start below Node 22.13 — so
 * `node:test`, which ships with the runtime, is the only runner available there. It also imports
 * `dist/` rather than `src/`, so what it proves is that the tarball a consumer installs works on
 * the runtime the tarball claims to support.
 *
 * Deliberately small: it covers the two things most likely to break on an older runtime —
 * Web Crypto availability, and `fetch` — not the behaviour the Vitest suites already cover.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier.
const { LamidoApiError, request, resolveConfig, verifySignedBody } = await import(
  pathToFileURL(path.join(here, "..", "dist", "index.js")).href
);

test("globalThis.crypto.subtle exists on this runtime", () => {
  assert.ok(globalThis.crypto?.subtle, "Web Crypto is required and must be a global");
});

test("verifySignedBody accepts every pinned valid fixture", async () => {
  const fixturesDir = path.join(here, "fixtures", "hmac");
  const fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")));

  assert.ok(fixtures.length > 0, "expected pinned fixtures to be present");

  for (const fixture of fixtures) {
    const verdict = await verifySignedBody({
      secret: fixture.secret,
      rawBody: fixture.rawBody,
      signature: fixture.signature,
      timestamp: fixture.timestamp,
      nowSeconds: fixture.nowSeconds,
    });
    assert.deepEqual(verdict, fixture.expect, `${fixture.name}: ${fixture.describes}`);
  }
});

test("the digest agrees with node:crypto on this runtime", async () => {
  // An independent implementation, so a UTF-8 or key-import difference on an older Node
  // would surface here rather than in production.
  const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";
  const rawBody = JSON.stringify({ buyer: "Árvíztűrő Tükörfúrógép Kft." });
  const timestamp = "1770000000";
  const expected = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;

  const verdict = await verifySignedBody({
    secret,
    rawBody,
    signature: expected,
    timestamp,
    nowSeconds: Number(timestamp),
  });
  assert.deepEqual(verdict, { ok: true });
});

test("request reaches a stub fetch and reads a data envelope", async () => {
  const calls = [];
  const config = resolveConfig({
    serviceName: "content-service",
    env: { baseUrl: "TEST_BASE_URL", apiKey: "TEST_API_KEY" },
    config: {
      baseUrl: "https://content.example.com",
      apiKey: "csk_YOUR_TEST_KEY_abcdef123456",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ slug: "about" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });

  const page = await request(config, {
    method: "GET",
    path: "/v1/public/pages/about",
    read: { kind: "raw" },
    onError: () => new Error("unreachable"),
  });

  assert.deepEqual(page, { slug: "about" });
  assert.equal(calls[0].url, "https://content.example.com/v1/public/pages/about");
  assert.equal(calls[0].init.headers.Authorization, "Bearer csk_YOUR_TEST_KEY_abcdef123456");
});

test("a non-2xx response routes through the supplied error parser", async () => {
  const config = resolveConfig({
    serviceName: "content-service",
    env: { baseUrl: "TEST_BASE_URL", apiKey: "TEST_API_KEY" },
    config: {
      baseUrl: "https://content.example.com",
      apiKey: "csk_YOUR_TEST_KEY_abcdef123456",
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: "page_not_found" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    },
  });

  await assert.rejects(
    request(config, {
      method: "GET",
      path: "/api/content/pages/nope",
      read: { kind: "data" },
      onError: (context) =>
        new LamidoApiError({
          service: "content-service",
          status: context.status,
          code: context.body.error.code,
          message: "not found",
          requestPath: context.requestPath,
          retryable: false,
        }),
    }),
    (error) => error instanceof LamidoApiError && error.status === 404,
  );
});
