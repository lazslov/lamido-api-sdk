/**
 * `/v1/public/bookings` — create a booking, and the four things a customer does to their own.
 *
 * @remarks
 * A `bpk_` key says which tenant; a **capability token** says which booking. The management token
 * travels in the `X-Booking-Token` header and grants read, reschedule and cancel. The confirmation
 * token travels in the **body** of `confirm` and works once. Both appear in the create response
 * and nowhere else.
 *
 * **This service sends nothing.** The confirmation link, the reminder and the cancellation notice
 * are all yours to send, from a backend that receives the webhooks. A `bpk_` key alone tells the
 * customer nothing.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import { call, callWithMeta, isReplay, passInit, type RequestOptions } from "../call.js";
import type {
  CancelInput,
  CreateBookingInput,
  CreatedPublicBooking,
  CreatePublicBookingResult,
  PublicBooking,
  PublicBookingWithWindows,
  RescheduleInput,
  RescheduleResult,
} from "../types.js";

/**
 * The header a management token travels in, alongside the `bpk_` key.
 *
 * @remarks
 * A header, not a query parameter: a token in a query string ends up in referrer headers, browser
 * history and every log between the customer and the service.
 */
export const bookingTokenHeader = "X-Booking-Token";

/** The booking third of a public client. */
export interface PublicBookingMethods {
  /**
   * Create a booking from a browser.
   *
   * @param body - The service, the employee, the instant, the customer — and the hold with its
   * `nonce`, if you took one.
   * @param key - **Required.** A customer double-clicking Book is the normal case, and without a key
   * that is two appointments. Derive it from the intent, never from the clock.
   * @param options - `init` only.
   * @returns The booking and whether this was a replay. Read `replayed` before reading the tokens.
   * @throws {@link ../errors.js | BookingApiError} — `422 public_create_disabled` when the tenant
   * has not opted in; `409 slot_taken` when the race was lost; `409 idempotency_in_flight`, which
   * is retryable with the **same** key; `422 hold_expired` when the hold lapsed; `429` at 10 a
   * minute per IP or 5 an hour per customer email.
   * @remarks
   * **Off unless the tenant enabled `public_booking_create_enabled`.** A `bpk_` write surface is the
   * slot-exhaustion vector, so it is opt-in per tenant.
   *
   * **The `201` is the only response that ever carries the capability tokens.** Store both before
   * you navigate away; no read returns them, and a lost token is re-minted from the tenant tier.
   * `status` is `pending` when the tenant requires confirmation, `confirmed` otherwise — and then
   * `confirmation_token` is `null`, because nothing was minted.
   *
   * @example
   * ```ts
   * const result = await booking.createBooking(
   *   {
   *     service_id: slot.serviceId,
   *     employee_id: slot.employee_ids[0],
   *     starts_at: slot.starts_at,
   *     hold_id: hold.hold_id,
   *     nonce,
   *     customer: { email, name },
   *   },
   *   idempotencyKey(`booking-${formId}`),
   * );
   * if (!result.replayed) storeTokens(result.booking);
   * ```
   */
  createBooking(
    body: CreateBookingInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<CreatePublicBookingResult>;

  /**
   * Read one booking with its management token.
   *
   * @param publicId - The booking's `public_id`.
   * @param managementToken - From the create response, or re-minted on the tenant tier.
   * @returns The public view plus `windows` — when the customer may still reschedule or cancel.
   * @throws {@link ../errors.js | BookingApiError} — a `403` for the wrong token, a `404` for an
   * unknown booking. Neither is mapped to `null`: a booking whose token you hold exists.
   * @remarks
   * `null` in `windows` means the operation is **not offered at all**; a past timestamp means it
   * was offered and the window has closed. Word those differently.
   */
  getBooking(
    publicId: string,
    managementToken: string,
    options?: RequestOptions,
  ): Promise<PublicBookingWithWindows>;

  /**
   * Confirm a pending booking with its confirmation token.
   *
   * @param publicId - The booking's `public_id`.
   * @param confirmationToken - From the create response. Travels in the **body**, not the URL.
   * @throws {@link ../errors.js | BookingApiError} — `403 invalid_confirmation_token` for a wrong or
   * superseded token; `422 already_confirmed`, which is a **success** and carries advice saying so;
   * `422 pending_expired` when the window ran out — ask for the slot again and rebook.
   * @remarks
   * The link the customer clicked to get here is one **you** sent, from a webhook receiver that saw
   * `booking.created`. This service did not send it. Rate-limited to 10 a day per booking.
   */
  confirmBooking(
    publicId: string,
    confirmationToken: string,
    options?: RequestOptions,
  ): Promise<PublicBooking>;

  /**
   * Move a booking to a new slot.
   *
   * @param publicId - The booking's `public_id`.
   * @param managementToken - The management token.
   * @param body - The new instant, and optionally a new employee and a hold.
   * @param key - **Required.** A reschedule creates a new booking, and a create takes a key.
   * @returns The **new** booking, and whether this was a replay.
   * @throws {@link ../errors.js | BookingApiError} — `422 outside_reschedule_window` when it is too
   * late for the customer (the tenant tier is not bound by that window); `409 slot_taken`;
   * `422 booking_terminal`.
   * @remarks
   * A reschedule creates a new booking and cancels the old one atomically; it does not move a time.
   * You get a **new `public_id`** — follow `rescheduled_from_id` back. The same management token
   * works on the new booking, so nothing new is minted. One event fires: `booking.rescheduled`.
   *
   * A larger `reschedule_window_minutes` closes the window **earlier**: it is measured backwards
   * from the appointment.
   */
  rescheduleBooking(
    publicId: string,
    managementToken: string,
    body: RescheduleInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<RescheduleResult<PublicBooking>>;

  /**
   * Cancel a booking.
   *
   * @param publicId - The booking's `public_id`.
   * @param managementToken - The management token.
   * @param body - Optionally a `reason`, recorded on the booking's event rather than the booking.
   * @throws {@link ../errors.js | BookingApiError} — `422 outside_cancel_window`, `422 booking_terminal`.
   * @remarks
   * Records `cancellation_reason: "customer"` and fires `booking.canceled`.
   */
  cancelBooking(
    publicId: string,
    managementToken: string,
    body?: CancelInput,
    options?: RequestOptions,
  ): Promise<PublicBooking>;
}

/**
 * Bind the public booking methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindPublicBookingMethods(cfg: ResolvedConfig): PublicBookingMethods {
  const booking = (publicId: string) => `/v1/public/bookings/${encodeURIComponent(publicId)}`;
  const withToken = (token: string) => ({ [bookingTokenHeader]: token });

  return {
    async createBooking(body, key, options = {}) {
      const answer = await callWithMeta<PublicBooking>(cfg, {
        method: "POST",
        path: "/v1/public/bookings",
        // Passed through as given: the idempotency hash covers the body, so a helpful tidy-up here
        // would turn a replay into a `409 idempotency_mismatch`.
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return isReplay(answer.status, answer.headers)
        ? { replayed: true, booking: answer.value }
        : { replayed: false, booking: answer.value as CreatedPublicBooking };
    },

    getBooking: (publicId, managementToken, options = {}) =>
      call<PublicBookingWithWindows>(cfg, {
        method: "GET",
        path: booking(publicId),
        headers: withToken(managementToken),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    confirmBooking: (publicId, confirmationToken, options = {}) =>
      call<PublicBooking>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/confirm`,
        body: { token: confirmationToken },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async rescheduleBooking(publicId, managementToken, body, key, options = {}) {
      const answer = await callWithMeta<PublicBooking>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/reschedule`,
        body,
        headers: { ...withToken(managementToken), "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { booking: answer.value, replayed: isReplay(answer.status, answer.headers) };
    },

    cancelBooking: (publicId, managementToken, body = {}, options = {}) =>
      call<PublicBooking>(cfg, {
        method: "POST",
        path: `${booking(publicId)}/cancel`,
        body,
        headers: withToken(managementToken),
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
