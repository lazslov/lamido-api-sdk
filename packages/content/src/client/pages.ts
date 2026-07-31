/**
 * `/api/client/pages/*` — draft values, publish, revert, versions and preview.
 *
 * @remarks
 * The write surface is deliberately granular. A whole-document save is last-write-wins by
 * construction: the form loaded, something else changed, and Save writes the stale copy back over
 * it. In the build this package is distilled from, that wrote a form's stale counter over a payment
 * recorded *after* the form loaded, and a public fundraising bar read 0% against a 6.2M goal while
 * 3.18M was actually recorded. So the unit is one field per key in a values `PATCH`, and there is
 * no method here that writes a whole document.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callList } from "../call.js";
import { type LocaleOptions, passInit, type RequestOptions } from "../options.js";
import { type PublishedPage, toPublishedPage } from "../page.js";
import type {
  ClientPage,
  ContentList,
  ContentValue,
  ContentView,
  PageDocument,
  PageStructure,
  PageVersion,
  PublishResult,
  RestoreResult,
  RevertResult,
  VersionSummary,
} from "../types.js";

/** Options for a rendered read, which is the one place a draft view is available. */
export interface RenderedPageOptions extends LocaleOptions {
  /**
   * `"draft"` or `"published"`; the service defaults to `published`.
   *
   * @remarks
   * A draft read **falls back to the published value** for any field the draft never touched, so it
   * is a superset of a published read and one set of components renders both. A null draft value
   * means "not edited", not "blanked".
   */
  readonly view?: ContentView;
}

/** Options for a publish. */
export interface PublishOptions extends LocaleOptions {
  /** 1–500 characters, shown in the version history. Worth writing: it is the only note there is. */
  readonly note?: string;
}

/**
 * Options for the version list.
 *
 * @remarks
 * No locale: `page_versions` has no locale column, which is also why restoring a non-default locale
 * is unsupported.
 */
export interface PageListOptions extends RequestOptions {
  /** 1–100, default 20. Out of range is a `400`, never a clamp. */
  readonly limit?: number;
  /** ≥ 0, default 0. */
  readonly offset?: number;
}

/** The page half of a client-tier client. */
export interface PageMethods {
  /**
   * Every page of this site, in `position` order, including inactive ones.
   *
   * @remarks
   * Unpaginated — a site has single-digit pages. Inactive pages are here and absent from the
   * website tier: staff switch one off to stage it, and it stays editable meanwhile.
   */
  listPages(options?: RequestOptions): Promise<ClientPage[]>;

  /**
   * The **structure** tree: which fields exist, of what type, in what order.
   *
   * @param slug - The page slug.
   * @remarks
   * Structure and content are two requests on purpose, so the rendered document stays byte-identical
   * to what the public tier serves. Read this **once** — at build time or into a descriptor table —
   * and never per render: it needs a secret key and answers `no-store`, and a document carries values
   * but no types, so nothing in a page payload says which string is `richtext`.
   *
   * It includes **inactive** sections, which the rendered document does not. Writing a value into
   * one is allowed, and its `required` fields do not block a publish.
   */
  getPageStructure(slug: string, options?: RequestOptions): Promise<PageStructure>;

  /**
   * The page document, draft or published.
   *
   * @param slug - The page slug.
   * @param options - `view`, locale, `init`.
   * @remarks
   * Identical in shape to the website tier's read, which is what lets a preview route render through
   * the production components. Uncached by the service (`no-store` for a draft), because an editor
   * reading their own draft through a cache sees their edit missing and presses Save again.
   */
  getRenderedPage(slug: string, options?: RenderedPageOptions): Promise<PublishedPage>;

