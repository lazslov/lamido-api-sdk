/**
 * `@lazslov/content` — consumer SDK for content-service.
 *
 * @remarks
 * Two tiers, two constructors, because there are two credentials with different blast radii:
 *
 * - {@link createWebsiteClient} reads **published** content through `/v1/public/*` with a `cpk_`
 *   publishable key (browser-safe) or a `csk_` secret key (not).
 * - {@link createContentClient} reads drafts and writes through `/v1/*` with a `csk_` key,
 *   server-side only.
 *
 * The admin tier is deliberately absent: structure is defined by Lamido staff, not by an editor, and
 * a `cad_` key reaches every site.
 *
 * The field-descriptor layer — the types, the coercions and `prepareValues` — lives in
 * `@lazslov/content/fields`, which imports nothing and is safe in a client component.
 *
 * @example
 * ```ts
 * import "server-only";
 * import { createWebsiteClient } from "@lazslov/content";
 * import { asImage, asText } from "@lazslov/content/fields";
 *
 * const content = createWebsiteClient();
 * const page = await content.getPage("home");           // null when unpublished
 * const hero = page?.section("hero") ?? { fields: {} };  // never null for a missing section
 * const title = asText(hero.fields, "title");            // "" rather than undefined
 * ```
 */

export type { AggregateMetric, AggregateQuery } from "./aggregate.js";
export type { AssetMethods, AssetRegistration, UploadTokenRequest } from "./client/assets.js";
export type {
  CollectionMethods,
  ItemListOptions,
  ItemOptions,
  ItemPatch,
  NewItem,
  ReorderOptions,
} from "./client/collections.js";
export {
  type ContentClient,
  createContentClient,
  tryCreateContentClient,
} from "./client/create.js";
export type {
  DatasetMethods,
  NewRecord,
  RecordListOptions,
  RecordOptions,
  RecordPatch,
} from "./client/datasets.js";
export type { IdentityMethods } from "./client/identity.js";
export type {
  PageListOptions,
  PageMethods,
  PublishOptions,
  RenderedPageOptions,
} from "./client/pages.js";
export { ContentApiError, type ContentErrorDetails } from "./errors.js";
export type {
  CursorListOptions,
  ListOptions,
  LocaleOptions,
  RequestOptions,
} from "./options.js";
export type { PageSection, PublishedPage } from "./page.js";
export type {
  AggregateGroup,
  ClientIdentity,
  ClientPage,
  CollectionItem,
  CollectionSummary,
  ContentAsset,
  ContentCursorList,
  ContentDocument,
  ContentHealth,
  ContentImage,
  ContentList,
  ContentRow,
  ContentSite,
  ContentValue,
  ContentView,
  DatasetRecord,
  DatasetSummary,
  DeleteResult,
  ImageContentType,
  ItemStatus,
  PageDocument,
  PageDocumentSection,
  PageStructure,
  PageVersion,
  PublishedPageSummary,
  PublishResult,
  RecordData,
  RecordInsert,
  RestoreResult,
  RevertResult,
  UploadToken,
  VersionSummary,
} from "./types.js";
export { assetId, recordId } from "./types.js";
export {
  type ContentEvent,
  type ContentEventTenant,
  type ContentWebhookInput,
  type ContentWebhookVerdict,
  deliveryIdHeader,
  eventIdHeader,
  type KnownContentEventType,
  signatureHeader,
  subjectOf,
  timestampHeader,
  verifyContentWebhook,
} from "./webhook.js";
export {
  createWebsiteClient,
  tryCreateWebsiteClient,
} from "./website/create.js";
export type { WebsiteClient } from "./website/reads.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees
 * with the tarball it came from.
 */
export const VERSION = "1.0.0";
