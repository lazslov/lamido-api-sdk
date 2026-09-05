/**
 * `/v1/bookings` — the full lifecycle, from the tenant's own backend.
 *
 * @remarks
 * The state machine:
 *
 * ```
 * (create) ──► pending ──► confirmed ──┬──► completed  (terminal)
 *                 │            │        └──► no_show    (terminal)
 *                 └────────────┴────────────► canceled  (terminal)
 * ```
 *
 * `pending` and `confirmed` hold the slot. **Nothing leaves a terminal status** — any transition
 * out of one is `422 booking_terminal`, including cancelling a completed booking.
 *
 * Your key is the authority here: no capability token is needed for any of these, and the
 * customer's `reschedule_window_minutes` and `cancel_window_minutes` do not bind this tier.
 */

import type { CursorPage, IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import {
  call,
  callCursorList,
  callWithMeta,
  isReplay,
  type ListOptions,
  passInit,
  type RequestOptions,
} from "../call.js";
import type {
  Booking,
  BookingListRow,
  BookingStatus,
  CancelInput,
  CreateBookingInput,
  CreateBookingResult,
  CreatedBooking,
  RescheduleInput,
  RescheduleResult,
} from "../types.js";

/** Which bookings to list. */
export interface BookingListOptions extends ListOptions {
  /** One status. Omitted, every status is listed. */
  readonly status?: BookingStatus;
  /** An instant with an offset, `2026-09-01T00:00:00Z`. Bounds **`starts_at`**, inclusive. */
  readonly from?: string;
  /** An instant with an offset. Bounds **`starts_at`**, exclusive. */
  readonly until?: string;
}

/** A freshly minted confirmation token. The previous one stopped working the moment this was minted. */
export interface MintedConfirmationToken {
  readonly confirmation_token: string;
}

/** A freshly minted management token. The previous one stopped working the moment this was minted. */
export interface MintedManagementToken {
  readonly management_token: string;
}

/** The booking part of a tenant client. */
export interface BookingMethods {
  /**
   * Bookings, keyset-paged, filtered on `status` and a `starts_at` window.
   *
   * @remarks
   * Rows carry **no `customer` object at all** — read one booking for the full record. There is
   * no `updated_since` filter: `from` and `until` bound `starts_at`, so a reconciliation poll reads
   * the **window of bookings** you are about to act on, not the tail of a change log.
   *
   * @example
   * ```ts
   * const tomorrow = await collectAllCursor(({ limit, cursor }) =>
   *   booking.listBookings({ from, until, limit, cursor }),
   * );
   * ```
   */
  listBookings(options?: BookingListOptions): Promise<CursorPage<BookingListRow>>;

  /**
   * Create a booking from your backend.
   *
   * @param body - Identical to the public create. `pending_reason` and `metadata` are yours and are
   * never interpreted.
   * @param key - **Required.** Derive it from the intent — your own order or form id — never from
   * the clock. Reuse the same key on a retry after a timeout; a new key is a second appointment.
   * @param options - `init` only.
   * @returns The booking with its tokens, and whether this was a replay. Read `replayed` first.
   * @throws {@link ../errors.js | BookingApiError} — `409 slot_taken`; `409 idempotency_in_flight`,
   * retryable with the same key; `409 idempotency_mismatch`, a bug in the caller; a `422` naming
   * the rule; a `502` from the freebusy pre-check, where nothing was written and a retry is safe.
   * @remarks
   * Fires `booking.created`, plus `booking.confirmed` when the tenant requires no confirmation and
   * the booking is born `confirmed`. **This service then sends nothing** — the confirmation email
   * is yours to send from a webhook receiver, with the `confirmation_token` from this response.
   *
   * Park a booking on a payment by setting `pending_reason` and calling
   * {@link BookingMethods.confirmBooking} when the payment settles.
   */
  createBooking(
    body: CreateBookingInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<CreateBookingResult>;

  /**
   * Read one booking, in full.
   *
   * @throws {@link ../errors.js | BookingApiError} on a `404` — **never `null`**. Every read is
   * scoped to the key's tenant inside the query, so another tenant's id is indistinguishable from
   * one that does not exist. A booking id you hold came from a booking you created; "not found"
   * is a bug, and often the bug is a deployment holding the wrong `BOOKING_SERVICE_SECRET_KEY`.
   */
  getBooking(publicId: string, options?: RequestOptions): Promise<Booking>;

  /**
   * Confirm a pending booking. No token — your key is the authority.
   *
   * @throws {@link ../errors.js | BookingApiError} — `422 already_confirmed`, which is a **success**
   * and says so; `422 pending_expired`; `422 booking_terminal`.
   * @remarks
   * Call it when whatever `pending_reason` stood for is settled. Fires `booking.confirmed`.
   */
  confirmBooking(publicId: string, options?: RequestOptions): Promise<Booking>;

  /**
   * Mark a booking completed. Terminal.
   *
   * @remarks
   * A `confirmed` booking whose `ends_at` is more than two hours past is auto-completed by a job.
   * The delay is deliberate: it leaves a window to mark `no_show` first.
   */
  completeBooking(publicId: string, options?: RequestOptions): Promise<Booking>;

  /**
   * Record that the customer did not come. Terminal.
   *
   * @remarks
   * Deliberately distinct from `canceled`: a policy about repeat no-shows cannot be written against
   * a status that also means "they told us in advance". Records `cancellation_reason: "no_show"`.
   */
  markNoShow(publicId: string, options?: RequestOptions): Promise<Booking>;

  /**
   * Move a booking to a new slot.
   *
   * @param publicId - The booking to move.
   * @param body - The new instant, and optionally a new employee and a hold.
   * @param key - **Required.** A reschedule creates a new booking.
   * @returns The **new** booking, and whether this was a replay.
   * @throws {@link ../errors.js | BookingApiError} — `409 slot_taken`; `422 booking_terminal`.
   * @remarks
   * Creates a new booking and cancels this one in a single transaction. You get a new `public_id`;
   * `rescheduled_from_id` on the new one points back, `rescheduled_to_id` on the old one points
   * forward. The customer's existing management token keeps working on the new booking. This tier
   * is **not** bound by `reschedule_window_minutes` — that window governs the customer.
   */
  rescheduleBooking(
    publicId: string,
    body: RescheduleInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<RescheduleResult>;

  /**
   * Cancel a booking. Records `cancellation_reason: "tenant"`.
   *
   * @param publicId - The booking to cancel.
   * @param body - Optionally a `reason`, stored on the booking's event rather than the booking.
   * @throws {@link ../errors.js | BookingApiError} — `422 booking_terminal`.
   */
  cancelBooking(publicId: string, body?: CancelInput, options?: RequestOptions): Promise<Booking>;

  /**
   * Re-mint the confirmation token — "resend the confirmation email".
   *
   * @remarks
   * **A re-mint replaces; it does not add.** The previous token stops working immediately, so a
   * link from an earlier send cannot be used after the customer asked for a new one. Also the way
   * back when a replay of a recovered create came without tokens.
   */
  mintConfirmationToken(
    publicId: string,
    options?: RequestOptions,
  ): Promise<MintedConfirmationToken>;

  /** Re-mint the management token — "resend my booking link". Replaces the previous one. */
  mintManagementToken(publicId: string, options?: RequestOptions): Promise<MintedManagementToken>;
}

/**
 * Bind the booking methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindBookingMethods(cfg: ResolvedConfig): BookingMethods {
  const booking = (publicId: string) => `/v1/bookings/${encodeURIComponent(publicId)}`;

  /** A bodiless `POST` transition that answers the booking. */
  const transition = (publicId: string, action: string, options: RequestOptions) =>
    call<Booking>(cfg, {
      method: "POST",
      path: `${booking(publicId)}/${action}`,
      read: { kind: "raw" },
      ...passInit(options),
    });

  return {
    listBookings: (options = {}) =>
      callCursorList<BookingListRow>(cfg, {
        method: "GET",
        path: "/v1/bookings",
        query: {
          limit: options.limit,
          cursor: options.cursor,
          status: options.status,
          from: options.from,
          until: options.until,
        },
        ...passInit(options),
      }),

    async createBooking(body, key, options = {}) {
      const answer = await callWithMeta<Booking>(cfg, {
        method: "POST",
        path: "/v1/bookings",
        // Passed through as given: the idempotency hash covers the body, so a helpful tidy-up here
        // would turn a replay into a `409 idempotency_mismatch`.
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return isReplay(answer.status, answer.headers)
        ? { replayed: true, booking: answer.value }
        : { replayed: false, booking: answer.value as CreatedBooking };
    },

    getBooking: (publicId, options = {}) =>
      call<Booking>(cfg, {
        method: "GET",
        path: booking(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    confirmBooking: (publicId, options = {}) => transition(publicId, "confirm", options),
    completeBooking: (publicId, options = {}) => transition(publicId, "complete", options),
    markNoShow: (publicId, options = {}) => transition(publicId, "no-show", options),

    async rescheduleBooking(publicId, body, key, options = {}) {
      const answer = await callWithMeta<Booking>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/reschedule`,
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { booking: answer.value, replayed: isReplay(answer.status, answer.headers) };
    },

    cancelBooking: (publicId, body = {}, options = {}) =>
      call<Booking>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/cancel`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    mintConfirmationToken: (publicId, options = {}) =>
      call<MintedConfirmationToken>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/confirmation-token`,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    mintManagementToken: (publicId, options = {}) =>
      call<MintedManagementToken>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/management-token`,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
