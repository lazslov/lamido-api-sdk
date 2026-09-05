import type {
  AggregateGroup,
  ClientIdentity,
  CollectionItem,
  ContentAsset,
  ContentHealth,
  ContentSite,
  DatasetRecord,
  ItemPublishResult,
  PageDocument,
  PublishedPageSummary,
  UploadToken,
} from "@lazslov/content";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import {
  adminTier,
  type Classifier,
  isRecord,
  problemDocument,
  requestBody,
  type ServiceExamples,
  spec,
  staleErrorEnvelope,
  unwrap,
} from "./shared.js";

/** content-service's documented examples, and the `@lazslov/content` type each one is checked against. */

const pageDocumentSpec = spec(
  { page: true, sections: true } satisfies AllKeys<PageDocument>,
  { page: true, sections: true } satisfies MandatoryKeys<PageDocument>,
);

const identitySpec = spec(
  { key: true, site: true } satisfies AllKeys<ClientIdentity>,
  { key: true, site: true } satisfies MandatoryKeys<ClientIdentity>,
);

const siteSpec = spec(
  {
    slug: true,
    name: true,
    locale: true,
    locales: true,
    default_locale: true,
    settings: true,
  } satisfies AllKeys<ContentSite>,
  {
    slug: true,
    name: true,
    locale: true,
    locales: true,
    default_locale: true,
    settings: true,
  } satisfies MandatoryKeys<ContentSite>,
);

const publishedPageSpec = spec(
  {
    slug: true,
    title: true,
    version: true,
    published_at: true,
  } satisfies AllKeys<PublishedPageSummary>,
  {
    slug: true,
    title: true,
    version: true,
    published_at: true,
  } satisfies MandatoryKeys<PublishedPageSummary>,
);

const itemSpec = spec(
  {
    // A collection item is still keyed by `id`, not `public_id` — the identifier rule applies
    // per resource, and this one was never exposed under a second name.
    id: true,
    collection_key: true,
    slug: true,
    position: true,
    status: true,
    published_at: true,
    created_at: true,
    updated_at: true,
    values: true,
  } satisfies AllKeys<CollectionItem>,
  {
    id: true,
    slug: true,
    position: true,
    status: true,
    values: true,
  } satisfies MandatoryKeys<CollectionItem>,
);

/** What an item publish answers: the locales it covered, and the item in one of them. */
const itemPublishSpec = spec(
  { locales: true, item: true } satisfies AllKeys<ItemPublishResult>,
  { locales: true, item: true } satisfies MandatoryKeys<ItemPublishResult>,
);

const recordSpec = spec(
  {
    public_id: true,
    dataset_key: true,
    external_id: true,
    data: true,
    withheld: true,
    occurred_at: true,
    created_at: true,
    updated_at: true,
  } satisfies AllKeys<DatasetRecord>,
  {
    public_id: true,
    dataset_key: true,
    external_id: true,
    data: true,
    withheld: true,
    occurred_at: true,
  } satisfies MandatoryKeys<DatasetRecord>,
);

const assetSpec = spec(
  {
    public_id: true,
    site_id: true,
    pathname: true,
    url: true,
    content_type: true,
    size: true,
    width: true,
    height: true,
    uploaded_by: true,
    created_at: true,
    references: true,
  } satisfies AllKeys<ContentAsset>,
  {
    public_id: true,
    site_id: true,
    pathname: true,
    url: true,
    content_type: true,
    size: true,
    uploaded_by: true,
    references: true,
  } satisfies MandatoryKeys<ContentAsset>,
);

const uploadTokenSpec = spec(
  {
    token: true,
    pathname: true,
    maximum_size_in_bytes: true,
    allowed_content_types: true,
  } satisfies AllKeys<UploadToken>,
  {
    token: true,
    pathname: true,
    maximum_size_in_bytes: true,
    allowed_content_types: true,
  } satisfies MandatoryKeys<UploadToken>,
);

