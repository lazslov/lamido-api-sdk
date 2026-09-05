/**
 * `/v1/locations`, `/v1/services`, `/v1/employees` — the catalogue as its owner sees it.
 *
 * @remarks
 * The same shapes as the public tier plus `active`, the timestamps, the service buffers and the
 * employee's `email`. Deactivating a location, service or employee removes it from **future**
 * availability and leaves existing bookings standing — a closed shop still owes its customers an
 * answer.
 *
 * **An employee must be assigned to both the service and the location before any slot can
 * appear.** This is the single most common cause of "availability returns nothing".
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
  CreateEmployeeInput,
  CreateLocationInput,
  CreateServiceInput,
  Employee,
  Location,
  Service,
  UpdateEmployeeInput,
  UpdateLocationInput,
  UpdateServiceInput,
} from "../types.js";

/** A catalogue list, optionally filtered on `active`. */
export interface CatalogueListOptions extends ListOptions {
  /** Omitted, both active and inactive rows are listed. */
  readonly active?: boolean;
}

/** The catalogue part of a tenant client. */
export interface CatalogueMethods {
  /** Locations, newest first, keyset-paged. */
  listLocations(options?: CatalogueListOptions): Promise<CursorPage<Location>>;

  /**
   * Create a location.
   *
   * @throws {@link ../errors.js | BookingApiError} — a duplicate `slug` is a **`400`** with a JSON
   * Pointer, not a `409`: the `409` code set is closed, and a taken slug is a fact about your input.
   * @remarks
   * `timezone` must be `Europe/Budapest` — the only value this deployment accepts.
   */
  createLocation(body: CreateLocationInput, options?: RequestOptions): Promise<Location>;

  /** Read one location. A `404` throws — another tenant's id reads the same way. */
  getLocation(publicId: string, options?: RequestOptions): Promise<Location>;

  /** Change a location. **At least one field**; an empty body is a `400`. */
  updateLocation(
    publicId: string,
    body: UpdateLocationInput,
    options?: RequestOptions,
  ): Promise<Location>;

  /** Services at one location, keyset-paged. */
  listServices(locationId: string, options?: CatalogueListOptions): Promise<CursorPage<Service>>;

  /**
   * Create a service at a location.
   *
   * @throws {@link ../errors.js | BookingApiError} — a `400` for an unknown field. The body is
   * **strict**: a `buffer_after_minute` typo is refused rather than silently ignored, because
   * silently ignoring it double-books the calendar.
   * @remarks
   * `duration_minutes` is copied onto each booking at creation, so changing it later changes future
   * availability only. `price_minor` is a minor-unit string — `"4500"` is 4500 Ft in `HUF` — or
   * `null` for "not displayed", which is not zero.
   */
  createService(
    locationId: string,
    body: CreateServiceInput,
    options?: RequestOptions,
  ): Promise<Service>;

  /** Read one service. */
  getService(publicId: string, options?: RequestOptions): Promise<Service>;

  /** Change a service. */
  updateService(
    publicId: string,
    body: UpdateServiceInput,
    options?: RequestOptions,
  ): Promise<Service>;

  /** Staff, keyset-paged. */
  listEmployees(options?: CatalogueListOptions): Promise<CursorPage<Employee>>;

  /** Add a staff member. `email` is internal and never reaches the public tier. */
  createEmployee(body: CreateEmployeeInput, options?: RequestOptions): Promise<Employee>;

  /** Read one staff member. */
  getEmployee(publicId: string, options?: RequestOptions): Promise<Employee>;

  /** Change a staff member. */
  updateEmployee(
    publicId: string,
    body: UpdateEmployeeInput,
    options?: RequestOptions,
  ): Promise<Employee>;

  /** What one staff member performs. Not paginated. */
  listEmployeeServices(employeeId: string, options?: RequestOptions): Promise<Service[]>;

  /**
   * Say that a staff member performs a service. `204`, idempotent.
   *
   * @remarks
   * One of the two assignments a slot needs — the other is {@link CatalogueMethods.assignLocation}.
   */
  assignService(employeeId: string, serviceId: string, options?: RequestOptions): Promise<void>;

  /** Stop a staff member performing a service. `204`, idempotent. Existing bookings stand. */
  unassignService(employeeId: string, serviceId: string, options?: RequestOptions): Promise<void>;

