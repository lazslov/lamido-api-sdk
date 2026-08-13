/**
 * `/v1/datasets/*` — application data, not content.
 *
 * @remarks
 * A client site owns no datastore, so its donations, RSVPs and form submissions live here: one flat
 * row per record against a schema staff declared. No draft, no publish, no locale — a record is live
 * the moment it is written. **This is the only tier that creates records**, and no tier ever accepts
 * a write from a browser.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { type AggregateQuery, aggregateQuery } from "../aggregate.js";
import { call, callCursorList, callList, callOrNull, callUnpaginated } from "../call.js";
import { passInit, type RequestOptions } from "../options.js";
import type {
  AggregateGroup,
  ContentCursorList,
  DatasetRecord,
  DatasetSummary,
  DeleteResult,
  RecordData,
  RecordInsert,
} from "../types.js";

/** What a record insert carries. */
export interface NewRecord extends RequestOptions {
  /**
   * The dataset's own field keys. Flat, and `^[a-z][a-zA-Z0-9_]*$` — camelCase is legal here.
   *
   * @remarks
   * An unknown key is a `400`, never stripped: *a silently dropped `amountForintt` is a lost
   * donation*. Serialises to at most 8 KB — a record is a row, not a document.
   */
  readonly data: RecordData;
  /**
   * **The payment provider's own id**, 1–200 characters.
   *
   * @remarks
   * This is the idempotency key, and passing `crypto.randomUUID()` here — which is the autopilot
   * answer — defeats the entire mechanism: a uuid generated per attempt makes every retry a second
   * row. It is also not patchable, because changing it would let a replay insert a second row for a
   * payment that already counted.
   *
   * Omitted means "always insert": NULLs never collide in a unique index.
   */
  readonly external_id?: string;
  /**
   * The **event** time, ISO 8601 — not the write time.
   *
   * @remarks
   * What the list orders by and what `from`/`until` filter on. Required by this SDK rather than
   * defaulted to now, because a default would quietly make every backfilled record sort as if it had
   * happened at import. A donation's date is not the moment the webhook landed.
   */
  readonly occurred_at: string;
}

/** A partial update to one record. */
export interface RecordPatch extends RequestOptions {
  /** Merges key by key; `null` clears one. `required` is checked against the merged result. */
  readonly data?: RecordData;
  readonly occurred_at?: string;
}

/**
 * Options for the record list.
 *
 * @remarks
 * Keyset-paged, so there is a `cursor` and no `offset`. The list grows with your activity, and
 * it reports no `total` — the pager terminates on `nextCursor`.
 */
export interface RecordListOptions extends RequestOptions {
  /** `field:value` equality, at most three, on `groupable` fields only. */
  readonly eq?: readonly string[];
  /** Lower bound on `occurred_at`, **inclusive**, ISO 8601. */
  readonly from?: string;
  /**
   * Upper bound on `occurred_at`, **exclusive**, ISO 8601.
   *
   * @remarks
   * Renamed from `to` and its meaning changed with it. `to` was inclusive; `until` is not, so a
   * range that used to include midnight now stops just before it. Passing the old value unchanged
   * silently drops the final instant's rows.
   */
  readonly until?: string;
  /** 1–200, default 50. */
  readonly limit?: number;
  /** An opaque cursor from a previous page's `nextCursor`. Never construct one. */
  readonly cursor?: string;
}

/** Options for reading one record. */
export interface RecordOptions extends RequestOptions {
  /**
   * Include `sensitive` values.
   *
   * @remarks
   * The only way a sensitive value reaches a response, and **the read is audited**
   * (`record.read_sensitive`) — a deliberate exception to "reads are not audited", because looking up
   * a donor's details is an event someone may later need to account for. Never a default.
   */
  readonly includeSensitive?: boolean;
}

/** The dataset half of a client-tier client. */
export interface DatasetMethods {
  /** Every dataset definition, with its `record_count`. Unpaginated. */
  listDatasets(options?: RequestOptions): Promise<DatasetSummary[]>;

  /**
   * Insert a record, idempotently on `external_id`.
   *
   * @returns The record, and `created: false` when it already existed.
   * @remarks
   * **A redelivered webhook is a success, not a `409`.** The caller wanted the record to exist and it
   * does; an error would make a payment provider retry forever. Uniqueness is enforced by a database
   * constraint rather than by application code, so two concurrent deliveries cannot race into two
   * rows.
   */
  createRecord(key: string, record: NewRecord): Promise<RecordInsert>;

