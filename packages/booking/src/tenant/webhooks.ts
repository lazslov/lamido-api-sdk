/**
 * The tenant-side webhook surface: the catalogue, your endpoints, what was emitted, what arrived.
 *
 * @remarks
 * **This is the only way to learn that something happened.** The service sends no email, no SMS
 * and no push; `booking.reminder_reached` fires on the tenant's offsets and **you** decide whether a
 * human hears about it. Without a receiver, a tenant's customers are told nothing.
 */

import type { CursorPage, ResolvedConfig } from "@lazslov/api-core";
import {
  call,
  callCursorList,
  callUnpaginated,
  type ListOptions,
  passInit,
  type RequestOptions,
} from "../call.js";
import type {
  CreateWebhookEndpointInput,
  DeliveryStatus,
  EventType,
  MintedWebhookEndpoint,
  UpdateWebhookEndpointInput,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
  WebhookTestResult,
} from "../types.js";

/** Which endpoints to list. */
export interface WebhookEndpointListOptions extends ListOptions {
  /** Omitted, both enabled and disabled endpoints are listed. */
  readonly enabled?: boolean;
}

/** Which stored events to list. */
export interface WebhookEventListOptions extends ListOptions {
  /** One event type from the catalogue. `webhook.ping` is in no catalogue and is a `400` here. */
  readonly event_type?: string;
  /** An instant with an offset. Bounds `created_at`, inclusive. */
  readonly from?: string;
  /** An instant with an offset. Bounds `created_at`, exclusive. */
  readonly until?: string;
}

/** Which deliveries to list. */
export interface WebhookDeliveryListOptions extends ListOptions {
  /** `pending`, `delivered` or `dead_lettered` — **and nothing else**. `dead` is a job status and a `400` here. */
  readonly status?: DeliveryStatus;
  /** One endpoint's `public_id`. */
  readonly endpoint?: string;
  /** Filters on the **event's** type. */
  readonly event_type?: string;
}

/** The webhook part of a tenant client. */
export interface WebhookMethods {
  /**
   * The event catalogue, as data.
   *
   * @remarks
   * **Build a subscription UI from this, not from a list you typed.** A hardcoded array is wrong
   * the day any service adds an event, silently. The SDK's own `BookingWebhookEventType` is for
   * narrowing a parsed delivery, not for offering choices.
   */
  listEventTypes(options?: RequestOptions): Promise<EventType[]>;

  /** This tenant's endpoints, keyset-paged. */
  listWebhookEndpoints(options?: WebhookEndpointListOptions): Promise<CursorPage<WebhookEndpoint>>;

  /**
   * Register a receiver.
   *
   * @returns The endpoint **with its `secret`** — the only response that carries it. Store it.
   * @throws {@link ../errors.js | BookingApiError} — a `400` for an internal or non-HTTPS URL;
   * `409 endpoint_limit_reached` at the tenant's cap.
   * @remarks
   * `subscribed_events: null` means every type in the catalogue, which is how a new event type
   * reaches you for free. The URL is re-validated at **every** delivery, not only here.
   */
  createWebhookEndpoint(
    body: CreateWebhookEndpointInput,
    options?: RequestOptions,
  ): Promise<MintedWebhookEndpoint>;

  /** Read one endpoint. `secret_last4` and `secret_fingerprint` are all it says about the secret. */
  getWebhookEndpoint(endpointId: string, options?: RequestOptions): Promise<WebhookEndpoint>;

