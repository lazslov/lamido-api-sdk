/**
 * `/v1/availability/rules` and `/v1/availability/exceptions` — working hours.
 *
 * @remarks
 * Rules are recurring weekly windows in the location's **wall-clock** time, resolved to instants
 * per occurrence — so 09:00 still says 09:00 on the morning the clocks change. Exceptions are
 * single dates that override them. Both are per staff member, and both lists take an
 * `employee_id` and nothing else, so neither is paginated.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callUnpaginated, passInit, type RequestOptions } from "../call.js";
import type {
  AvailabilityException,
  AvailabilityRule,
  CreateExceptionInput,
  CreateRuleInput,
  UpdateRuleInput,
} from "../types.js";

/** The working-hours part of a tenant client. */
export interface AvailabilityRuleMethods {
  /** One staff member's weekly rules. */
  listRules(employeeId: string, options?: RequestOptions): Promise<AvailabilityRule[]>;

  /**
   * Add a weekly working window.
   *
   * @throws {@link ../errors.js | BookingApiError} — a `400` for a rule that crosses midnight. Split
   * it in two.
   * @remarks
   * **`day_of_week` is `0` = Monday (ISO), through `6` = Sunday.** Getting this wrong shifts an
   * entire schedule by one day, and every slot will still look plausible. `effective_from` and
   * `effective_until` let a schedule change on a date without deleting the history behind it.
   */
  createRule(body: CreateRuleInput, options?: RequestOptions): Promise<AvailabilityRule>;

  /** Change a rule. */
  updateRule(
    publicId: string,
    body: UpdateRuleInput,
    options?: RequestOptions,
  ): Promise<AvailabilityRule>;

  /** Delete a rule. `204`. */
  deleteRule(publicId: string, options?: RequestOptions): Promise<void>;

  /** One staff member's date exceptions. */
  listExceptions(employeeId: string, options?: RequestOptions): Promise<AvailabilityException[]>;

  /**
   * Close a date, or open one outside normal hours.
   *
   * @remarks
   * `kind: "closed"` with no times closes the whole day; `kind: "open"` requires both times.
   * `location_id: null` applies to **all** of that employee's locations.
   */
  createException(
    body: CreateExceptionInput,
    options?: RequestOptions,
  ): Promise<AvailabilityException>;

  /** Delete an exception. `204`. */
  deleteException(publicId: string, options?: RequestOptions): Promise<void>;
}

/**
 * Bind the working-hours methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindAvailabilityRuleMethods(cfg: ResolvedConfig): AvailabilityRuleMethods {
  const rule = (id: string) => `/v1/availability/rules/${encodeURIComponent(id)}`;
  const exception = (id: string) => `/v1/availability/exceptions/${encodeURIComponent(id)}`;

  return {
    listRules: (employeeId, options = {}) =>
      callUnpaginated<AvailabilityRule>(cfg, {
        method: "GET",
        path: "/v1/availability/rules",
        query: { employee_id: employeeId },
        ...passInit(options),
      }),

    createRule: (body, options = {}) =>
      call<AvailabilityRule>(cfg, {
        method: "POST",
        path: "/v1/availability/rules",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    updateRule: (publicId, body, options = {}) =>
      call<AvailabilityRule>(cfg, {
        method: "PATCH",
        path: rule(publicId),
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    deleteRule: (publicId, options = {}) =>
      call<void>(cfg, {
        method: "DELETE",
        path: rule(publicId),
        read: { kind: "none" },
        ...passInit(options),
      }),

    listExceptions: (employeeId, options = {}) =>
      callUnpaginated<AvailabilityException>(cfg, {
        method: "GET",
        path: "/v1/availability/exceptions",
        query: { employee_id: employeeId },
        ...passInit(options),
      }),

    createException: (body, options = {}) =>
      call<AvailabilityException>(cfg, {
        method: "POST",
        path: "/v1/availability/exceptions",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    deleteException: (publicId, options = {}) =>
      call<void>(cfg, {
        method: "DELETE",
        path: exception(publicId),
        read: { kind: "none" },
        ...passInit(options),
      }),
  };
}