  /** Where one staff member works. Not paginated. */
  listEmployeeLocations(employeeId: string, options?: RequestOptions): Promise<Location[]>;

  /**
   * Say that a staff member works at a location. `204`, idempotent.
   *
   * @remarks
   * Working hours are written per **(employee, location)** pair, so a rule for this pair is the
   * third thing a slot needs.
   */
  assignLocation(employeeId: string, locationId: string, options?: RequestOptions): Promise<void>;

  /** Stop a staff member working at a location. `204`, idempotent. */
  unassignLocation(employeeId: string, locationId: string, options?: RequestOptions): Promise<void>;
}

/**
 * Bind the catalogue methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCatalogueMethods(cfg: ResolvedConfig): CatalogueMethods {
  const location = (id: string) => `/v1/locations/${encodeURIComponent(id)}`;
  const service = (id: string) => `/v1/services/${encodeURIComponent(id)}`;
  const employee = (id: string) => `/v1/employees/${encodeURIComponent(id)}`;
  const listQuery = (options: CatalogueListOptions) => ({
    limit: options.limit,
    cursor: options.cursor,
    active: options.active,
  });

  /** `PUT` or `DELETE` an assignment: no body either way, `204` either way. */
  const assignment = (method: "PUT" | "DELETE", path: string, options: RequestOptions) =>
    call<void>(cfg, { method, path, read: { kind: "none" }, ...passInit(options) });

  return {
    listLocations: (options = {}) =>
      callCursorList<Location>(cfg, {
        method: "GET",
        path: "/v1/locations",
        query: listQuery(options),
        ...passInit(options),
      }),

    createLocation: (body, options = {}) =>
      call<Location>(cfg, {
        method: "POST",
        path: "/v1/locations",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getLocation: (publicId, options = {}) =>
      call<Location>(cfg, {
        method: "GET",
        path: location(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    updateLocation: (publicId, body, options = {}) =>
      call<Location>(cfg, {
        method: "PATCH",
        path: location(publicId),
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    listServices: (locationId, options = {}) =>
      callCursorList<Service>(cfg, {
        method: "GET",
        path: `${location(locationId)}/services`,
        query: listQuery(options),
        ...passInit(options),
      }),

    createService: (locationId, body, options = {}) =>
      call<Service>(cfg, {
        method: "POST",
        path: `${location(locationId)}/services`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getService: (publicId, options = {}) =>
      call<Service>(cfg, {
        method: "GET",
        path: service(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    updateService: (publicId, body, options = {}) =>
      call<Service>(cfg, {
        method: "PATCH",
        path: service(publicId),
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    listEmployees: (options = {}) =>
      callCursorList<Employee>(cfg, {
        method: "GET",
        path: "/v1/employees",
        query: listQuery(options),
        ...passInit(options),
      }),

    createEmployee: (body, options = {}) =>
      call<Employee>(cfg, {
        method: "POST",
        path: "/v1/employees",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getEmployee: (publicId, options = {}) =>
      call<Employee>(cfg, {
        method: "GET",
        path: employee(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    updateEmployee: (publicId, body, options = {}) =>
      call<Employee>(cfg, {
        method: "PATCH",
        path: employee(publicId),
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    listEmployeeServices: (employeeId, options = {}) =>
      callUnpaginated<Service>(cfg, {
        method: "GET",
        path: `${employee(employeeId)}/services`,
        ...passInit(options),
      }),

    assignService: (employeeId, serviceId, options = {}) =>
      assignment(
        "PUT",
        `${employee(employeeId)}/services/${encodeURIComponent(serviceId)}`,
        options,
      ),

    unassignService: (employeeId, serviceId, options = {}) =>
      assignment(
        "DELETE",
        `${employee(employeeId)}/services/${encodeURIComponent(serviceId)}`,
        options,
      ),

    listEmployeeLocations: (employeeId, options = {}) =>
      callUnpaginated<Location>(cfg, {
        method: "GET",
        path: `${employee(employeeId)}/locations`,
        ...passInit(options),
      }),

    assignLocation: (employeeId, locationId, options = {}) =>
      assignment(
        "PUT",
        `${employee(employeeId)}/locations/${encodeURIComponent(locationId)}`,
        options,
      ),

    unassignLocation: (employeeId, locationId, options = {}) =>
      assignment(
        "DELETE",
        `${employee(employeeId)}/locations/${encodeURIComponent(locationId)}`,
        options,
      ),
  };
}