const aggregateSpec = spec(
  { key: true, count: true, sum: true } satisfies AllKeys<AggregateGroup>,
  { key: true } satisfies MandatoryKeys<AggregateGroup>,
);

/** content-service's `/healthz` body: `{ status: "ok" }`, and nothing beside it. */
const contentHealthSpec = spec(
  { status: true } satisfies AllKeys<ContentHealth>,
  { status: true } satisfies MandatoryKeys<ContentHealth>,
);

/** A list whose first row carries the given keys. */
function firstRowHas(example: { json: unknown }, ...keys: string[]): boolean {
  const data = unwrap(example.json);
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    isRecord(data[0]) &&
    keys.every((key) => key in (data[0] as object))
  );
}

/** The first row of a list, for a key check. */
function firstRow(example: { json: unknown }): object {
  return (unwrap(example.json) as object[])[0] as object;
}

const classifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("content: problem document"),
  staleErrorEnvelope("content: STALE doc — pre-RFC-9457 error envelope"),
  {
    id: "content: Health",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && Object.keys(data).length === 1 && "status" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: contentHealthSpec }),
  },
  {
    id: "content: PublishedPageSummary",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "published_at" in data && "title" in data && "version" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: publishedPageSpec }),
  },
  {
    id: "content: PageDocument",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "page" in data && "sections" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: pageDocumentSpec }),
  },
  {
    id: "content: ClientIdentity",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "key" in data && "site" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: identitySpec }),
  },
  {
    id: "content: ContentSite",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "default_locale" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: siteSpec }),
  },
  {
    id: "content: UploadToken",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "token" in data && "pathname" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: uploadTokenSpec }),
  },
  {
    id: "content: ContentAsset",
    matches: (example) => {
      const data = unwrap(example.json);
      // `references` is what makes it a response: a registration request carries no such member,
      // and `pathname` + `url` alone match the request body too.
      return isRecord(data) && "references" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: assetSpec }),
  },
  {
    id: "content: PublishedPageSummary[]",
    matches: (example) => firstRowHas(example, "published_at", "title"),
    check: (example) => ({ value: firstRow(example), spec: publishedPageSpec }),
  },
  {
    id: "content: VersionSummary[]",
    matches: (example) => firstRowHas(example, "published_by"),
  },
  {
    id: "content: CollectionItem[]",
    matches: (example) => firstRowHas(example, "collection_key"),
    check: (example) => ({ value: firstRow(example), spec: itemSpec }),
  },
  {
    id: "content: AggregateGroup[]",
    matches: (example) => firstRowHas(example, "count"),
    check: (example) => ({ value: firstRow(example), spec: aggregateSpec }),
  },
  {
    id: "content: ItemPublishResult",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "locales" in data && "item" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: itemPublishSpec }),
  },
  {
    id: "content: CollectionItem",
    matches: (example) => isRecord(example.json) && "collection_key" in example.json,
    check: (example) => ({ value: example.json as object, spec: itemSpec }),
  },
  {
    id: "content: DatasetRecord",
    matches: (example) => isRecord(example.json) && "dataset_key" in example.json,
    check: (example) => ({ value: example.json as object, spec: recordSpec }),
  },
  requestBody(
    "content: request body",
    (example) =>
      example.file === "examples.http" ||
      // The one Markdown block that is a request body: `{ contentType, filename }`.
      (isRecord(example.json) && "filename" in example.json),
  ),
  {
    // A log line, not a response. `event` is what every one of them carries.
    id: "out of scope: a structured log line, which no SDK type describes",
    matches: (example) =>
      example.file === "operations.md" && isRecord(example.json) && "event" in example.json,
  },
  {
    id: "out of scope: a structure definition, which only staff can write",
    matches: (example) => example.file === "data-model.md",
  },
];

export const contentExamples: ServiceExamples = {
  id: "content-service",
  classifiers,
  minChecked: 8,
  minTypes: 6,
};