  /** Change an endpoint. At least one field. */
  updateWebhookEndpoint(
    endpointId: string,
    body: UpdateWebhookEndpointInput,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint>;

  /**
   * Delete an endpoint. `204`.
   *
   * @remarks
   * Its delivery history goes with it. To stop deliveries and keep the record, disable instead.
   */
  deleteWebhookEndpoint(endpointId: string, options?: RequestOptions): Promise<void>;

  /**
   * Enable an endpoint — including one the service disabled after five consecutive failures.
   *
   * @remarks
   * Clears `disabled_reason` and resets `consecutive_failures`. **Enabling does not replay**: events
   * that fired while you were disabled are not re-sent. Redeliver the ones you need, individually,
   * from {@link WebhookMethods.listWebhookDeliveries}. Fix the receiver first.
   */
  enableWebhookEndpoint(endpointId: string, options?: RequestOptions): Promise<WebhookEndpoint>;

  /** Stop deliveries without losing the record. */
  disableWebhookEndpoint(endpointId: string, options?: RequestOptions): Promise<WebhookEndpoint>;

  /**
   * Rotate the signing secret.
   *
   * @returns The endpoint with its **new** `secret`, once.
   * @remarks
   * Deliveries already in flight were signed with the old secret, so **accept both for a few
   * minutes** — the normal shape of a signing-key rotation.
   */
  rotateWebhookSecret(endpointId: string, options?: RequestOptions): Promise<MintedWebhookEndpoint>;

  /**
   * Send yourself a `webhook.ping`.
   *
   * @remarks
   * A real signed delivery through the real path, so verifying it proves your **signature check**
   * works — not merely that your URL answers. Answers `202`.
   */
  testWebhookEndpoint(endpointId: string, options?: RequestOptions): Promise<WebhookTestResult>;

  /**
   * What was emitted, regardless of who received it. Keyset-paged.
   *
   * @remarks
   * `payload.customer` is **stripped here**, even for endpoints that receive it. If you need to see
   * exactly what was sent, verify it at your end.
   */
  listWebhookEvents(options?: WebhookEventListOptions): Promise<CursorPage<WebhookEvent>>;

  /**
   * One row per (event, endpoint), with your answer on the last attempt. Keyset-paged.
   *
   * @remarks
   * Exists so "why haven't I received the event?" is answerable without a support ticket. A
   * `pending` row includes an attempt in flight and a failed attempt with rungs left — read
   * `next_attempt_at`. Retries after the first ride the cron, and this deployment gets **one cron
   * per day**.
   */
  listWebhookDeliveries(options?: WebhookDeliveryListOptions): Promise<CursorPage<WebhookDelivery>>;

  /**
   * Re-send one delivery's **stored** payload, byte for byte.
   *
   * @param deliveryId - The delivery row's `public_id`, from the listing.
   * @returns The row as the redelivery left it — `status: "pending"`, `attempt: 0`, `error: null`.
   * **Read the reset off this `202`**, never by re-reading the row: the first fresh attempt bursts
   * within milliseconds, so a re-read normally already shows `attempt: 1`.
   * @remarks
   * `X-Event-Id` does not change — a redelivery is the same event again, and a receiver that dedupes
   * on it is entitled to recognise it. `X-Delivery-Id` does change.
   */
  redeliverWebhook(deliveryId: string, options?: RequestOptions): Promise<WebhookDelivery>;
}

/**
 * Bind the webhook methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindWebhookMethods(cfg: ResolvedConfig): WebhookMethods {
  const endpoint = (id: string) => `/v1/webhook-endpoints/${encodeURIComponent(id)}`;

  /** A bodiless `POST` action on one endpoint. */
  const action = <T>(id: string, name: string, options: RequestOptions) =>
    call<T>(cfg, {
      method: "POST",
      path: `${endpoint(id)}/${name}`,
      read: { kind: "raw" },
      ...passInit(options),
    });

  return {
    listEventTypes: (options = {}) =>
      callUnpaginated<EventType>(cfg, {
        method: "GET",
        path: "/v1/event-types",
        ...passInit(options),
      }),

    listWebhookEndpoints: (options = {}) =>
      callCursorList<WebhookEndpoint>(cfg, {
        method: "GET",
        path: "/v1/webhook-endpoints",
        query: { limit: options.limit, cursor: options.cursor, enabled: options.enabled },
        ...passInit(options),
      }),

    createWebhookEndpoint: (body, options = {}) =>
      call<MintedWebhookEndpoint>(cfg, {
        method: "POST",
        path: "/v1/webhook-endpoints",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getWebhookEndpoint: (endpointId, options = {}) =>
      call<WebhookEndpoint>(cfg, {
        method: "GET",
        path: endpoint(endpointId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    updateWebhookEndpoint: (endpointId, body, options = {}) =>
      call<WebhookEndpoint>(cfg, {
        method: "PATCH",
        path: endpoint(endpointId),
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    deleteWebhookEndpoint: (endpointId, options = {}) =>
      call<void>(cfg, {
        method: "DELETE",
        path: endpoint(endpointId),
        read: { kind: "none" },
        ...passInit(options),
      }),

    enableWebhookEndpoint: (endpointId, options = {}) =>
      action<WebhookEndpoint>(endpointId, "enable", options),
    disableWebhookEndpoint: (endpointId, options = {}) =>
      action<WebhookEndpoint>(endpointId, "disable", options),
    rotateWebhookSecret: (endpointId, options = {}) =>
      action<MintedWebhookEndpoint>(endpointId, "rotate-secret", options),
    testWebhookEndpoint: (endpointId, options = {}) =>
      action<WebhookTestResult>(endpointId, "test", options),

    listWebhookEvents: (options = {}) =>
      callCursorList<WebhookEvent>(cfg, {
        method: "GET",
        path: "/v1/webhook-events",
        query: {
          limit: options.limit,
          cursor: options.cursor,
          event_type: options.event_type,
          from: options.from,
          until: options.until,
        },
        ...passInit(options),
      }),

    listWebhookDeliveries: (options = {}) =>
      callCursorList<WebhookDelivery>(cfg, {
        method: "GET",
        path: "/v1/webhook-deliveries",
        query: {
          limit: options.limit,
          cursor: options.cursor,
          status: options.status,
          endpoint: options.endpoint,
          event_type: options.event_type,
        },
        ...passInit(options),
      }),

    redeliverWebhook: (deliveryId, options = {}) =>
      call<WebhookDelivery>(cfg, {
        method: "POST",
        path: `/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
