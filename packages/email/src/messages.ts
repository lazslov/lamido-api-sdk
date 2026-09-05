/**
 * `/v1/messages` — send, read, list, cancel.
 *
 * @remarks
 * Four endpoints, one resource. The send is the one with rules worth a paragraph each — the
 * required key, the `202`, the guard order that decides which failures consume the key — and the
 * read is the reconciliation poll every receiver keeps, because the webhook ladder is a floor.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import {
  call,
  callWithMeta,
  isReplay,
  messagePath,
  passInit,
  type RequestOptions,
} from "./call.js";
import type { MessageStatus } from "./status.js";
import type {
  Message,
  MessageDetail,
  MessageList,
  SendMessageInput,
  SendMessageResult,
} from "./types.js";

/** Which messages to list, and how many. */
export interface ListMessagesOptions extends RequestOptions {
  readonly status?: MessageStatus;
  readonly stream?: "transactional";
  /** Exact. */
  readonly template_key?: string;
  /**
   * **Exact** address match, lowercased.
   *
   * @remarks
   * No prefix search and no `LIKE`: a substring search across recipients is a data-exfiltration
   * primitive on a stolen key.
   */
  readonly to?: string;
  /** ISO 8601 with offset. **Inclusive**, on `created_at` — when the message was accepted. */
  readonly from?: string;
  /** ISO 8601 with offset. **Exclusive**, on `created_at`. One day is `from` 00:00 to `until` 00:00 the next. */
  readonly until?: string;
  /** 1–200, default 50. Out of range is a `400`, never a clamp. */
  readonly limit?: number;
  /** An opaque cursor from a previous page's `nextCursor`. Never construct one. */
  readonly cursor?: string;
}

