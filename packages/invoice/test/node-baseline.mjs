/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/invoice/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: the CI leg that runs on the floor (Node 20.19)
 * installs nothing at all, because pnpm 11 refuses to start below Node 22.13 — so `node:test`, which
 * ships with the runtime, is the only runner available there. It also imports `dist/` rather than
 * `src/`, so what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: the date type, one create carrying its key, and the storno the cancel returns.
 * The behaviour itself is the Vitest suites' job.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const { createInvoiceClient, isoDate, InvoiceNotDownloadableError } = await import(
  pathToFileURL(path.join(here, "..", "dist", "index.js")).href
);

const baseUrl = "https://invoice.example.com";
const apiKey = "isk_YOUR_CLIENT_KEY_test0000";

/** A client answering from `respond`, plus the log of what reached fetch. */
function client(respond) {
  const calls = [];
  return {
    calls,
    invoices: createInvoiceClient({
      baseUrl,
      apiKey,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return respond(calls.length);
      },
    }),
  };
}

/** A resource response. A single resource is the resource, unwrapped. */
function data(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const created = {
  public_id: "0199e4a9-13f2-7c14-9d5e-2a6b8c0d1f33",
  provider: "billingo",
  provider_config_id: "billingo_acme",
  status: "created",
  invoice_number: "2026/0042",
  gross_amount_minor: "38100",
  currency: "HUF",
  created_at: "2026-07-25T09:14:03.221Z",
  updated_at: "2026-07-25T09:14:05.882Z",
};

const body = {
  provider: "billingo",
  provider_config_id: "billingo_acme",
  partner: {
    name: "Teszt Vevő Kft",
    address: { postal_code: "1011", city: "Budapest", address: "Fő utca 1" },
  },
  items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: "15000", vat_rate: "27" }],
};

test("isoDate rejects what the provider would reject", () => {
  assert.equal(isoDate("2026-07-25"), "2026-07-25");
  for (const bad of ["2026-13-45", "25/07/2026", "2026-02-30", "2026-7-25", ""]) {
    assert.throws(() => isoDate(bad), TypeError, `expected ${JSON.stringify(bad)} to throw`);
  }
});

test("a create carries its idempotency key, and reports 201 as not replayed", async () => {
  const { invoices, calls } = client(() => data(created, 201));
  // A branded key, built here the way core builds one — this file cannot import a type.
  const result = await invoices.createInvoice(body, "invoice-order-2026-0001-attempt-1");

  assert.equal(result.replayed, false);
  assert.equal(result.invoice.gross_amount_minor, "38100");
  assert.equal(calls[0].url, `${baseUrl}/v1/invoices`);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "invoice-order-2026-0001-attempt-1");
  assert.equal(calls[0].init.mode, undefined);
});

test("a 200 is a replay, whatever the invoice's status", async () => {
  const { invoices } = client(() => data({ ...created, status: "failed" }, 200));
  const result = await invoices.createInvoice(body, "invoice-order-2026-0001-attempt-1");

  assert.equal(result.replayed, true);
  assert.equal(result.invoice.status, "failed");
});

test("outbound validation runs before any request", async () => {
  const { invoices, calls } = client(() => data(created, 201));
  await assert.rejects(
    () => invoices.createInvoice({ ...body, provider_config_id: "szamlazz_acme" }, "k-attempt-1"),
    TypeError,
  );
  assert.equal(calls.length, 0);
});

test("storno_number arrives on the cancel, and the health body is not unwrapped", async () => {
  const { invoices } = client((call) =>
    call === 1
      ? data({ ...created, status: "canceled", storno_number: "2026/0043" })
      : new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
  );

  const cancelled = await invoices.cancelInvoice(created.public_id);
  assert.equal(cancelled.storno_number, "2026/0043");
  assert.deepEqual(await invoices.getHealth(), { status: "ok" });
});

test("a cancelled invoice's PDF is a named error", async () => {
  const { invoices } = client(
    () =>
      new Response(
        JSON.stringify({
          type: "urn:invoice-service:problem:conflict",
          title: "Unprocessable Entity",
          status: 422,
          detail: "Invoice is not in a downloadable state",
          instance: "/v1/invoices/x/pdf",
          code: "not_downloadable",
        }),
        { status: 422, headers: { "content-type": "application/problem+json" } },
      ),
  );

  await assert.rejects(
    () => invoices.getInvoicePdf(created.public_id),
    InvoiceNotDownloadableError,
  );
});
