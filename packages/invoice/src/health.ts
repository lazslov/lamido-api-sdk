/**
 * `GET /api/health` — the unauthenticated liveness probe, and the only endpoint where a non-2xx answer
 * is still an answer.
 */

import { LamidoApiError, type ResolvedConfig, request } from "@lazslov/api-core";
import type { RequestOptions } from "./call.js";
import { parseInvoiceError, serviceName } from "./errors.js";
import type { InvoiceHealth } from "./types.js";

/**
 * A `503` carrying a health body, smuggled back through the transport's error path.
 *
 * @remarks
 * Not exported, and not something a caller ever catches: it exists only because `request` is the one
 * door out of this package and it throws for every non-2xx. Hand-rolling this one request to avoid
 * that would put a second `fetch` call — and a second place the credential is attached — in the
 * package, which is a much worse trade than this small detour. The same pattern, for the same reason,
 * as `@lazslov/content`.
 */
class DegradedHealth extends LamidoApiError {
  readonly health: InvoiceHealth;

  constructor(health: InvoiceHealth, requestPath: string) {
    super({
      service: serviceName,
      status: 503,
      code: "internal_error",
      message: "invoice-service reports a degraded database",
      requestPath,
      retryable: true,
    });
    this.health = health;
  }
}

/** The health half of a client. */
export interface HealthMethods {
  /**
   * Read the service's health.
   *
   * @param options - `init` only; this endpoint takes no parameters.
   * @returns `{ status: "ok" }`, or the degraded body a `503` carries.
   * @throws {@link ./errors.js | InvoiceApiError} for any other failure. A `401` from a misconfigured
   * key is not a health report.
   * @remarks
   * The body is **not** wrapped in `data` — one of the service's three documented envelope exceptions,
   * and the reason `@lazslov/api-core`'s read mode is explicit per call: a shared `unwrap(body.data)`
   * applied here returns `undefined`.
   *
   * When the database is unreachable the service answers `503` *with*
   * `{ status: "degraded", db: "unreachable", code: "…" }`, and the service's own documentation lists
   * "a client that throws before reading it" as a live problem. So a degraded answer is returned rather
   * than thrown, and `status === "degraded"` is the check instead of a try/catch. `code` is a driver
   * error code, never a connection string.
   *
   * Unauthenticated at the service, so this is the one call that works with a key the service would
   * otherwise reject — which also makes it useless as a credential check.
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
    async getHealth(options = {}) {
      try {
        return await request<InvoiceHealth>(cfg, {
          method: "GET",
          path: "/api/health",
          // `raw`, not `data`: there is no envelope on this route at all.
          read: { kind: "raw" },
          ...(options.init ? { init: options.init } : {}),
          onError: (context) => {
            const body = context.body as InvoiceHealth | null;
            return context.status === 503 && body?.status === "degraded"
              ? new DegradedHealth(body, context.requestPath)
              : parseInvoiceError(context);
          },
        });
      } catch (error) {
        if (error instanceof DegradedHealth) return error.health;
        throw error;
      }
    },
  };
}
