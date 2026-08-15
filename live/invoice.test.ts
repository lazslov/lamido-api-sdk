import { derivedIdempotencyKey } from "@lazslov/api-core";
import {
  type CreateInvoiceInput,
  createInvoiceClient,
  type InvoiceApiError,
  isoDate,
} from "@lazslov/invoice";
import { describe, expect, it } from "vitest";
import {
  allowWrites,
  failure,
  invoiceProviderConfigId,
  invoiceTarget,
  skipReason,
} from "./config.js";

/**
 * invoice-service, live.
 *
 * @remarks
 * **Nothing here issues a real invoice.** A successful create has side effects at szamlazz.hu or
 * Billingo and is reported to NAV — there is no undo but a storno, which is itself a real document. So
 * the create cases stop at the failures that happen **before** the provider is called, and in fact
 * before the idempotency key is reserved: a `provider_config_id` the client may not use is one, and it
 * proves the guard the SDK cannot check for itself, because only an operator can allow-list a config.
 *
 * The one case that can create a row is behind `LIVE_ALLOW_WRITES` **and** needs a provider sandbox
 * configured on the tenant; see `docs/live-testing.md`.
 */

describe.skipIf(!invoiceTarget.ready)("invoice-service live", () => {
  const client = () =>
    createInvoiceClient({
      baseUrl: invoiceTarget.baseUrl,
      apiKey: invoiceTarget.keys.client,
    });

  it("answers an unwrapped health body that reports the database separately", async () => {
    // One of the three documented envelope exceptions, and the reason core's ReadMode is explicit per
    // call: a shared unwrap(body.data) applied here returns undefined.
    const health = await client().getHealth();

    // `db` is the half a monitor must read. The route always answers 200 while the process is alive,
    // so an unreachable database arrives as `{ status: "degraded", db: "unreachable" }` at 200 — and
    // a check that stops at response.ok reports a healthy service over a dead database.
    expect(health.status).toBe("ok");
    expect(health.db).toBe("ok");
  });

  it("returns NO total on the invoice list, and pages by cursor", async () => {
    // The assertion that keeps the paginator honest. If this ever starts returning a total,
    // `InvoiceList` should gain the field — and if `next_cursor` ever goes missing, the pager
    // silently stops after one page.
    const page = await client().listInvoices({ limit: 1 });

    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect("total" in page).toBe(false);
    // Always present, `null` rather than absent, even on a list with nothing behind it.
    expect(page.nextCursor === null || typeof page.nextCursor === "string").toBe(true);
  });

  it("rejects an out-of-range limit rather than clamping it", async () => {
    const error = await failure<InvoiceApiError>(() => client().listInvoices({ limit: 500 }));

    expect(error.status).toBe(400);
    expect(error.type).toBe("validation");
  });

  it("refuses a provider_config_id the client is not allowed to use, before writing anything", async () => {
    // The guard order documented on `POST /v1/invoices` decides what this case can observe:
    //
    //   5. config allow-listed              → 403
    //   6. config-id prefix matches provider → 400 provider_config_mismatch
    //   8. reserve the key — from here on the key IS consumed
    //
    // Step 5 runs first, so an id that is not on the client's `allowed_provider_configs` never
    // reaches step 6. The prefix rule is therefore not observable here without an allow-listed id
    // carrying the other provider's prefix, which no tenant should be asked to hold. The SDK's half
    // of that rule is proved locally instead — see packages/invoice/test/validate.test.ts.
    //
    // What this case proves is the guard the SDK cannot check: only an operator can allow-list a
    // config, so the service's refusal is the only source of truth. The prefix here matches the
    // provider on purpose, so the body passes the SDK's own validation and the request really goes
    // out. The id names nothing, so the refusal lands at step 5 — before step 8, which is why the
    // idempotency key survives and this case can run again tomorrow.
    const body: CreateInvoiceInput = {
      provider: "billingo",
      provider_config_id: "billingo_sdk_live_unlisted_probe",
      partner: {
        name: "SDK Live Probe",
        address: { postal_code: "1011", city: "Budapest", address: "Fő utca 1" },
      },
      items: [{ name: "Probe", quantity: 1, net_unit_price_minor: "1", vat_rate: "27" }],
      issue_date: isoDate(new Date()),
    };

    const error = await failure<InvoiceApiError>(() =>
      client().createInvoice(body, derivedIdempotencyKey("sdk-live-probe-unlisted-config", 1)),
    );

    expect(error.status).toBe(403);
    expect(error.type).toBe("forbidden");
  });

  it("answers 404 for an invoice this key cannot see, and does not map it to null", async () => {
    // Non-existence and no-access are deliberately indistinguishable, which is why the SDK throws here
    // rather than returning null: a 404 on an id you hold means the wrong key, not absent data.
    const error = await failure<InvoiceApiError>(() =>
      client().getInvoice("00000000-0000-4000-8000-000000000000"),
    );

    expect(error.status).toBe(404);
    expect(error.type).toBe("not-found");
  });

  it.skipIf(!allowWrites || !invoiceProviderConfigId)(
    "reports a replayed create as 200 with the same row",
    async () => {
      // The sharpest edge in the service: a key is consumed on first use whatever the outcome. This is
      // the only case here that can create a row, and it may create a `failed` one if the provider
      // sandbox refuses — which is still a valid outcome for this assertion, because the key is spent
      // either way and that is the thing being proved.
      const configId = invoiceProviderConfigId as string;
      const key = derivedIdempotencyKey(`sdk-live-replay-${configId}`, 1);

      const body: CreateInvoiceInput = {
        provider: configId.startsWith("billingo_") ? "billingo" : "szamlazz",
        provider_config_id: configId,
        partner: {
          name: "SDK Live Probe",
          address: { postal_code: "1011", city: "Budapest", address: "Fő utca 1" },
        },
        items: [{ name: "Probe", quantity: 1, net_unit_price_minor: "1", vat_rate: "27" }],
        partner_ref: "sdk-live-probe",
      };

      // The first attempt may fail at the provider; the replay is what is under test.
      const first = await client()
        .createInvoice(body, key)
        .then((result) => result.invoice.public_id)
        .catch(() => null);

      const replay = await client().createInvoice(body, key);

      expect(replay.replayed).toBe(true);
      if (first !== null) expect(replay.invoice.public_id).toBe(first);
    },
  );
});

describe.skipIf(invoiceTarget.ready)("invoice-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(invoiceTarget)}`);
    expect(invoiceTarget.ready).toBe(false);
  });
});
