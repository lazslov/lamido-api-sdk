/**
 * `GET /v1/webhook-deliveries` — your own queue, for self-diagnosis.
 *
 * @remarks
 * Exists so "why haven't I received the event?" is answerable without a support ticket.
 */

import type { ResolvedConfig } from "@lamido/api-core";
import { call, passInit, type RequestOptions } from "./call.js";
import type { WebhookDelivery, WebhookDeliveryStatus } from "./types.js";

/** Which deliveries to list. */
export interface DeliveryListOptions extends RequestOptions {
  /**
   * Defaults to `pending` — the service's default, kept.
   *
   * @remarks
   * Because the common question is "what is stuck?". Ask for `"all"` explicitly when you want the
   * delivered ones too.
   */
  readonly status?: WebhookDeliveryStatus;
  /** 1–100, default 25. Newest first, and not paginated. */
  readonly limit?: number;
}

/** The delivery half of a merchant client. */
export interface DeliveryMethods {
  /**
   * List your own webhook deliveries, newest first.
   *
   * @remarks
   * Read `event_id` — stable across every retry of the same event, and **what you dedupe on**;
   * `delivery_id` identifies one HTTP attempt. `response_status` and `response_body_excerpt` are
   * *your* answer on the last attempt, which is usually where the problem is. `next_attempt_at` is a
   * **floor, not a schedule**: the delivery becomes eligible then and is attempted on the next sweep,
   * which on the current hosting tier can be hours later.
   *
   * The payload is deliberately not included — it is what the service POSTed you.
   */
  listWebhookDeliveries(options?: DeliveryListOptions): Promise<WebhookDelivery[]>;
}

/**
 * Bind the delivery methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindDeliveryMethods(cfg: ResolvedConfig): DeliveryMethods {
  return {
    listWebhookDeliveries: (options = {}) =>
      call<WebhookDelivery[]>(cfg, {
        method: "GET",
        path: "/v1/webhook-deliveries",
        query: { status: options.status, limit: options.limit },
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
