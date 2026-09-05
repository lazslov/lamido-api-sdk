import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { WebshopApiError } from "../src/errors.js";
import {
  cart,
  checkoutBody,
  checkoutOrder,
  fetchStub,
  identity,
  jsonResponse,
  listResponse,
  order,
  problemResponse,
  product,
  shippingOption,
  testBaseUrl,
  testSecretKey,
  webshopClient,
} from "./stubs/fetch.js";

const cartId = "0191f3c4-8b21-7c4e-9a55-2f6b0d3e91aa";
const itemId = "0191f3c4-9f10-7a02-8d31-1b5e2c7f04aa";
const orderId = "0191f3d0-1122-7a33-b4c5-6d7e8f901234";
const key = idempotencyKey(`checkout-${cartId}-attempt-1`);
const internal = "urn:webshop-service:problem:internal";

/**
 * Run a call that must fail, and return the error it threw.
 *
 * @throws When the call **succeeds**, which is what makes these cases real: a bare
 * `.catch((error) => error as WebshopApiError)` types the result as the union of the error and the
 * resolved value, so reading `advice` off it does not compile — and casting the union away would
 * make a `200` compare `undefined` against `undefined` and pass.
 */
async function failed(call: () => Promise<unknown>): Promise<WebshopApiError> {
  try {
    await call();
  } catch (error) {
    return error as WebshopApiError;
  }
  throw new Error("expected this request to fail, but the stub accepted it");
}

describe("getMe", () => {
  it("reads the shop and key behind the credential", async () => {
    const stub = fetchStub([jsonResponse(identity())]);
    const me = await webshopClient(stub).getMe();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/me`);
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testSecretKey}`);
    expect(me.shop.currency).toBe("HUF");
  });
});

