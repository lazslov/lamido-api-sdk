/**
 * `GET /healthz` — the one unauthenticated route.
 *
 * @remarks
 * This used to be the endpoint where a non-2xx answer was still an answer: a degraded database
 * arrived as a `503` carrying the health body, and this module smuggled it back out through the
 * transport's error path.
 *
 * **The route now always answers `200`.** The degraded *body* still exists — unlike
 * content-service, this service does report the database here — so the check is still
 * `status === "degraded"`, but there is no error path left to smuggle it through.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "./call.js";
import type { InvoiceHealth } from "./types.js";

/** The health half of a client. */
export interface HealthMethods {
  /**
   * Read the service's health.
   *
   * @param options - `init` only; this endpoint takes no parameters.
   * @returns `{ status: "ok", db: "ok" }`, or the degraded body — both at `200`.
   * @throws {@link ./errors.js | InvoiceApiError} for any failure. A non-2xx from a route that
   * always answers `200` is a network or proxy fault, not a health report.
   * @remarks
   * The body is **not** wrapped in `data`, and never was — the reason `@lazslov/api-core`'s read
   * mode is explicit per call.
   *
   * When the database is unreachable the body is
   * `{ status: "degraded", db: "unreachable", code: "…" }` **at `200`**, so a monitor that checks
   * `response.ok` and stops there reports a healthy service with an unreachable database. Read
   * `status`. `code` is a driver error code, never a connection string.
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
