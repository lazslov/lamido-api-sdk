/**
 * `/v1/me` and `/v1/settings` — who this key is, and what the tenant may do.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "../call.js";
import type { TenantIdentity, TenantSettings } from "../types.js";

/** The identity part of a tenant client. */
export interface IdentityMethods {
  /**
   * Who this key belongs to. A credential check that touches nothing.
   *
   * @remarks
   * A revoked key and a deactivated tenant both answer a plain `401`, deliberately — telling them
   * apart would make the API an oracle for which keys are real.
   */
  getMe(options?: RequestOptions): Promise<TenantIdentity>;

  /**
   * This tenant's settings. **Read-only here**; an operator changes them.
   *
   * @remarks
   * Read `require_confirmation`, `public_booking_create_enabled` and `reminder_offsets_minutes`
   * before you build: they decide whether a create is born `confirmed`, whether a browser may
   * create at all, and when `booking.reminder_reached` fires — which this service emits and
   * never sends.
   */
  getSettings(options?: RequestOptions): Promise<TenantSettings>;
}

/**
 * Bind the identity reads to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindIdentityMethods(cfg: ResolvedConfig): IdentityMethods {
  return {
    getMe: (options = {}) =>
      call<TenantIdentity>(cfg, {
        method: "GET",
        path: "/v1/me",
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getSettings: (options = {}) =>
      call<TenantSettings>(cfg, {
        method: "GET",
        path: "/v1/settings",
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
