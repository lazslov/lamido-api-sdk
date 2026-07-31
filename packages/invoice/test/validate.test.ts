import { idempotencyKey } from "@lamido/api-core";
import { describe, expect, it } from "vitest";
import { isoDate } from "../src/dates.js";
import type { CreateInvoiceInput } from "../src/types.js";
import { createBody, fetchStub, invoiceClient } from "./stubs/fetch.js";

/**
 * The four things the service passes through to the provider rather than checking, checked here.
 *
 * @remarks
 * All four assertions are that the failure happens **before any request** — `stub.calls` stays empty —
 * because the whole value of these checks is not spending an idempotency key on a typo.
 */

const key = idempotencyKey("invoice-order-2026-0001-attempt-1");

/** Attempt a create with `overrides` merged in, and report what reached `fetch`. */
async function attempt(overrides: Partial<CreateInvoiceInput>) {
  const stub = fetchStub();
  const thrown = await invoiceClient(stub)
    .createInvoice({ ...createBody(), ...overrides } as CreateInvoiceInput, key)
    .then(() => null)
    .catch((error: unknown) => error as Error);
  return { thrown, calls: stub.calls };
}

describe("providerConfigId", () => {
  it("must start with the provider's prefix", async () => {
    const { thrown, calls } = await attempt({ providerConfigId: "szamlazz_acme" });
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown?.message).toMatch(/must start with "billingo_"/);
    expect(calls).toEqual([]);
  });

  it("rejects a dash and an upper-case letter, naming the rule", async () => {
    for (const bad of ["billingo-acme", "billingo_Acme"]) {
      const { thrown, calls } = await attempt({ providerConfigId: bad });
      expect(thrown?.message).toMatch(/\^\[a-z0-9_\]\+\$/);
      expect(calls).toEqual([]);
    }
  });

  it("rejects more than 64 characters", async () => {
    const { thrown } = await attempt({ providerConfigId: `billingo_${"a".repeat(60)}` });
    expect(thrown?.message).toMatch(/at most 64 characters/);
  });

  it("rejects an empty value", async () => {
    const { thrown } = await attempt({ providerConfigId: "" });
    expect(thrown?.message).toMatch(/non-empty string/);
  });

  it("accepts a well-formed id", async () => {
    const { thrown } = await attempt({ providerConfigId: "billingo_acme_2026" });
    expect(thrown).toBeNull();
  });
});

describe("vatRate", () => {
  it("rejects a percent sign, which the service forwards and the provider refuses", async () => {
    const { thrown, calls } = await attempt({
      items: [{ name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: "27%" }],
    });
    expect(thrown?.message).toMatch(/items\[0\]\.vatRate/);
    expect(calls).toEqual([]);
  });

  it("rejects a number, in the shape a JavaScript caller reaches it with", async () => {
    const { thrown } = await attempt({
      items: [
        { name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: 27 as unknown as string },
      ],
    });
    expect(thrown?.message).toMatch(/must be a string, not a number/);
  });

  it("rejects whitespace, a decimal point, a lower-case code and an empty value", async () => {
    for (const bad of [" 27", "27 ", "27.0", "aam", "", "-5"]) {
      const { thrown } = await attempt({
        items: [{ name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: bad }],
      });
      expect(thrown, `expected ${JSON.stringify(bad)} to be rejected`).toBeInstanceOf(TypeError);
    }
  });

  it("accepts every documented form, and a code the documentation does not enumerate", async () => {
    // A pattern rather than an allowlist: the docs say "other codes" pass through, and rejecting a
    // legitimate rate would be an SDK bug a consumer could not work around.
    for (const good of ["27", "18", "5", "0", "AAM", "TAM", "EU", "FAD"]) {
      const { thrown } = await attempt({
        items: [{ name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: good }],
      });
      expect(thrown, `expected ${JSON.stringify(good)} to be accepted`).toBeNull();
    }
  });

  it("names the line's index, because fieldErrors would only say `items`", async () => {
    const { thrown } = await attempt({
      items: [
        { name: "A", quantity: 1, netUnitPrice: 1, vatRate: "27" },
        { name: "B", quantity: 1, netUnitPrice: 1, vatRate: "27%" },
      ],
    });
    expect(thrown?.message).toMatch(/items\[1\]\.vatRate/);
  });
});

describe("items", () => {
  it("must contain at least one line", async () => {
    const { thrown, calls } = await attempt({
      items: [] as unknown as CreateInvoiceInput["items"],
    });
    expect(thrown?.message).toMatch(/at least one invoice line/);
    expect(calls).toEqual([]);
  });
});

describe("the date fields are re-checked at runtime", () => {
  it("rejects a bad date that was cast past the brand, naming the field", async () => {
    // The brand makes this a compile error; this is the JavaScript caller's path.
    const { thrown, calls } = await attempt({
      dueDate: "25/07/2026" as unknown as CreateInvoiceInput["dueDate"],
    });
    expect(thrown?.message).toMatch(/^dueDate: /);
    expect(calls).toEqual([]);
  });

  it("accepts dates built through isoDate", async () => {
    const { thrown } = await attempt({
      issueDate: isoDate("2026-07-25"),
      fulfillmentDate: isoDate("2026-07-25"),
      dueDate: isoDate("2026-08-02"),
    });
    expect(thrown).toBeNull();
  });
});
