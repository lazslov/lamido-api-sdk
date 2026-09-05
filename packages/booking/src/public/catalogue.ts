/**
 * `/v1/public/locations`, `…/services`, `…/employees` — what a browser may read about the shop.
 *
 * @remarks
 * The narrowest field lists in the service, because everything here is readable by anyone who
 * views page source. Three lists, none paginated: the contract declares no `limit` and no `cursor`
 * on any of them, so each answers its rows alone.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { callUnpaginated, passInit, type RequestOptions } from "../call.js";
import type { PublicEmployee, PublicLocation, PublicService } from "../types.js";

/** The catalogue third of a public client. */
export interface PublicCatalogueMethods {
  /**
   * Bookable locations.
   *
   * @remarks
   * Active locations only — an inactive one is **absent**, not flagged. No `active`, no
   * timestamps: those are the tenant's business. Rate-limited per **IP**, 120 a minute.
   */
  listLocations(options?: RequestOptions): Promise<PublicLocation[]>;

  /**
   * Services bookable at one location.
   *
   * @param locationId - The location's `public_id`.
   * @remarks
   * `price_minor` is a minor-unit string and **`HUF` is zero-decimal**: `"4500"` is 4500 Ft. `null`
   * means the tenant does not display a price, which is not zero. Buffers and `active` are absent.
   */
  listServices(locationId: string, options?: RequestOptions): Promise<PublicService[]>;

  /**
   * Who performs one service. Name and id only — no email address behind a public key.
   *
   * @param serviceId - The service's `public_id`.
   */
  listEmployees(serviceId: string, options?: RequestOptions): Promise<PublicEmployee[]>;
}

/**
 * Bind the public catalogue reads to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindPublicCatalogueMethods(cfg: ResolvedConfig): PublicCatalogueMethods {
  return {
    listLocations: (options = {}) =>
      callUnpaginated<PublicLocation>(cfg, {
        method: "GET",
        path: "/v1/public/locations",
        ...passInit(options),
      }),

    listServices: (locationId, options = {}) =>
      callUnpaginated<PublicService>(cfg, {
        method: "GET",
        path: `/v1/public/locations/${encodeURIComponent(locationId)}/services`,
        ...passInit(options),
      }),

    listEmployees: (serviceId, options = {}) =>
      callUnpaginated<PublicEmployee>(cfg, {
        method: "GET",
        path: `/v1/public/services/${encodeURIComponent(serviceId)}/employees`,
        ...passInit(options),
      }),
  };
}
