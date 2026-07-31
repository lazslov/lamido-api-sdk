/**
 * `@lamido/content/fields` — the field-descriptor layer.
 *
 * @remarks
 * The abstraction that pays for itself most, and the one you will be tempted to skip. Without it
 * a hundred fields get named in four places each: a read mapper, a write validator, a label lookup
 * and the JSX. With it, each field is named **once** in a table and three consumers read it.
 *
 * This entry point imports nothing from `@lamido/api-core` and makes no request. It is safe in a
 * client component, which is what lets a browser form and a server action share one predicate.
 *
 * The SDK ships the types, the coercions and the write preparer. **Each site owns its own
 * descriptor tables** — labels and help text are product copy, and the wire keys in them are the
 * one thing that must stay in step with the site's provisioning document.
 */

export { asImage, asRichtext, asRows, asText } from "./coerce.js";
export { type PreparedValues, prepareValues } from "./prepare-values.js";
export type {
  ContentDocument,
  ContentImage,
  ContentRow,
  FieldControl,
  FieldDescriptor,
  FieldType,
  ListEntryDescriptor,
  SectionDescriptor,
} from "./types.js";
export { isValidContentUrl } from "./url.js";
