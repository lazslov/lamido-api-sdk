/**
 * The field-descriptor type model, and the two value shapes the coercions produce.
 *
 * @remarks
 * A **leaf module**: it imports nothing, not even `@lazslov/api-core`. A site's descriptor
 * tables, its read mappers, its write path and its form components all depend on this, and the
 * real build that this layer is distilled from hit an import cycle the moment one of those
 * pulled in another — descriptors want the list of section anchors, and the anchor list is
 * derived from the descriptors.
 *
 * The SDK ships the types, the coercions and the write preparer. Each site owns its own
 * descriptor tables: labels and help text are product copy.
 */

/**
 * A field's declared type, as the service's structure tree reports it.
 *
 * @remarks
 * All seven the service has. `list` is the only one whose entries need a further descriptor,
 * and nesting is not modelled — the service rejects a `list` inside an item schema.
 */
export type FieldType = "text" | "richtext" | "url" | "number" | "boolean" | "image" | "list";

/**
 * A rendering refinement for when the wire type is not descriptive enough.
 *
 * @remarks
 * A `text` field covers a twelve-character button label, a four-hundred-character paragraph, an
 * icon name and an identifier an editor must not retype. The service has one type for all four;
 * a form needs to tell them apart. `locked` is the load-bearing one — see
 * {@link ListEntryDescriptor.locked}.
 */
export type FieldControl = "multiline" | "email" | "icon" | "anchor" | "locked";

/** One column of a `list` field's entries. */
export interface ListEntryDescriptor {
  /** Wire key inside the entry. Must match the field's item schema, or the save is a `400`. */
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  /**
   * Every field type except `list`.
   *
   * @remarks
   * Exactly what the service's item schema accepts: a list inside a list has no modelled value
   * shape, so it is rejected when the field is created.
   */
  readonly type: Exclude<FieldType, "list">;
  readonly control?: FieldControl;
  /** A closed set — icon names, section anchors. The write preparer enforces it, see below. */
  readonly options?: readonly string[];
  /** Mirrors the item schema's `required`. */
  readonly required?: boolean;
  /**
   * Code addresses this column **by value**.
   *
   * @remarks
   * A footer looks up the link whose key is `"newsletter"`; a copy button looks up the bank row
   * whose key is `"accountNumber"`. Renaming one does not fail — it silently removes a link from
   * the footer. Render a locked column as text rather than as an input: a disabled input looks
   * like a field the editor is failing to fill in.
   */
  readonly locked?: boolean;
}

/** One field of a section, named exactly once for every consumer that reads it. */
export interface FieldDescriptor {
  /** Wire key, exactly as the site's model declares it. */
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  readonly type: FieldType;
  readonly control?: FieldControl;
  /** A `list` field's columns, in display order. Required for `list`, ignored otherwise. */
  readonly entry?: readonly ListEntryDescriptor[];
  /**
   * A **fixed** row set: these exact locked values, in this order.
   *
   * @remarks
   * For a row set that is a contract rather than a collection — a bank-details block, a fixed
   * set of contact rows. Render no add/remove buttons, and the write preparer rejects a
   * submission whose locked column does not equal this list in order.
   */
  readonly rowKeys?: readonly string[];
  /** A heading rendered before this field. A twenty-field section needs headings, not routes. */
  readonly group?: string;
}

/** One section of a page, as an editor UI and the write path both see it. */
export interface SectionDescriptor {
  /** The section key on the wire. Value keys are `` `${key}.${field.key}` ``. */
  readonly key: string;
  readonly label: string;
  /** One line of "what is in here". */
  readonly summary: string;
  /** Where it renders publicly, for a "look at it" link. */
  readonly previewHref: string;
  readonly fields: readonly FieldDescriptor[];
}

/**
 * A flat bag of stored values, keyed by field key.
 *
 * @remarks
 * One section's `fields` object from a page document, or a collection item's `values`. A field
 * whose value is `null` is **omitted** by the service rather than sent as `null`, so the
 * coercions' defaults *are* the empty-value behaviour.
 */
export type ContentDocument = Readonly<Record<string, unknown>>;

/**
 * An `image` value as a consumer sees it, already resolved by the service.
 *
 * @remarks
 * `url` and `alt` travel **together** on purpose. The build this layer comes from captured alt
 * text, validated it as required, stored it — and then hardcoded `alt` at every render site. An
 * alt an editor is forced to type and nothing displays is theatre.
 *
 * `width` and `height` are hints the uploading browser supplied and may be `null`, so give the
 * container a known aspect ratio rather than trusting them.
 */
export interface ContentImage {
  readonly url: string;
  /** May be `""` — the correct signal for a decorative image. */
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
}

/** One row of a `list` field, as {@link ../coerce.js} produces it. */
export type ContentRow = Readonly<Record<string, unknown>>;