describe("the storefront catalog", () => {
  it("lists products into a cursor page", async () => {
    const stub = fetchStub([listResponse([product()], "opaque-cursor")]);
    const page = await webshopClient(stub).listProducts({ limit: 24 });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/products?limit=24`);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("opaque-cursor");
  });

  it("passes a cursor back verbatim", async () => {
    const stub = fetchStub([listResponse([])]);
    await webshopClient(stub).listProducts({ cursor: "MjAyNi0wOC0xMHwwMTkx" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/products?cursor=MjAyNi0wOC0xMHwwMTkx`);
  });

  it("reads one product by slug, encoding the segment", async () => {
    const stub = fetchStub([jsonResponse(product())]);
    const found = await webshopClient(stub).getProduct("espresso beans");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/products/espresso%20beans`);
    expect(found?.slug).toBe("espresso_beans");
  });

  it("maps the documented 404 to null, and only that status", async () => {
    // A draft, an archived product or a slug a crawler invented is the normal state of a product route.
    const missing = fetchStub([problemResponse(404, "urn:webshop-service:problem:not-found")]);
    await expect(webshopClient(missing).getProduct("no-such-slug")).resolves.toBeNull();

    const refused = fetchStub([problemResponse(401, "urn:webshop-service:problem:unauthorized")]);
    await expect(webshopClient(refused).getProduct("espresso_beans")).rejects.toBeInstanceOf(
      WebshopApiError,
    );
  });
});

describe("carts", () => {
  it("creates a guest cart with an empty body when nothing is given", async () => {
    // `{}` rather than no body: the service reads a JSON body, and `currency` is not a field.
    const stub = fetchStub([jsonResponse(cart({ items: [] }), 201)]);
    await webshopClient(stub).createCart();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/carts`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.lastBody()).toEqual({});
  });

  it("creates a cart with the caller's own labels", async () => {
    const stub = fetchStub([jsonResponse(cart(), 201)]);
    await webshopClient(stub).createCart({ customer_id: null, session_id: "sess_7f3a91" });
    expect(stub.lastBody()).toEqual({ customer_id: null, session_id: "sess_7f3a91" });
  });

  it("reads a cart, and throws on a 404 naming the wrong-shop possibility", async () => {
    const stub = fetchStub([jsonResponse(cart())]);
    const priced = await webshopClient(stub).getCart(cartId);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}`);
    expect(priced.has_unavailable_items).toBe(false);

    const missing = fetchStub([problemResponse(404, "urn:webshop-service:problem:not-found")]);
    const caught = await webshopClient(missing)
      .getCart(cartId)
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WebshopApiError);
    expect((caught as WebshopApiError).message).toMatch(/WEBSHOP_SECRET_KEY/);
  });

  it("adds a variant with a numeric quantity", async () => {
    const stub = fetchStub([jsonResponse(cart())]);
    await webshopClient(stub).addCartItem(cartId, {
      variant_id: "0191f3b2-2e01-7f14-9b63-4a2d7e0c8f31",
      quantity: 2,
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}/items`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    // A line quantity IS a JSON number — the one count on this service that is.
    expect(stub.lastBodyText()).toContain('"quantity":2');
  });

  it("sets a line's quantity with a PATCH", async () => {
    const stub = fetchStub([jsonResponse(cart())]);
    await webshopClient(stub).setCartItemQuantity(cartId, itemId, { quantity: 5 });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}/items/${itemId}`);
    expect(stub.calls.at(-1)?.init.method).toBe("PATCH");
    expect(stub.lastBody()).toEqual({ quantity: 5 });
  });

  it("removes a line with a bodiless DELETE and reads the recalculated cart back", async () => {
    const stub = fetchStub([jsonResponse(cart({ items: [] }))]);
    const priced = await webshopClient(stub).removeCartItem(cartId, itemId);

    expect(stub.calls.at(-1)?.init.method).toBe("DELETE");
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
    expect(stub.lastHeaders()).not.toHaveProperty("content-type");
    expect(priced.items).toEqual([]);
  });

  it("applies and removes a coupon", async () => {
    const applied = fetchStub([jsonResponse(cart())]);
    await webshopClient(applied).applyCoupon(cartId, { code: "summer10" });
    expect(applied.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}/coupon`);
    expect(applied.calls.at(-1)?.init.method).toBe("POST");
    // Sent as typed: the service upper-cases it, and a helpful local normalisation would be a second
    // place the rule lives.
    expect(applied.lastBody()).toEqual({ code: "summer10" });

    const removed = fetchStub([jsonResponse(cart({ coupon_code: null, coupon_applied: false }))]);
    await webshopClient(removed).removeCoupon(cartId);
    expect(removed.calls.at(-1)?.init.method).toBe("DELETE");
    expect(removed.calls.at(-1)?.init.body).toBeUndefined();
  });

  it("surfaces a refused coupon with its code", async () => {
    const stub = fetchStub([
      problemResponse(422, "urn:webshop-service:problem:conflict", {
        code: "coupon_minimum_not_met",
      }),
    ]);
    await expect(
      webshopClient(stub).applyCoupon(cartId, { code: "SUMMER10" }),
    ).rejects.toMatchObject({ code: "coupon_minimum_not_met", retryable: true });
  });

  it("lists shipping options through the cart as a cursor page", async () => {
    const stub = fetchStub([listResponse([shippingOption()])]);
    const page = await webshopClient(stub).listShippingOptions(cartId, { limit: 10 });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}/shipping-options?limit=10`);
    expect(page.items[0]?.price).toBe("1490");
    expect(page.nextCursor).toBeNull();
  });

  it("chooses carriage with a PUT, and clears it with an explicit null", async () => {
    const chosen = fetchStub([jsonResponse(cart())]);
    await webshopClient(chosen).setShippingMethod(cartId, {
      shipping_method_id: "0191f3b8-5d02-7e11-9c40-7a2b1e0d5f83",
    });
    expect(chosen.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}/shipping-method`);
    expect(chosen.calls.at(-1)?.init.method).toBe("PUT");

    // The key must be PRESENT; null is the value. A body of `{}` would be a 400.
    const cleared = fetchStub([jsonResponse(cart({ shipping_method_id: null }))]);
    await webshopClient(cleared).setShippingMethod(cartId, { shipping_method_id: null });
    expect(cleared.lastBodyText()).toBe('{"shipping_method_id":null}');
  });
});

