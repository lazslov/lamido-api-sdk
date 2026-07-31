/**
 * Named aliases over the generated contract, and the request shapes the money type narrows.
 *
 * @remarks
 * Wire names are kept exactly as the service spells them — `amount_minor`, `merchant_payment_ref`,
 * `public_id`. The SDK does not camelCase them: these are the strings in the service's own docs and
 * in every `curl` an integrator will paste while debugging, and a second spelling would make the two
 * impossible to read side by side.
 */

import type { components } from "./generated/schema.js";
import type { MinorUnits } from "./money.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

/** The two currencies the service supports. A third is a decision, not a config change. */
export type Currency = Schemas["Currency"];

/** The two PSPs. Nothing in a consumer's code should branch on this — branch on `status`. */
export type Provider = Schemas["Provider"];

/**
 * Which credential took the payment.
 *
 * @remarks
 * A property of the key, never of the request: there is no test hostname, no `sandbox` option and no
 * `test: true` flag. Every payment reports the mode it was created under.
 */
export type PaymentMode = Schemas["Mode"];

/** A payment, as every payment endpoint returns it. */
export type Payment = Schemas["Payment"];

/** A refund. `outcome_unknown: true` means nobody can yet say whether the money moved. */
export type Refund = Schemas["Refund"];

/** One event's delivery state. The payload is deliberately not included. */
export type WebhookDelivery = Schemas["WebhookDelivery"];

/** Which deliveries to list. Defaults to `pending`, because "what is stuck?" is the question. */
export type WebhookDeliveryStatus = "pending" | "delivered" | "dead_lettered" | "all";

/**
 * What to create a payment with.
 *
 * @remarks
 * `amount_minor` is {@link MinorUnits} rather than `string`, so `{ amount_minor: "25.00" }` is a
 * **compile** error rather than a `400` — or worse, a charge in the wrong units.
 */
export interface CreatePaymentInput {
  /**
   * Your own order id, 1–200 characters.
   *
   * @remarks
   * **Not an idempotency key.** It is not required to be unique, because a retried checkout of the
   * same cart legitimately reuses it. The thing that prevents a double charge is the
   * `Idempotency-Key`, which is a separate argument.
   */
  readonly merchant_payment_ref: string;
  /** Canonical minor units. Build it with `huf()`, `eurCents()` or `minorUnits()`. */
  readonly amount_minor: MinorUnits;
  /** Must be one the merchant record allows, which defaults to their default currency alone. */
  readonly currency: Currency;
  /**
   * Which PSP charges the buyer.
   *
   * @remarks
   * Optional, and it stays optional: omitted with **one** active credential uses that one, and
   * omitted with **two** is a `400`. The SDK does not default it either — guessing which PSP charges
   * your buyer is not a defaulting decision.
   */
  readonly provider?: Provider;
  /**
   * Opaque data, echoed back on every read.
   *
   * @remarks
   * **Never put buyer PII here.** It is stored *unencrypted* and returned on every read of the
   * payment. The service has no buyer name, email or address field on purpose — the PSP collects
   * those on its own hosted page — and `metadata` is not a way around that. Capped at 4096 bytes
   * serialised.
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * What to refund.
 *
 * @remarks
 * There is deliberately **no "refund the remainder"** shortcut, here or in the service: a default
 * would make the same request refund different amounts depending on when it arrived. Take the amount
 * from what the API reports as remaining, not from your own bookkeeping.
 */
export interface CreateRefundInput {
  /** Canonical minor units. Required. */
  readonly amount_minor: MinorUnits;
  /**
   * The payment's currency — an **assertion**, not an instruction.
   *
   * @remarks
   * Both PSPs key a refund off the original transaction and neither can change its currency. This
   * field exists so "refund 500 EUR" against a HUF payment cannot be silently read as 500 HUF; a
   * mismatch is a `422 currency_mismatch`.
   */
  readonly currency: Currency;
  /** For your records, ≤ 500 characters. Never forwarded to Stripe's three-value `reason` enum. */
  readonly reason?: string;
}

/**
 * A created payment, and whether it already existed.
 *
 * @remarks
 * `replayed: true` means the service answered `200` with the frozen body of an earlier identical
 * request under the same key — nothing was created, and that is a success. A `201` means this call
 * created it.
 */
export interface CreatePaymentResult {
  readonly payment: Payment;
  readonly replayed: boolean;
}

/** A created refund, and whether it already existed. See {@link CreatePaymentResult}. */
export interface CreateRefundResult {
  readonly refund: Refund;
  readonly replayed: boolean;
}
