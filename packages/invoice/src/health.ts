/**
 * `GET /healthz` — the one unauthenticated route.
 *
 * @remarks
 * This used to be the endpoint where a non-2xx answer was still an answer: a degraded database
 * arrived as a `503` carrying the health body, and this module smuggled it back out through the
 * transport's error path.
 *
 * It cannot do that any more. As of the service's `f73e397` the route touches no dependency and
 * always answers `200 {"status":"ok"}`. The `db` and `code` members are **gone from the body**
 * rather than stubbed, so there is no degraded response left to smuggle — the same shape
 * content-service arrived at.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "./call.js";
import type { InvoiceHealth } from "./types.js";

/** The health half of a client. */
export interface HealthMethods {
  /**
   * Read the service's liveness.
   *
   * @param options - `init` only; this endpoint takes no parameters.
   * @returns `{ status: "ok" }`, the only body this endpoint can produce.
   * @throws {@link ./errors.js | InvoiceApiError} for any failure. A non-2xx from a route that
   * always answers `200` is a network or proxy fault, not a health report.
   * @remarks
   * The body is **not** wrapped in `data`, and never was — the reason `@lazslov/api-core`'s read
   * mode is explicit per call.
   *
   * **This proves the process is up. It cannot prove the service works.** The route runs no query,
   * so it keeps answering `200` while a broken `DATABASE_URL` fails every other route on the host.
   * Because it wakes nothing, a monitor may poll it at any cadence.
   *
   * The database, the stuck counts and the queue are on `GET /v1/admin/health`, which this SDK
   * does not expose.
   *
   * Unauthenticated at the service, so this is the one call that works with a key the service
   * would otherwise reject — which also makes it useless as a credential check.
   */
  getHealth(options?: RequestOptions): Promise<InvoiceHealth>;
}

/**
 * Bind the health method to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindHealthMethod(cfg: ResolvedConfig): HealthMethods {
  return {
    getHealth: (options = {}) =>
      call<InvoiceHealth>(cfg, {
        method: "GET",
        path: "/healthz",
        // `raw`: there is no envelope on this route at all.
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
