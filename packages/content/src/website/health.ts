/**
 * `GET /api/health` — the only unauthenticated endpoint, and the only one where a non-2xx answer
 * is still an answer.
 */

import { LamidoApiError, type ResolvedConfig, request } from "@lamido/api-core";
import { parseContentError, serviceName } from "../errors.js";
import type { RequestOptions } from "../options.js";
import type { ContentHealth } from "../types.js";

/**
 * A `503` carrying a health body, smuggled back through the transport's error path.
 *
 * @remarks
 * Not exported, and not something a caller ever catches: it exists only because `request` is the
 * one door out of this package and it throws for every non-2xx. Hand-rolling this one request to
 * avoid that would put a second `fetch` call — and a second place the credential is attached — in
 * the package, which is a much worse trade than this small detour.
 */
class DegradedHealth extends LamidoApiError {
  readonly health: ContentHealth;

  constructor(health: ContentHealth, requestPath: string) {
    super({
      service: serviceName,
      status: 503,
      code: "internal_error",
      message: "content-service reports a degraded database",
      requestPath,
      retryable: true,
    });
    this.health = health;
  }
}

/**
 * Read the service's health.
 *
 * @param cfg - The resolved configuration.
 * @param options - `init` only; this endpoint takes no parameters.
 * @returns The health body, **including** the degraded one a `503` carries.
 * @remarks
 * The body is the point. When the database is unreachable the service answers `503` *with*
 * `{ status: "degraded", db: "unreachable", code: "…" }`, and a monitor that checks `response.ok`
 * before reading the body never sees the reason. So a degraded answer is returned rather than
 * thrown, and `status === "degraded"` is the check instead of a try/catch.
 *
 * Any other failure still throws: a `401` from a misconfigured key is not a health report.
 */
export async function getHealth(
  cfg: ResolvedConfig,
  options: RequestOptions = {},
): Promise<ContentHealth> {
  try {
    return await request<ContentHealth>(cfg, {
      method: "GET",
      path: "/api/health",
      read: { kind: "raw" },
      ...(options.init ? { init: options.init } : {}),
      onError: (context) => {
        const body = context.body as ContentHealth | null;
        return context.status === 503 && body?.status === "degraded"
          ? new DegradedHealth(body, context.requestPath)
          : parseContentError(context);
      },
    });
  } catch (error) {
    if (error instanceof DegradedHealth) return error.health;
    throw error;
  }
}
