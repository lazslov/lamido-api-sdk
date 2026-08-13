/**
 * `POST /v1/invoices` — the sharpest edge in this service.
 *
 * @remarks
 * One endpoint, one method, and the whole reason this package is opinionated. An idempotency key here
 * is **consumed on first use whatever the outcome**, which inverts the habit payment-service teaches.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import { callWithMeta, passInit, type RequestOptions } from "./call.js";
import type { CreateInvoiceInput, CreateInvoiceResult, Invoice } from "./types.js";
import { assertCreatable } from "./validate.js";

/** The create half of a client. */
export interface CreateMethods {
  /**
   * Issue a real invoice at szamlazz.hu or Billingo.
   *
   * @param body - Provider, credential id, buyer and lines. Dates are {@link ./dates.js | IsoDate}.
   * @param key - **Required.** Derive it from the business event, never from the clock:
   * `derivedIdempotencyKey(`invoice-${orderId}`, 1)`, not `crypto.randomUUID()`. A random key per
   * attempt removes the protection entirely and will double-invoice.
   * @param options - `init` only.
   * @returns The invoice, and whether this call issued it.
   * @throws `TypeError` **before any request**, for a `provider_config_id` that breaks the prefix or
   * character rule, an empty `items`, a bad `vatRate`, or a date that is not a real `YYYY-MM-DD` day.
   * The service does not check those four and the provider rejects them as a `502` — by which point
   * the key is spent.
   * @throws {@link ./errors.js | InvoiceApiError} for anything the service refuses. Read `advice`
   * before retrying: on a `500` or `502` the row is already written as `failed` and **the same key
   * will never succeed again**. On a `400`, `401` or `403` raised before the row is inserted the key
   * is *not* consumed, and the same key can be resent once the request is fixed.
   * @remarks
   * There is no overload without a key, and this is the only endpoint that takes one.
   *
   * The result's `replayed` comes from the status code, which client-api §1 says is what to branch on:
   * `201` issued something, `200` returned a stored row unchanged without calling the provider. A
   * replay can be in **any** status — including `failed`, which is the case worth handling, because it
   * looks like a transient failure and is not one.
   *
   * There is no webhook and no callback: *the service never calls you*. Poll `getInvoice` if you need
   * confirmation, and **persist the returned `id` immediately** — it is the only handle for the PDF,
   * the cancel and a support lookup.
   *
   * @example
   * ```ts
   * const { invoice, replayed } = await invoices.createInvoice(
   *   {
   *     provider: "billingo",
   *     provider_config_id: "billingo_acme",
   *     partner: {
   *       name: "Teszt Vevő Kft",
   *       taxNumber: "12345678-2-42",
   *       address: { postalCode: "1011", city: "Budapest", address: "Fő utca 1" },
   *     },
   *     items: [{ name: "Tanácsadás", quantity: 2, unit: "óra", net_unit_price_minor: "15000", vat_rate: "27" }],
   *     partnerRef: order.id,
   *   },
   *   derivedIdempotencyKey(`invoice-${order.id}`, 1),
   * );
   *
   * if (!replayed) await store(order.id, invoice.id);
   * // A replay that came back failed needs attempt 2 — a NEW key, not another try with this one.
   * ```
   */
  createInvoice(
    body: CreateInvoiceInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<CreateInvoiceResult>;
}

/**
 * Bind the create method to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCreateMethod(cfg: ResolvedConfig): CreateMethods {
  return {
    async createInvoice(body, key, options = {}) {
      // Before anything leaves: the four rules the service forwards rather than enforces.
      assertCreatable(body);

      const answer = await callWithMeta<Invoice>(cfg, {
        method: "POST",
        path: "/v1/invoices",
        // Passed through as given. Unknown fields are silently stripped by the service, so a
        // helpful tidy-up here would hide a typo rather than surface it.
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });

      // The status is the contract: 201 issued, 200 replayed. Never the body.
      return { invoice: answer.value, replayed: answer.status === 200 };
    },
  };
}
