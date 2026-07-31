/**
 * The page accessor: the read-side half of the degradation contract.
 *
 * @remarks
 * A page document is a list of sections, and every component that renders one needs exactly one
 * thing from it — the fields of the section it owns. Answering that with `find` at each render site
 * means a null check at each render site, and one unpublished section then takes the whole route
 * down. So the lookup lives here and cannot return `null`.
 */

import type { ContentDocument } from "./fields/types.js";
import type { PageDocument, PageDocumentSection } from "./types.js";

/**
 * One section of a page, as {@link PublishedPage.section} answers.
 *
 * @remarks
 * Always non-null, even for a key the document does not carry.
 */
export interface PageSection {
  readonly key: string;
  /**
   * The structural name a component switches on, or `null` when the section is absent.
   *
   * @remarks
   * Absent means unpublished, switched off by staff, or simply never provisioned — the normal
   * states of a site mid-build, none of which is an error.
   */
  readonly type: string | null;
  /** The field values, keyed by field key. `{}` for an absent section. */
  readonly fields: ContentDocument;
}

/**
 * A page document with a section lookup that always answers.
 *
 * @remarks
 * The same type serves a published read, a draft preview and a restored version: a draft is a
 * superset of a published document, so preview renders through the production components rather
 * than through a second code path that can drift from them.
 */
export interface PublishedPage {
  readonly slug: string;
  readonly title: string;
  readonly locale: string;
  /**
   * The last published version.
   *
   * @remarks
   * `null` only on a client-tier draft read of a page that has never been published; on the website
   * tier an unpublished page is a `404`, which the SDK maps to `null` instead.
   */
  readonly version: number | null;
  readonly publishedAt: string | null;
  /** Active sections only, in the order staff defined. */
  readonly sections: readonly PageDocumentSection[];
  /**
   * The section with this key, or an empty one.
   *
   * @remarks
   * **Never `null`, and never throws.** A missing section maps to an empty field set, so the
   * coercions in `@lazslov/content/fields` return their empty values and the component renders its
   * own placeholders. That is what makes a half-published site degrade one section at a time.
   */
  section(key: string): PageSection;
}

/**
 * Wrap a page document from the wire.
 *
 * @param document - The document as the service served it.
 * @returns A page with a total section lookup.
 * @remarks
 * The wire keys are kept exactly as they arrive. The SDK does not convert `snake_case` field keys
 * to `camelCase`: the model is shared with the service's own tooling and a site's provisioning
 * document, and a "tidied" key in the SDK would be a key that matches nothing on either side.
 */
export function toPublishedPage(document: PageDocument): PublishedPage {
  const sections = document.sections;
  const byKey = new Map(sections.map((section) => [section.key, section]));

  return {
    slug: document.page.slug,
    title: document.page.title,
    locale: document.page.locale,
    version: document.page.version,
    publishedAt: document.page.publishedAt,
    sections,
    section(key: string): PageSection {
      const found = byKey.get(key);
      return found
        ? { key, type: found.type, fields: found.fields }
        : { key, type: null, fields: {} };
    },
  };
}
