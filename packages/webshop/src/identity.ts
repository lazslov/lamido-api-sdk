/** `GET /v1/me` — the boot-time check that a key points at the shop you meant. */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "./call.js";
import type { StorefrontIdentity } from "./types.js";

/** The identity part of a storefront client. */
export interface IdentityMethods {
  /**
   * This key's shop and key metadata.
   *
   * @remarks
   * Worth calling on boot: it is the one call that says *which shop* a key belongs to, and pointing
   * a staging storefront at a production shop is the failure it catches. Use `shop.currency` to decide
   * how to format every amount — HUF has zero minor units — and `shop.locale` as a display default.
   *
   * `shop.status` is deliberately absent: a suspended shop's keys all answer `401`, so a shop that
   * receives this response is active by definition. `key.last_used_at` is refreshed at most every five
   * minutes and is not a liveness signal.
   */
  getMe(options?: RequestOptions): Promise<StorefrontIdentity>;
}

/**
 * Bind the identity method to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindIdentityMethods(cfg: ResolvedConfig): IdentityMethods {
  return {
    getMe: (options = {}) =>
      call<StorefrontIdentity>(cfg, {
        method: "GET",
        path: "/v1/me",
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
