/**
 * `/api/client/datasets/*` — application data, not content.
 *
 * @remarks
 * A client site owns no datastore, so its donations, RSVPs and form submissions live here: one flat
 * row per record against a schema staff declared. No draft, no publish, no locale — a record is live
 * the moment it is written. **This is the only tier that creates records**, and no tier ever accepts
 * a write from a browser.
 */

import type { ResolvedConfig } from "@lamido/api-core";
import { type AggregateQuery, aggregateQuery } from "../aggregate.js";
import { call, callList, callOrNull } from "../call.js";
import { passInit, type RequestOptions } from "../options.js";
import type {
  AggregateGroup,
  ContentList,
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
  readonly externalId?: string;
  /**
   * The **event** time, ISO 8601 — not the write time.
   *
   * @remarks
   * What the list orders by and what `from`/`to` filter on. Required by this SDK rather than
   * defaulted to now, because a default would quietly make every backfilled record sort as if it had
   * happened at import. A donation's date is not the moment the webhook landed.
   */
  readonly occurredAt: string;
}

/** A partial update to one record. */
export interface RecordPatch extends RequestOptions {
  /** Merges key by key; `null` clears one. `required` is checked against the merged result. */
  readonly data?: RecordData;
  readonly occurredAt?: string;
}

/** Options for the record list. */
export interface RecordListOptions extends RequestOptions {
  /** `field:value` equality, at most three, on `groupable` fields only. */
  readonly eq?: readonly string[];
  /** Inclusive ISO 8601 bounds on `occurredAt`. */
  readonly from?: string;
  readonly to?: string;
  /** 1–100, default 20. */
  readonly limit?: number;
  readonly offset?: number;
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
  /** Every dataset definition, with its `recordCount`. Unpaginated. */
  listDatasets(options?: RequestOptions): Promise<DatasetSummary[]>;

  /**
   * Insert a record, idempotently on `externalId`.
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
   * List records, newest `occurredAt` first.
   *
   * @remarks
   * **Sensitive values are withheld entirely here** — `record.withheld` names the keys that are set
   * but not returned, so "withheld" and "never set" stay distinguishable. There is one door to the
   * values themselves, {@link DatasetMethods.getRecord} with `includeSensitive`.
   *
   * A record list is donor PII. The SDK ships no convenience that logs or serialises one.
   */
  getRecords(key: string, options?: RecordListOptions): Promise<ContentList<DatasetRecord>>;

  /**
   * One record.
   *
   * @returns The record, or `null` when it is unknown, deleted, or belongs to another site.
   */
  getRecord(key: string, id: string, options?: RecordOptions): Promise<DatasetRecord | null>;

  /** Update one record. `externalId` is stripped from the body by the service, on purpose. */
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
  const records = (key: string) => `/api/client/datasets/${encodeURIComponent(key)}/records`;

  return {
    listDatasets: (options = {}) =>
      call<DatasetSummary[]>(cfg, {
        method: "GET",
        path: "/api/client/datasets",
        read: { kind: "data" },
        ...passInit(options),
      }),

    async createRecord(key, record) {
      // The envelope, not `data`: `created` is a sibling of it and is the whole point of the call.
      const answer = await call<{ data: DatasetRecord; created: boolean }>(cfg, {
        method: "POST",
        path: records(key),
        body: {
          data: record.data,
          occurredAt: record.occurredAt,
          ...(record.externalId === undefined ? {} : { externalId: record.externalId }),
        },
        read: { kind: "envelope" },
        ...passInit(record),
      });
      return { record: answer.data, created: answer.created };
    },

    getRecords: (key, options = {}) =>
      callList<DatasetRecord>(cfg, {
        method: "GET",
        path: records(key),
        query: {
          eq: options.eq,
          from: options.from,
          to: options.to,
          limit: options.limit,
          offset: options.offset,
        },
        ...passInit(options),
      }),

    getRecord: (key, id, options = {}) =>
      callOrNull<DatasetRecord>(cfg, {
        method: "GET",
        path: `${records(key)}/${encodeURIComponent(id)}`,
        query: { include: options.includeSensitive ? "sensitive" : undefined },
        read: { kind: "data" },
        ...passInit(options),
      }),

    patchRecord: (key, id, patch) =>
      call<DatasetRecord>(cfg, {
        method: "PATCH",
        path: `${records(key)}/${encodeURIComponent(id)}`,
        body: {
          ...(patch.data === undefined ? {} : { data: patch.data }),
          ...(patch.occurredAt === undefined ? {} : { occurredAt: patch.occurredAt }),
        },
        read: { kind: "data" },
        ...passInit(patch),
      }),

    deleteRecord: (key, id, options = {}) =>
      call<DeleteResult>(cfg, {
        method: "DELETE",
        path: `${records(key)}/${encodeURIComponent(id)}`,
        read: { kind: "data" },
        ...passInit(options),
      }),

    getDatasetAggregate: (key, query = {}) =>
      call<AggregateGroup[]>(cfg, {
        method: "GET",
        path: `/api/client/datasets/${encodeURIComponent(key)}/aggregate`,
        query: aggregateQuery(query),
        read: { kind: "data" },
        ...passInit(query),
      }),
  };
}
