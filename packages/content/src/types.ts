/**
 * Named aliases over the generated contract, plus the shapes the SDK adds on top of it.
 *
 * @remarks
 * Every wire shape here is an alias of `src/generated/schema.ts`, never a hand-copied interface:
 * a contract change then breaks the build instead of drifting quietly past it. What the aliases
 * add is a name a consumer can import and the behaviour the OpenAPI document cannot express — a
 * nullable return, a status that is not an error, a field that is deliberately absent.
 */

import type { components } from "./generated/schema.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

export type { ContentDocument, ContentImage, ContentRow } from "./fields/types.js";

/**
 * A page's content, in the one shape it is ever served in.
 *
 * @remarks
 * The public read, the draft preview and a frozen version all use it — a draft read is a superset
 * of a published one, so one set of components renders both and preview cannot drift from live.
 * Use {@link ../page.js | toPublishedPage}'s result rather than this raw shape where you want
 * {@link PublishedPage.section}.
 */
export type PageDocument = Schemas["PageDocument"];

/** One section of a page document: its key, its structural type, and its field values. */
export type PageDocumentSection = PageDocument["sections"][number];

/** One value as it goes **onto** the wire. An `image` is written as `{ assetId, alt }`. */
export type ContentValue = Schemas["ContentValue"];

/**
 * An entry of the published page list — a site's sitemap input.
 *
 * @remarks
 * Members are snake_case, like everything else on the wire since the service's 2026-08 sync.
 * The list itself is not paginated: a site has single-digit pages.
 */
export interface PublishedPageSummary {
  readonly slug: string;
  readonly title: string;
  /** Never `null` here: a page that has never been published is absent from the list. */
  readonly version: number;
  readonly published_at: string;
}

/** Site identity and chrome, as the website tier serves it. */
export type ContentSite = Schemas["PublicSite"];

/** A collection item. The same shape on every tier, with `status` always `published` publicly. */
export type CollectionItem = Schemas["Item"];

/** Which lifecycle state an item is in. `archived` is the editor-facing "remove". */
export type ItemStatus = Schemas["ItemStatus"];

/** Which view of an item's or a page's values to read. */
export type ContentView = "draft" | "published";

/** One group of a dataset aggregate. `key` is `null` for the ungrouped total. */
export type AggregateGroup = Schemas["AggregateGroup"];

/**
 * A dataset record. Written by a site's backend at runtime, never by an editor.
 *
 * @remarks
 * **The service's own documentation contradicts itself about this resource's identity.**
 * `client-api.md` states a RULE — *"a record is identified by `public_id`, not `id`… it has no
 * `id` member at all"* — and its example carries `public_id`. The OpenAPI schema declares `id`
 * and no `public_id`.
 *
 * Both are declared here, both optional, until the service settles it. Reading whichever one
 * happens to be absent would otherwise be `undefined` at runtime with no type error — and the id
 * is what every later call to this record needs. Use {@link recordId} rather than either field.
 */
export type DatasetRecord = Omit<Schemas["Record"], "id"> & {
  /** Present per the OpenAPI schema. */
  readonly id?: string;
  /** Present per `client-api.md`'s rule and its example. */
  readonly public_id?: string;
};

/**
 * The id of a record, whichever member carries it.
 *
 * @param record - A record from any read.
 * @returns The id.
 * @throws `TypeError` when neither member is present, which would mean the contract moved again.
 * @remarks
 * Exists only because the service's documentation disagrees with its own schema — see
 * {@link DatasetRecord}. Once that is settled this collapses to a field read, and the change is a
 * deprecation rather than a break.
 */
export function recordId(record: DatasetRecord): string {
  const id = record.public_id ?? record.id;
  if (id === undefined) {
    throw new TypeError(
      "a dataset record carried neither public_id nor id — the content-service contract has moved",
    );
  }
  return id;
}

/** A record's payload: flat, and its keys are camelCase-legal unlike every addressing key. */
export type RecordData = Schemas["RecordData"];

/**
 * A registered image. `references: 0` means it is safe to delete.
 *
 * @remarks
 * Carries the same documented-versus-schema identity contradiction as {@link DatasetRecord}:
 * `client-api.md` rules that *"an asset is identified by `public_id`, not `id`… there is no `id`
 * member on an asset object at all"*, and the OpenAPI schema declares `id`. Use {@link assetId}.
 */
export type ContentAsset = Omit<Schemas["Asset"], "id"> & {
  /** Present per the OpenAPI schema. */
  readonly id?: string;
  /** Present per `client-api.md`'s rule and its example. */
  readonly public_id?: string;
};

/**
 * The id of an asset, whichever member carries it.
 *
 * @param asset - An asset from any read.
 * @returns The id, which is what the `/v1/assets/:id` path parameter takes.
 * @throws `TypeError` when neither member is present.
 * @remarks
 * See {@link ContentAsset}. Note that the path parameter is spelled `:id` under either reading —
 * the service documents that too.
 */
export function assetId(asset: ContentAsset): string {
  const id = asset.public_id ?? asset.id;
  if (id === undefined) {
    throw new TypeError(
      "an asset carried neither public_id nor id — the content-service contract has moved",
    );
  }
  return id;
}

