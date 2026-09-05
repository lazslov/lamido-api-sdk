import { type CursorPage, idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import type { components } from "../src/generated/schema.js";
import type { KnownOrderStatus, OrderStatus } from "../src/status.js";
import type {
  AddCartItemInput,
  CartLine,
  CheckoutInput,
  Order,
  SetCartItemQuantityInput,
} from "../src/types.js";
import {
  cart,
  checkoutBody,
  checkoutOrder,
  fetchStub,
  jsonResponse,
  listResponse,
  order,
  product,
  publicClient,
  webshopClient,
} from "./stubs/fetch.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The runtime bodies exist so the file is also a
 * readable list of what the types forbid.
 *
 * The directive applies to the **following line**, so these calls are kept short enough that the
 * formatter cannot wrap them out from under it.
 */

describe("a checkout cannot happen without an idempotency key", () => {
  const client = webshopClient(fetchStub([jsonResponse(checkoutOrder(), 201)]));

  it("has no checkout overload without one", () => {
    // @ts-expect-error — the key is the third argument and there is no overload lacking it.
    const call = () => client.checkout("019e", checkoutBody());
    expect(typeof call).toBe("function");
  });

  it("rejects a raw string as a key", () => {
    // @ts-expect-error — IdempotencyKey is branded: it must go through idempotencyKey().
    const call = () => client.checkout("019e", checkoutBody(), "checkout-1");
    expect(typeof call).toBe("function");
  });

  it("accepts a validated key", () => {
    expect(typeof idempotencyKey("checkout-019e-attempt-1")).toBe("string");
  });
});

describe("a line quantity is a number, unlike money and stock", () => {
  it("rejects a string quantity on an add", () => {
    // @ts-expect-error — the one count on this service that is a JSON number.
    const bad = { variant_id: "019e", quantity: "2" } satisfies AddCartItemInput;
    expect(bad.quantity).toBe("2");
  });

  it("rejects a string quantity on a set", () => {
    // @ts-expect-error — same rule on the absolute set.
    const bad = { quantity: "5" } satisfies SetCartItemQuantityInput;
    expect(bad.quantity).toBe("5");
  });
});

describe("the checkout input", () => {
  it("accepts a null billing address, which means the same as shipping", () => {
    const input: CheckoutInput = { ...checkoutBody(), billing_address: null };
    expect(input.billing_address).toBeNull();
  });

  it("still matches the generated contract's field names", () => {
    // The input is hand-written because the contract's `billing_address` collapses to a non-null
    // Address through an allOf artefact. This is what keeps it honest: a renamed or retyped field on
    // the wire fails the type-check here.
    const input: CheckoutInput = checkoutBody();
    const wire = {
      ...input,
      billing_address: input.shipping_address,
    } satisfies components["schemas"]["CheckoutRequest"];
    expect(wire.guest_email).toBe("ada@example.com");
  });
});

describe("a cart line is spelled the way the service spells it now", () => {
  it("has variant_name and the three product members, and no name", () => {
    const line: CartLine = cart().items[0] as CartLine;
    expect(line.variant_name).toBe("1 kg whole bean");
    expect(line.product_name).toBe("Espresso Beans");
    // @ts-expect-error — `name` was renamed `variant_name`; a storefront reading it gets undefined.
    const wrong = line.name;
    expect(wrong).toBeUndefined();
  });
});

describe("an order", () => {
  it("accepts a null billing address", () => {
    const read: Order = order() as Order;
    expect(read.billing_address).toBeNull();
  });

  it("carries a status this SDK has never heard of, because the reachable set is not hard-coded", () => {
    const unknown: OrderStatus = "shipped";
    expect(unknown).toBe("shipped");
    // @ts-expect-error — the filter takes the closed set, where an unknown value is a 400.
    const filter: KnownOrderStatus = "shipped";
    expect(filter).toBe("shipped");
  });
});

describe("a list carries no total", () => {
  it("is a compile error to read one", () => {
    const list: CursorPage<Order> = { items: [], nextCursor: null };
    // @ts-expect-error — nothing on this service counts rows.
    const pages = list.total;
    expect(pages).toBeUndefined();
  });
});

describe("the public catalog's conditional read", () => {
  it("answers a value directly when no validator was sent", async () => {
    const catalog = publicClient(fetchStub([listResponse([product()])]));
    const fresh = await catalog.listProducts({ limit: 1 });
    // No narrowing needed: without `ifNoneMatch` a 304 cannot arrive.
    expect(fresh.value.items).toHaveLength(1);
  });

  it("must be narrowed when a validator was sent", async () => {
    const catalog = publicClient(fetchStub([listResponse([product()])]));
    const read = await catalog.listProducts({ limit: 1, ifNoneMatch: '"x"' });
    // @ts-expect-error — a 304 is possible here, so `value` exists only after narrowing.
    const items = read.value;
    expect(items).toBeDefined();
    if (!read.notModified) expect(read.value.items).toHaveLength(1);
  });
});
