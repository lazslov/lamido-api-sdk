/**
 * Dataset aggregate parameters, shared by the website tier and the client tier.
 *
 * @remarks
 * The same query surface answers both, and there is deliberately no arbitrary-expression form:
 * only fields the dataset's own schema declared `groupable` or `summable` may be named, and
 * anything else is a `400` rather than a sequential scan.
 */

import type { QueryInit } from "@lamido/api-core";
import type { RequestOptions } from "./options.js";

/**
 * One metric to compute.
 *
 * @remarks
 * `sum:<field>` needs a field the dataset declared `summable`; at most three per request.
 */
export type AggregateMetric = "count" | `sum:${string}`;

/** What to aggregate. Every parameter is optional; the defaults are the service's own. */
export interface AggregateQuery extends RequestOptions {
  /**
   * One field the dataset declared `groupable`.
   *
   * @remarks
   * Omitted gives a **single row with `key: null`** holding whole-dataset totals — and that row
   * exists even over zero records, so "how much in total?" answers `0` rather than an empty list.
   * A record *missing* the `groupBy` field also lands under `key: null` rather than being dropped:
   * invisible money is a harder bug than wrong money.
   */
  readonly groupBy?: string;
  /** Default `["count"]`. */
  readonly metrics?: readonly AggregateMetric[];
  /**
   * `field:value` equality filters, at most three, on `groupable` fields only.
   *
   * @remarks
   * Values are coerced to the field's declared type, so `"manual:false"` matches the boolean
   * `false` rather than the string.
   */
  readonly eq?: readonly string[];
  /** Inclusive lower bound on `occurredAt`, ISO 8601. `from` after `to` is a `400`. */
  readonly from?: string;
  /** Inclusive upper bound on `occurredAt`, ISO 8601. */
  readonly to?: string;
  /** 1–1000 here, default 100 — a group is a much smaller row than a page document. */
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Serialise aggregate parameters.
 *
 * @param query - The parameters, as a caller supplied them.
 * @returns Query parameters for the transport. `metrics` is comma-joined; `eq` is repeated.
 */
export function aggregateQuery(query: AggregateQuery = {}): QueryInit {
  return {
    groupBy: query.groupBy,
    metrics: query.metrics?.join(","),
    eq: query.eq,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
  };
}