  /**
   * Save draft values, one key per field.
   *
   * @param slug - The page slug.
   * @param values - Keyed `"<sectionKey>.<fieldKey>"`, at most 500 keys. Build it with
   * `prepareValues` from `@lazslov/content/fields`, which returns exactly this shape.
   * @param options - Locale, `init`.
   * @returns The updated **draft** document, so an optimistic UI reconciles in one round trip.
   * @remarks
   * Merges key by key, so send only what changed, and **make no call at all when nothing did** — an
   * empty map is a `400`, and more importantly a save is usually followed by a publish that carries
   * every other pending draft on the page live.
   *
   * Only the draft moves; a save never touches what is live. A `null` value discards the draft for
   * that field and the row keeps its published value — to publish an *empty* field, send `""`. There
   * is deliberately no way to make a live value vanish.
   *
   * An unknown key is a `400` with `details.unknownKeys`, not a silent strip: a stripped
   * `"hero.titel"` loses the editor's new headline behind a `200 OK`.
   */
  patchValues(
    slug: string,
    values: Record<string, ContentValue>,
    options?: LocaleOptions,
  ): Promise<PublishedPage>;

  /**
   * Publish a page's drafts.
   *
   * @param slug - The page slug.
   * @param options - `note`, locale, `init`.
   * @returns The new version, and the document that went live.
   * @throws {@link ../errors.js | ContentApiError} `conflict` with `details.missing` when a required
   * field of an **active** section would publish empty — checked at publish, not at save, because an
   * editor must be able to save half-finished work. A `conflict` with no `missing` is the lost
   * publish race and is `retryable` **after reloading**.
   * @remarks
   * **Publish is per PAGE, not per section.** Every section of a page shares one document, so
   * publishing one section publishes every unpublished draft on that page. That is the single most
   * surprising behaviour in the service and the SDK cannot make it safer — only visible: this method
   * is named for what it does, there is no `publishSection`, and {@link PageMethods.diffDrafts}
   * exists so a UI can warn *"3 other sections have unpublished changes"* first.
   *
   * Omitting `locale` publishes every locale of the site, but the version snapshot is one — the
   * default locale's — so restoring a non-default locale is not supported.
   */
  publishPage(slug: string, options?: PublishOptions): Promise<PublishResult>;

  /**
   * Discard drafts, restoring them to what is published.
   *
   * @remarks
   * Writes no version row on purpose: nothing went live, so there is nothing to record in the
   * history of what the website served.
   */
  revertPage(slug: string, options?: LocaleOptions): Promise<RevertResult>;

  /** Version history, newest first. Carries no documents — read one with {@link getVersion}. */
  listVersions(slug: string, options?: PageListOptions): Promise<ContentList<VersionSummary>>;

  /**
   * One frozen version, including the raw values a restore works from.
   *
   * @param version - A positive integer. `abc` is a `400`, so it never reads as "no such version".
   */
  getVersion(slug: string, version: number, options?: RequestOptions): Promise<PageVersion>;

  /**
   * Restore a version **into the draft**.
   *
   * @returns What was restored, and `skipped` — fields the snapshot has that the structure no longer
   * does. Show `skipped`: dropping it silently means an editor believes a restore was complete when
   * it was not.
   * @remarks
   * Not "make live". There is exactly one path to live content, so a restore still needs a publish
   * afterwards, and the result is version N+1 whose document equals version M.
   */
  restoreVersion(slug: string, version: number, options?: LocaleOptions): Promise<RestoreResult>;

  /**
   * Which value keys differ between the draft and the published document.
   *
   * @param slug - The page slug.
   * @returns `"<sectionKey>.<fieldKey>"` for each pending change, in document order.
   * @remarks
   * The companion to {@link PageMethods.publishPage}: because a publish takes the whole page, a UI
   * that saves section by section has to be able to say what *else* is about to go live. Two reads,
   * both uncached, compared here rather than in the service — which offers no such endpoint.
   *
   * A field the draft does not carry is not reported: a null draft value means "not edited", and the
   * service falls it back to the published one.
   */
  diffDrafts(slug: string, options?: LocaleOptions): Promise<string[]>;
}