/** The message endpoints of a tenant client. */
export interface MessageMethods {
  /**
   * Queue one message for one recipient.
   *
   * @param body - The template, the recipient, and the variables it renders with.
   * @param key - **Required.** Derive it from the business event, never from the clock:
   * `derivedIdempotencyKey("order-2026-0001", 1)`, not `crypto.randomUUID()`. A random key per
   * attempt removes all protection, and there is no unsend.
   * @param options - `init` only.
   * @returns The message as queued, and whether this was a replay.
   * @throws {@link ./errors.js | EmailApiError}. Read `code` before retrying, and read `advice`
   * when there is one — the two `409`s that look alike want opposite reactions.
   * @remarks
   * **Answers `202`, never `201`: the message is queued, not sent.** No provider call happens in
   * the request path. `message.status` is `queued`; read it back or subscribe to the webhook to
   * learn what happened — and `sent` still is not `delivered`.
   *
   * Which failures consume the key follows the service's guard order. Validation runs **before**
   * the key is reserved, so a `400` or `413` leaves it free: fix the body and resend with the
   * **same** key. The one refusal that consumes it is `409 recipient_suppressed`, which also
   * creates a `suppressed` row — a retry under a new key is exactly what the row exists to stop.
   * A network timeout is the case where people reach for a new key, and it is the case where the
   * old one protects them: resend it, and you get the `202` you missed or a replay of it.
   *
   * Keys are scoped per tenant and live 7 days. The body is hashed with sorted keys, so omitting
   * `stream` on one attempt and spelling it out on the next is the same request.
   *
   * @example
   * ```ts
   * const { message, replayed } = await email.sendMessage(
   *   {
   *     template: { key: "order.confirmation" },
   *     to: order.customerEmail,
   *     variables: {
   *       orderNumber: order.number,
   *       total: { amount: minorAmount(String(order.totalMinor)), currency: order.currency },
   *     },
   *     metadata: { order_id: order.id },
   *   },
   *   derivedIdempotencyKey(`order-${order.id}`, 1),
   * );
   * if (!replayed) await store(order.id, message.public_id);   // the only handle there is
   * ```
   */
  sendMessage(
    body: SendMessageInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<SendMessageResult>;

  /**
   * Read one message, with its timeline.
   *
   * @param publicId - The `public_id` from the send. A UUIDv7.
   * @throws {@link ./errors.js | EmailApiError} on a `404` — **never `null`**. A message that
   * belongs to another tenant is a `404`, never a `403`, so an id you hold answering "not found"
   * is a bug, and often the bug is a deployment holding the wrong `EMAIL_SERVICE_API_KEY`.
   * @remarks
   * **This is the reconciliation poll**, and the knowledge base says to keep one. The webhook retry
   * ladder runs on a cron that fires once a day, and an endpoint the ladder auto-disabled has no
   * backlog at all — nothing will ever arrive to tell you what you missed. An event is a
   * notification; this read is the authority.
   *
   * `events` are ordered by the provider's clock, not by insertion. `variables` is not here and
   * cannot be — see {@link ./types.js | Message}.
   */
  getMessage(publicId: string, options?: RequestOptions): Promise<MessageDetail>;

  /**
   * List this tenant's messages, newest first.
   *
   * @param options - Filters, page window and `init`.
   * @returns One page: the rows, and the cursor for the next one.
   * @remarks
   * **There is no `total`**, and the returned type does not declare one: `COUNT(*)` over a
   * tenant's messages is a scan that gets slower every day the service succeeds. **Follow
   * `nextCursor`, never a short page** — a filtered keyset page can come back under `limit` with
   * more behind it. `collectAllCursor` from `@lazslov/api-core` walks it.
   *
   * Do not poll this in a tight loop: it spends your own 100-per-10-seconds throttle. Subscribe
   * to the webhook, and use this as the periodic reconciliation over a `from`/`until` window.
   *
   * @example
   * ```ts
   * const stuck = await email.listMessages({ status: "queued", from: since, limit: 50 });
   * const done = stuck.nextCursor === null;   // the only end-of-list signal there is
   * ```
   */
  listMessages(options?: ListMessagesOptions): Promise<MessageList>;

  /**
   * Cancel a queued message.
   *
   * @param publicId - The message's `public_id`.
   * @param options - `init` only. This endpoint takes no body.
   * @returns The message as `canceled`.
   * @throws {@link ./errors.js | EmailApiError} `422` when the message has already left `queued`.
   * `detail` carries its current status, so "already sent" and "already canceled" read
   * differently — and a second cancel of a cancelled message is a `422`, **not a silent `200`**,
   * because pretending it succeeded would hide a double-submit in your own code.
   * @remarks
   * The window is short: the inline drain dispatches promptly on a service with traffic. Check
   * {@link ./status.js | isCancellable} before asking, and handle the `422` anyway.
   */
  cancelMessage(publicId: string, options?: RequestOptions): Promise<Message>;
}

/** The envelope the list answers with: `data` plus the keyset cursor, and no `total`. */
interface ListEnvelope {
  readonly data: Message[];
  readonly next_cursor: string | null;
}

/**
 * Bind the message methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindMessageMethods(cfg: ResolvedConfig): MessageMethods {
  return {
    async sendMessage(body, key, options = {}) {
      const answer = await callWithMeta<Message>(cfg, {
        method: "POST",
        path: "/v1/messages",
        // Passed through as given. The service hashes the body with sorted object keys for the
        // idempotency check but keeps ARRAY ORDER SIGNIFICANT, and it rejects unknown fields
        // rather than stripping them — so nothing here reorders, dedupes or tidies anything.
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { message: answer.value, replayed: isReplay(answer.status, answer.headers) };
    },

    getMessage: (publicId, options = {}) =>
      call<MessageDetail>(cfg, {
        method: "GET",
        path: messagePath(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async listMessages(options = {}) {
      const envelope = await call<ListEnvelope>(cfg, {
        method: "GET",
        path: "/v1/messages",
        query: {
          status: options.status,
          stream: options.stream,
          template_key: options.template_key,
          to: options.to,
          from: options.from,
          until: options.until,
          limit: options.limit,
          cursor: options.cursor,
        },
        // The envelope, not `data`: `next_cursor` is the only end-of-list signal there is.
        read: { kind: "envelope" },
        ...passInit(options),
      });
      // Renamed to `items` so the shape satisfies core's `collectAllCursor` with no adapter — and
      // `total` is absent rather than `undefined`, which is what makes reading it a type error.
      return { items: envelope.data, nextCursor: envelope.next_cursor };
    },

    cancelMessage: (publicId, options = {}) =>
      call<Message>(cfg, {
        method: "POST",
        path: `${messagePath(publicId)}/cancel`,
        // No body: the service neither requires nor reads one, and sending `{}` would add a
        // Content-Type header to a request that has nothing to declare.
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