/** The four image types the service accepts. SVG is deliberately excluded. */
export type ImageContentType = Schemas["ImageContentType"];

/** The health body. Read it on a `503` too — that is where the reason is. */
export type ContentHealth = Schemas["Health"];

/** The structure tree: which fields exist, of what type, in what order. */
export type PageStructure = Schemas["PageTree"];

/** One entry of a page's version history. Carries no document. */
export type VersionSummary = Schemas["VersionSummary"];

/** One frozen version, including the raw values a restore works from. */
export type PageVersion = Schemas["Version"];

/** A collection definition plus its item counts by status. */
export type CollectionSummary = Schemas["CollectionSummary"];

/** A dataset definition. `recordCount` is present on the list endpoint. */
export type DatasetSummary = Schemas["Dataset"];

/** A page as the client tier lists it, including inactive ones. */
export type ClientPage = Schemas["Page"];

/** This key's site and key metadata — what `getMe` answers, for a boot-time check. */
export interface ClientIdentity {
  readonly site: Schemas["Site"];
  readonly key: Schemas["SiteKey"];
}

/**
 * One page of a `limit`/`offset` list — the bounded, staff-curated ones.
 *
 * @remarks
 * `items` rather than `data`, and the siblings alongside it, so the shape satisfies
 * `@lazslov/api-core`'s `collectAll` without an adapter — a list read without its `total` cannot
 * be paged to the end.
 *
 * Collection items, page versions and sites. An out-of-range `limit` is a `400` on these
 * endpoints rather than a clamp, and the ceiling is 100.
 */
export interface ContentList<T> {
  readonly items: T[];
  /** Absent where the endpoint does not report one. **Never `null`.** */
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One page of a keyset-cursor list — the ones that grow with your activity.
 *
 * @remarks
 * Dataset records, assets, the audit trail and the publish outbox. Satisfies
 * `@lazslov/api-core`'s `collectAllCursor` without an adapter.
 *
 * There is no `total`: counting a filtered, unbounded table on every page is not cheap, and the
 * pager terminates on `nextCursor` instead. A short page is **not** the last one.
 */
export interface ContentCursorList<T> {
  readonly items: T[];
  /**
   * The next cursor, or `null` on the last page.
   *
   * @remarks
   * Opaque. Pass it back verbatim and never construct, parse or store one — the encoding is free
   * to change, and a malformed cursor is a `400` rather than a quiet restart from page one.
   */
  readonly nextCursor: string | null;
}

/** What a publish did. */
export interface PublishResult {
  readonly version: number;
  readonly note: string | null;
  /** `"<siteSlug>/<keyLabel>"` — the key is the actor; this service has no users. */
  readonly published_by: string;
  readonly created_at: string;
  /** Every locale the publish covered. Omitting `locale` publishes all of them. */
  readonly locales: string[];
  readonly document: PageDocument;
}

/**
 * What a restore brought back, and what it could not.
 *
 * @remarks
 * `skipped` is not optional to read, and a UI must show it: it names a field the snapshot has that
 * the structure no longer does. Dropping it silently means an editor believes a restore was
 * complete when it was not, publishes, and is never told which paragraph is missing.
 *
 * A restore writes the **draft**. It is not "make live" — there is exactly one path to live
 * content, so a restore still needs a publish.
 */
export interface RestoreResult {
  readonly restored: string[];
  readonly skipped: string[];
  readonly document: PageDocument;
}

/**
 * What a revert did.
 *
 * @remarks
 * No version row: nothing went live, so there is nothing to record in the history of what the
 * website has actually served.
 */
export interface RevertResult {
  readonly locales: string[];
  readonly document: PageDocument;
}

/** The capability step 1 of an upload mints. The token reaches the browser; the key never does. */
export interface UploadToken {
  /** Hand this to `@vercel/blob/client`'s `upload()`. Valid for 15 minutes, for one pathname. */
  readonly token: string;
  /**
   * The pathname the token asked for.
   *
   * @remarks
   * **Not** what to register in step 3: Blob appends a random suffix, so register what the upload
   * returned. See `registerAsset`'s `blobPathname`.
   */
  readonly pathname: string;
  readonly allowed_content_types: ImageContentType[];
  readonly maximum_size_in_bytes: number;
}

/**
 * The outcome of a record insert.
 *
 * @remarks
 * `created: false` is a **success** — the record existed already, because inserts are idempotent
 * on `externalId`. A redelivered payment webhook lands here, and treating it as an error is how a
 * provider ends up retrying forever.
 */
export interface RecordInsert {
  readonly record: DatasetRecord;
  readonly created: boolean;
}

/** What a hard delete reports. */
export interface DeleteResult {
  readonly id: string;
  readonly deleted: boolean;
  /** Asset deletes only: `false` means the row went and the object is left for the GC CLI. */
  readonly blobDeleted?: boolean;
  /** Item deletes only: `true` when `?force=` skipped the reference check. */
  readonly forced?: boolean;
}
