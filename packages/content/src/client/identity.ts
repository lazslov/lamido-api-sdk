/** `GET /api/client/me` — the boot-time check that a key points at the site you meant. */

import type { ResolvedConfig } from "@lamido/api-core";
import { call } from "../call.js";
import { passInit, type RequestOptions } from "../options.js";
import type { ClientIdentity } from "../types.js";

/** The identity half of a client-tier client. */
export interface IdentityMethods {
  /**
   * This key's site and key metadata.
   *
   * @remarks
   * Worth calling on boot in every environment you configure: it is the one call that tells you
   * *which tenant* a key belongs to, and pointing a staging site at production content is the failure
   * this catches. `site.locales` is the set this key may write, and nothing else on the tier reports
   * it.
   *
   * The service has no users, no roles and no sessions — one key stands for every human behind it, and
   * the audit trail records the key's `label`. "Which person did this" is a question your own session
   * log answers.
   */
  getMe(options?: RequestOptions): Promise<ClientIdentity>;
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
      call<ClientIdentity>(cfg, {
        method: "GET",
        path: "/api/client/me",
        read: { kind: "data" },
        ...passInit(options),
      }),
  };
}