  /**
   * List records, newest `occurred_at` first.
   *
   * @remarks
   * **Sensitive values are withheld entirely here** — `record.withheld` names the keys that are set
   * but not returned, so "withheld" and "never set" stay distinguishable. There is one door to the
   * values themselves, {@link DatasetMethods.getRecord} with `includeSensitive`.
   *
   * A record list is donor PII. The SDK ships no convenience that logs or serialises one.
   */
  getRecords(key: string, options?: RecordListOptions): Promise<ContentCursorList<DatasetRecord>>;

  /**
   * One record.
   *
   * @returns The record, or `null` when it is unknown, deleted, or belongs to another site.
   */
  getRecord(key: string, id: string, options?: RecordOptions): Promise<DatasetRecord | null>;

  /** Update one record. `external_id` is stripped from the body by the service, on purpose. */
  patchRecord(key: string, id: string, patch: RecordPatch): Promise<DatasetRecord>;

  /**
   * Hard delete one record.
   *
   * @remarks
   * There is no archive for a record — it is data, not an editorial draft — and no backup but the
   * database's own. Audited.
   */
  deleteRecord(key: string, id: string, options?: RequestOptions): Promise<DeleteResult>;

  /**
   * Grouped counts and sums over a dataset.
   *
   * @remarks
   * A total comes from here and **never from a stored counter**: one call, and it cannot drift from
   * the records it summarises. Unlike the website tier's aggregate there is no `publicAggregate` gate,
   * so a `404` here means the dataset key is wrong and throws rather than answering `null`.
   */
  getDatasetAggregate(key: string, query?: AggregateQuery): Promise<AggregateGroup[]>;
}

/**
 * Bind the dataset methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindDatasetMethods(cfg: ResolvedConfig): DatasetMethods {
  const records = (key: string) => `/v1/datasets/${encodeURIComponent(key)}/records`;

  return {
    listDatasets: (options = {}) =>
      callUnpaginated<DatasetSummary>(cfg, {
        method: "GET",
        path: "/v1/datasets",
        ...passInit(options),
      }),

    async createRecord(key, record) {
      // `created` rides BESIDE the record now rather than wrapping it, so the body is the record
      // with one extra member. Note the trap the contract itself calls out: a record's own payload
      // member is also called `data`, and it is the record's data, never an envelope.
      const { created, ...inserted } = await call<DatasetRecord & { created: boolean }>(cfg, {
        method: "POST",
        path: records(key),
        body: {
          data: record.data,
          occurred_at: record.occurred_at,
          ...(record.external_id === undefined ? {} : { external_id: record.external_id }),
        },
        read: { kind: "raw" },
        ...passInit(record),
      });
      return { record: inserted as DatasetRecord, created };
    },

    getRecords: (key, options = {}) =>
      callCursorList<DatasetRecord>(cfg, {
        method: "GET",
        path: records(key),
        query: {
          eq: options.eq,
          from: options.from,
          until: options.until,
          limit: options.limit,
          cursor: options.cursor,
        },
        ...passInit(options),
      }),

    getRecord: (key, id, options = {}) =>
      callOrNull<DatasetRecord>(cfg, {
        method: "GET",
        path: `${records(key)}/${encodeURIComponent(id)}`,
        query: { include: options.includeSensitive ? "sensitive" : undefined },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    patchRecord: (key, id, patch) =>
      call<DatasetRecord>(cfg, {
        method: "PATCH",
        path: `${records(key)}/${encodeURIComponent(id)}`,
        body: {
          ...(patch.data === undefined ? {} : { data: patch.data }),
          ...(patch.occurred_at === undefined ? {} : { occurred_at: patch.occurred_at }),
        },
        read: { kind: "raw" },
        ...passInit(patch),
      }),

    deleteRecord: (key, id, options = {}) =>
      call<DeleteResult>(cfg, {
        method: "DELETE",
        path: `${records(key)}/${encodeURIComponent(id)}`,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async getDatasetAggregate(key, query = {}) {
      const page = await callList<AggregateGroup>(cfg, {
        method: "GET",
        path: `/v1/datasets/${encodeURIComponent(key)}/aggregate`,
        query: aggregateQuery(query),
        ...passInit(query),
      });
      return page.items;
    },
  };
}
