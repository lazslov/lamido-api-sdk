/**
 * `/v1/public/availability` and `/v1/public/availability/days` — the bookable slots.
 *
 * @remarks
 * Computed from working rules, date exceptions, existing bookings, live holds and any connected
 * staff calendars, then trimmed by the tenant's lead time and booking horizon. **A slot in the
 * answer is not a reservation** — it is what was true when the response was computed.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "../call.js";
import type { Availability, AvailabilityDays } from "../types.js";

/** Which slots to compute. */
export interface AvailabilityQuery {
  /** The service's `public_id`. */
  readonly service_id: string;
  /** `YYYY-MM-DD`, **location-local**, inclusive. */
  readonly from: string;
  /** `YYYY-MM-DD`, **location-local**, exclusive. `from=2026-09-14&until=2026-09-15` is one day. */
  readonly until: string;
  /** Narrows to one staff member. Omitted, every eligible employee is considered. */
  readonly employee_id?: string;
}

/** The availability third of a public client. */
export interface PublicAvailabilityMethods {
  /**
   * The bookable slots for one service over one window.
   *
   * @param query - The service, the window, and optionally one employee.
   * @throws {@link ../errors.js | BookingApiError} — a `400` for an unparseable window.
   * @remarks
   * The window is in **location-local dates**, but the slots come back as **UTC instants** and
   * may carry a `2026-09-13T22:00:00Z` boundary for a Budapest day. Render from `starts_at` and
   * the `timezone` in the answer, never from the date you asked for.
   *
   * `employee_ids` on a slot is a list because a slot can be offered by several people: pick one,
   * or let the customer pick, because the create names an employee explicitly.
   *
   * Rate-limited per **IP**, 120 a minute — an office NAT shares one budget.
   */
  getAvailability(query: AvailabilityQuery, options?: RequestOptions): Promise<Availability>;

  /**
   * The same computation summarised per local day, for a month picker.
   *
   * @param query - As {@link PublicAvailabilityMethods.getAvailability}, over a longer window.
   * @remarks
   * **Use this to grey out dates, not 31 calls to `getAvailability`.** It is one computation
   * summarised, not thirty-one. A day with `slot_count: 0` carries `null` for both instants.
   */
  getAvailabilityDays(
    query: AvailabilityQuery,
    options?: RequestOptions,
  ): Promise<AvailabilityDays>;
}

/**
 * Bind the availability reads to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindPublicAvailabilityMethods(cfg: ResolvedConfig): PublicAvailabilityMethods {
  // Spelled out rather than spread: the query is a closed set, and a stray key must not reach the
  // wire as a parameter the service would refuse.
  const query = (input: AvailabilityQuery) => ({
    service_id: input.service_id,
    from: input.from,
    until: input.until,
    employee_id: input.employee_id,
  });

  return {
    getAvailability: (input, options = {}) =>
      call<Availability>(cfg, {
        method: "GET",
        path: "/v1/public/availability",
        query: query(input),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getAvailabilityDays: (input, options = {}) =>
      call<AvailabilityDays>(cfg, {
        method: "GET",
        path: "/v1/public/availability/days",
        query: query(input),
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