describe("checkout", () => {
  it("posts the body with the idempotency key as a header", async () => {
    const stub = fetchStub([jsonResponse(checkoutOrder(), 201)]);
    await webshopClient(stub).checkout(cartId, checkoutBody(), key);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/carts/${cartId}/checkout`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe(`checkout-${cartId}-attempt-1`);
    expect(stub.lastBody()).toEqual(checkoutBody());
  });

  it("returns the order with its payment block", async () => {
    const stub = fetchStub([jsonResponse(checkoutOrder(), 201)]);
    const { order: created } = await webshopClient(stub).checkout(cartId, checkoutBody(), key);

    expect(created.status).toBe("pending");
    expect(created.payment?.gateway_url).toBe("https://pay.example.com/s/0191f4d29a44");
    expect(created.payment_ref).toBe(created.payment?.public_id);
  });

  it("passes a null payment through, which means do not redirect", async () => {
    // The shop holds no payment credential. The order still committed and holds stock.
    const stub = fetchStub([
      jsonResponse(checkoutOrder({ payment: null, payment_ref: null }), 201),
    ]);
    const { order: created } = await webshopClient(stub).checkout(cartId, checkoutBody(), key);
    expect(created.payment).toBeNull();
  });

  it("reports replayed from the header alone, because a replay is a 201 like a fresh checkout", async () => {
    const fresh = fetchStub([jsonResponse(checkoutOrder(), 201)]);
    expect((await webshopClient(fresh).checkout(cartId, checkoutBody(), key)).replayed).toBe(false);

    const replayed = fetchStub([
      jsonResponse(checkoutOrder(), 201, { "idempotent-replay": "true" }),
    ]);
    expect((await webshopClient(replayed).checkout(cartId, checkoutBody(), key)).replayed).toBe(
      true,
    );
  });

  it("does not normalise the body — a byte-different body under the same key is a 409", async () => {
    const stub = fetchStub([jsonResponse(checkoutOrder(), 201)]);
    await webshopClient(stub).checkout(
      cartId,
      { ...checkoutBody(), billing_address: null, customer_id: null },
      key,
    );
    // Key order and explicit nulls survive exactly as given.
    expect(stub.lastBodyText()).toBe(
      '{"guest_email":"ada@example.com","shipping_address":{"name":"Ada Lovelace","line1":"Kossuth Lajos utca 12","city":"Budapest","postal_code":"1053","country":"HU"},"billing_address":null,"customer_id":null}',
    );
  });

  it("marks a 502 payment_create_unknown retryable with the resume rule", async () => {
    // The order committed before the payment step. A payment may or may not exist; the SAME key resumes.
    const stub = fetchStub([
      problemResponse(502, internal, { provider_error: "payment_create_unknown" }),
    ]);
    const caught = await failed(() => webshopClient(stub).checkout(cartId, checkoutBody(), key));

    expect(caught).toMatchObject({ providerError: "payment_create_unknown", retryable: true });
    expect(caught.advice).toMatch(/SAME Idempotency-Key/);
    expect(caught.advice).toMatch(/Do not start a new cart/);
  });

  it("marks a 502 payment_create_rejected not retryable, and still names the committed order", async () => {
    const stub = fetchStub([
      problemResponse(502, internal, { provider_error: "payment_create_rejected" }),
    ]);
    const caught = await failed(() => webshopClient(stub).checkout(cartId, checkoutBody(), key));

    expect(caught).toMatchObject({ providerError: "payment_create_rejected", retryable: false });
    expect(caught.advice).toMatch(/payment credential/);
    expect(caught.advice).toMatch(/holding stock/);
  });

  it("marks a 429 from the payment throttle as a resume, not a fresh attempt", async () => {
    const stub = fetchStub([
      problemResponse(429, "urn:webshop-service:problem:rate-limit", { retry_after: 37 }),
    ]);
    const caught = await failed(() => webshopClient(stub).checkout(cartId, checkoutBody(), key));

    expect(caught).toMatchObject({ status: 429, retryAfter: 37, retryable: true });
    expect(caught.advice).toMatch(/committed/);
    expect(caught.advice).toMatch(/SAME Idempotency-Key/);
  });

  it("surfaces an in-flight lease as retryable and a reused key as not", async () => {
    const conflict = "urn:webshop-service:problem:conflict";
    const inFlight = fetchStub([problemResponse(409, conflict, { code: "idempotency_in_flight" })]);
    await expect(
      webshopClient(inFlight).checkout(cartId, checkoutBody(), key),
    ).rejects.toMatchObject({ code: "idempotency_in_flight", retryable: true });

    const reused = fetchStub([problemResponse(409, conflict, { code: "idempotency_key_reused" })]);
    await expect(webshopClient(reused).checkout(cartId, checkoutBody(), key)).rejects.toMatchObject(
      {
        code: "idempotency_key_reused",
        retryable: false,
      },
    );
  });

  it("passes a caller's init through, and sets no fetch mode", async () => {
    const controller = new AbortController();
    const stub = fetchStub([jsonResponse(checkoutOrder(), 201)]);
    await webshopClient(stub).checkout(cartId, checkoutBody(), key, {
      init: { signal: controller.signal },
    });

    expect(stub.calls.at(-1)?.init.signal).toBe(controller.signal);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });
});

describe("orders", () => {
  it("lists orders with every filter passed through untouched", async () => {
    const stub = fetchStub([listResponse([order()])]);
    const page = await webshopClient(stub).listOrders({
      limit: 20,
      status: "pending",
      from: "2026-08-01",
      until: "2026-09-01T00:00:00Z",
    });

    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/orders?limit=20&status=pending&from=2026-08-01&until=2026-09-01T00%3A00%3A00Z`,
    );
    expect(page.items[0]?.public_id).toBe(orderId);
    expect(page.nextCursor).toBeNull();
  });

  it("sends no query when nothing was asked for", async () => {
    const stub = fetchStub([listResponse([])]);
    await webshopClient(stub).listOrders();
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/orders`);
  });

  it("reads one order, which carries payment_ref and no payment block", async () => {
    const stub = fetchStub([jsonResponse(order({ payment_ref: "0191f4d2-9a44" }))]);
    const found = await webshopClient(stub).getOrder(orderId);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/orders/${orderId}`);
    expect(found.payment_ref).toBe("0191f4d2-9a44");
    expect(found).not.toHaveProperty("payment");
  });

  it("throws on a 404 rather than answering null", async () => {
    const stub = fetchStub([problemResponse(404, "urn:webshop-service:problem:not-found")]);
    await expect(webshopClient(stub).getOrder(orderId)).rejects.toBeInstanceOf(WebshopApiError);
  });

  it("cancels with a bodiless POST", async () => {
    const stub = fetchStub([jsonResponse(order({ status: "canceled" }))]);
    const canceled = await webshopClient(stub).cancelOrder(orderId);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/orders/${orderId}/cancel`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
    expect(canceled.status).toBe("canceled");
  });

  it("surfaces a terminal order as not retryable", async () => {
    const stub = fetchStub([
      problemResponse(422, "urn:webshop-service:problem:conflict", { code: "order_terminal" }),
    ]);
    await expect(webshopClient(stub).cancelOrder(orderId)).rejects.toMatchObject({
      code: "order_terminal",
      retryable: false,
    });
  });
});
