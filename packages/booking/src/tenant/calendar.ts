/**
 * `/v1/employees/{publicId}/calendar` — a staff member's Google calendar.
 *
 * @remarks
 * Optional, per employee. Once connected, their external busy time is subtracted from
 * availability and bookings are pushed into their calendar. Google is never in the booking hot
 * path by default: an outage there prevents no booking operation.
 *
 * The OAuth **callback** is `/v1/providers/google/oauth`, reached by Google and never by you. It is
 * not here. What is here is the tenant's side: start the flow, read the connection, disconnect.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callOrNull, passInit, type RequestOptions } from "../call.js";
import type {
  AuthorizeCalendarInput,
  CalendarAuthorization,
  CalendarConnection,
} from "../types.js";

/** The calendar part of a tenant client. */
export interface CalendarMethods {
  /**
   * Begin the Google consent flow for one staff member.
   *
   * @param employeeId - The staff member's `public_id`.
   * @param body - Where they land afterwards. **Required**: there is no default `return_url`, and an
   * empty body is a `400`.
   * @returns The URL to send the staff member to. Its `state` is single-use and short-lived.
   * @remarks
   * Google returns them to exactly your `return_url` with `?calendar=connected|denied|gone`
   * appended — the callback renders nothing and returns no JSON. **You** build that landing page,
   * and it must read the parameter: `connected` means stored; `denied` means they clicked cancel
   * and nothing was stored, so offer the button again; `gone` means the employee was deleted
   * mid-flow.
   */
  authorizeCalendar(
    employeeId: string,
    body: AuthorizeCalendarInput,
    options?: RequestOptions,
  ): Promise<CalendarAuthorization>;

  /**
   * The staff member's connection, or `null` when there is none.
   *
   * @param employeeId - The staff member's `public_id`.
   * @returns The connection, or `null` — the **one** place in this package a `404` is a normal
   * state rather than an error, because the knowledge base says so: *"404 if there is none, which
   * is normal"*.
   * @remarks
   * `status` is the field to watch. `degraded` means the sync is failing and **availability may be
   * stale**; `revoked` means the staff member disconnected us and only a fresh authorisation fixes
   * it. Both are availability bugs your customers see before you do.
   */
  getCalendarConnection(
    employeeId: string,
    options?: RequestOptions,
  ): Promise<CalendarConnection | null>;

  /**
   * Disconnect a calendar. `204`.
   *
   * @remarks
   * Deletes the credential and the busy data derived from it. Events this service wrote into the
   * calendar are **left in place** — that is the staff member's own record of their day.
   */
  disconnectCalendar(employeeId: string, options?: RequestOptions): Promise<void>;
}

/**
 * Bind the calendar methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCalendarMethods(cfg: ResolvedConfig): CalendarMethods {
  const calendar = (employeeId: string) =>
    `/v1/employees/${encodeURIComponent(employeeId)}/calendar`;

  return {
    authorizeCalendar: (employeeId, body, options = {}) =>
      call<CalendarAuthorization>(cfg, {
        method: "POST",
        path: `${calendar(employeeId)}/authorize`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getCalendarConnection: (employeeId, options = {}) =>
      callOrNull<CalendarConnection>(cfg, {
        method: "GET",
        path: calendar(employeeId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    disconnectCalendar: (employeeId, options = {}) =>
      call<void>(cfg, {
        method: "DELETE",
        path: calendar(employeeId),
        read: { kind: "none" },
        ...passInit(options),
      }),
  };
}
