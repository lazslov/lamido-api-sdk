/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/telemetry/test/node-baseline.mjs` after `pnpm build`.
 * Imports `dist/`, not `src/`, so what it proves is that the tarball a consumer installs
 * works on the runtime the tarball claims to support. Deliberately small: the envelope
 * shape and the platform globals the sink and channel need (`fetch`, `AbortSignal.timeout`,
 * `crypto.randomUUID`, `btoa`) — the behaviour itself is the Vitest suite's job.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier.
const { createTelemetry } = await import(
  pathToFileURL(path.join(here, "..", "dist", "index.js")).href
);

test("the platform globals the SDK is built on exist on this runtime", () => {
  assert.equal(typeof fetch, "function");
  assert.equal(typeof AbortSignal.timeout, "function");
  assert.equal(typeof crypto.randomUUID, "function");
  assert.equal(typeof btoa, "function");
});

test("a logger writes one JSON line carrying the OB-2 envelope", () => {
  const telemetry = createTelemetry({
    service: "baseline-service",
    env: "development",
    level: () => "info",
  });
  const written = [];
  const original = console.log;
  console.log = (line) => written.push(line);
  try {
    telemetry.logger.info("baseline", { probe: true });
  } finally {
    console.log = original;
  }
  assert.equal(written.length, 1);
  const line = JSON.parse(written[0]);
  assert.equal(line.service, "baseline-service");
  assert.equal(line.env, "development");
  assert.equal(line.level, "info");
  assert.equal(line.message, "baseline");
  assert.equal(line.probe, true);
  assert.match(line.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
