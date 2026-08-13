/**
 * `GET /healthz` — the only unauthenticated endpoint, and liveness only.
 *
 * @remarks
 * This used to be the one endpoint where a non-2xx answer was still an answer: it returned a
 * `503` carrying `{ status: "degraded", db: "unreachable" }`, and this module smuggled that body
 * back out through the transport's error path.
 *
 * It cannot do that any more. As of the service's `d013970` the route never touches the database,
 * always answers `200 {"status":"ok"}`, and the `db` member is **gone from the body** rather than
 * stubbed. A monitor polling it on a short interval was holding a Neon database awake around the
 * clock for a reading nothing acted on. So the smuggling machinery is gone with it — there is no
 * degraded response left to smuggle.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call } from "../call.js";
import type { RequestOptions } from "../options.js";
import type { ContentHealth } from "../types.js";

/**
 * Read the service's liveness.
 *
 * @param cfg - The resolved configuration.
 * @param options - `init` only; this endpoint takes no parameters.
 * @returns `{ status: "ok" }`, the only body this endpoint can produce.
 * @remarks
 * **This proves the process is up. It cannot prove the service works.** The route reads no
 * environment variable and opens no connection, so it keeps answering `200` while a malformed
 * `DATABASE_URL` fails every other endpoint on the host.
 *
 * Database health is `GET /v1/admin/health`, which is authenticated — deliberately, so it cannot
 * be polled by accident — and reports far more. It is not on this tier.
 *
 * Any failure here throws, because a non-2xx from an endpoint that always answers `200` is a
 * network or proxy fault rather than a health report.
 */
export function getHealth(
  cfg: ResolvedConfig,
  options: RequestOptions = {},
): Promise<ContentHealth> {
  return call<ContentHealth>(cfg, {
    method: "GET",
    path: "/healthz",
    read: { kind: "raw" },
    ...(options.init ? { init: options.init } : {}),
  });
}
