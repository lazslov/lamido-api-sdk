/**
 * Holds — a short reservation on one slot while a customer fills in a form.
 *
 * @remarks
 * The two tiers expose identical hold endpoints under different prefixes — `/v1/public/holds` for
 * a `bpk_` key, `/v1/holds` for a `bsk_` key — with the same bodies and the same `nonce` rule. So
 * this is one binding parameterised on the prefix, and both clients share it.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "./call.js";
import type { CreateHoldInput, Hold } from "./types.js";

/** The hold methods, present on both tiers. */
export interface HoldMethods {
  /**
   * Hold a slot for `hold_ttl_seconds` (default 600).
   *
   * @param body - The service, the employee, the instant, and **your** `nonce` (8–128 characters).
   * @returns The hold, with `hold_id` and `expires_at`.
   * @throws {@link ./errors.js | BookingApiError} — `409 slot_taken` when someone else holds or
   * booked it, or a `422` naming the rule (`lead_time_violated`, `horizon_exceeded`,
   * `employee_unavailable`, `service_inactive`).
   * @remarks
   * **Keep the `nonce`.** Redeeming the hold in a create and releasing it both require the same
   * value, and that is what proves the hold is yours without anyone needing a session. Generate it
   * per hold, from a random source — it is not an idempotency key and this SDK does not mint it.
   *
   * A hold is optional. Without one, a create races the database's exclusion constraint and loses
   * cleanly with `409 slot_taken`; a hold makes losing unlikely, not the correctness different.
   * No event fires for a hold — created, redeemed, released or expired.
   */
  createHold(body: CreateHoldInput, options?: RequestOptions): Promise<Hold>;

  /**
   * Release a hold early.
   *
   * @param holdId - The hold's `hold_id`.
   * @param nonce - The same `nonce` the hold was created with.
   * @throws {@link ./errors.js | BookingApiError} — `hold_not_yours` for a wrong `nonce`.
   * @remarks
   * Optional — a hold expires on its own — but releasing returns the slot to everyone else
   * immediately, which is the polite thing when a customer abandons the form. Answers `204`.
   */
  releaseHold(holdId: string, nonce: string, options?: RequestOptions): Promise<void>;
}

/**
 * Bind the hold methods to one configuration and one tier prefix.
 *
 * @param cfg - The resolved configuration.
 * @param basePath - `/v1/public/holds` or `/v1/holds`.
 * @internal
 */
export function bindHoldMethods(cfg: ResolvedConfig, basePath: string): HoldMethods {
  return {
    createHold: (body, options = {}) =>
      call<Hold>(cfg, {
        method: "POST",
        path: basePath,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    releaseHold: (holdId, nonce, options = {}) =>
      call<void>(cfg, {
        method: "DELETE",
        path: `${basePath}/${encodeURIComponent(holdId)}`,
        query: { nonce },
        read: { kind: "none" },
        ...passInit(options),
      }),
  };
}