/**
 * Bind the page methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindPageMethods(cfg: ResolvedConfig): PageMethods {
  const base = (slug: string) => `/api/client/pages/${encodeURIComponent(slug)}`;

  const rendered = (slug: string, options: RenderedPageOptions) =>
    call<PageDocument>(cfg, {
      method: "GET",
      path: `/api/client/rendered/pages/${encodeURIComponent(slug)}`,
      query: { view: options.view, locale: options.locale },
      read: { kind: "data" },
      ...passInit(options),
    });

  return {
    listPages: (options = {}) =>
      call<ClientPage[]>(cfg, {
        method: "GET",
        path: "/api/client/pages",
        read: { kind: "data" },
        ...passInit(options),
      }),

    getPageStructure: (slug, options = {}) =>
      call<PageStructure>(cfg, {
        method: "GET",
        path: base(slug),
        read: { kind: "data" },
        ...passInit(options),
      }),

    async getRenderedPage(slug, options = {}) {
      return toPublishedPage(await rendered(slug, options));
    },

    async patchValues(slug, values, options = {}) {
      const document = await call<PageDocument>(cfg, {
        method: "PATCH",
        path: `${base(slug)}/values`,
        body: { values, ...(options.locale ? { locale: options.locale } : {}) },
        read: { kind: "data" },
        ...passInit(options),
      });
      return toPublishedPage(document);
    },

    publishPage: (slug, options = {}) =>
      call<PublishResult>(cfg, {
        method: "POST",
        path: `${base(slug)}/publish`,
        body: {
          ...(options.note === undefined ? {} : { note: options.note }),
          ...(options.locale === undefined ? {} : { locale: options.locale }),
        },
        read: { kind: "data" },
        ...passInit(options),
      }),

    revertPage: (slug, options = {}) =>
      call<RevertResult>(cfg, {
        method: "POST",
        path: `${base(slug)}/revert`,
        body: options.locale === undefined ? {} : { locale: options.locale },
        read: { kind: "data" },
        ...passInit(options),
      }),

    listVersions: (slug, options = {}) =>
      callList<VersionSummary>(cfg, {
        method: "GET",
        path: `${base(slug)}/versions`,
        query: { limit: options.limit, offset: options.offset },
        ...passInit(options),
      }),

    getVersion: (slug, version, options = {}) =>
      call<PageVersion>(cfg, {
        method: "GET",
        path: `${base(slug)}/versions/${version}`,
        read: { kind: "data" },
        ...passInit(options),
      }),

    restoreVersion: (slug, version, options = {}) =>
      call<RestoreResult>(cfg, {
        method: "POST",
        path: `${base(slug)}/versions/${version}/restore`,
        body: options.locale === undefined ? {} : { locale: options.locale },
        read: { kind: "data" },
        ...passInit(options),
      }),

    async diffDrafts(slug, options = {}) {
      const [draft, published] = await Promise.all([
        rendered(slug, { ...options, view: "draft" }),
        rendered(slug, { ...options, view: "published" }),
      ]);
      return pendingKeys(draft, published);
    },
  };
}

/**
 * Value keys whose draft differs from what is published.
 *
 * @remarks
 * Compared by serialisation: both documents come from the same builder, so key order is stable, and
 * a structural walk here would be a second definition of equality for the field layer's `sameValue`
 * to disagree with.
 */
function pendingKeys(draft: PageDocument, published: PageDocument): string[] {
  const live = new Map(published.sections.map((section) => [section.key, section.fields]));

  const pending: string[] = [];
  for (const section of draft.sections) {
    const liveFields = live.get(section.key) ?? {};
    for (const [key, value] of Object.entries(section.fields)) {
      if (JSON.stringify(value) !== JSON.stringify(liveFields[key])) {
        pending.push(`${section.key}.${key}`);
      }
    }
  }
  return pending;
}
