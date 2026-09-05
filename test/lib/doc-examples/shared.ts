import { expect } from "vitest";
import type { KeySpec } from "../type-keys.js";

/**
 * What every service's doc-example classification is built from.
 *
 * @remarks
 * `test/doc-examples.test.ts` runs one suite per service over a list of {@link Classifier}s. The
 * classifiers themselves live in one module per service under this directory, because each list is
 * written against that service's own types and grows with that service's documentation. This module
 * holds the pieces every list shares: the example shape, the list-envelope unwrapper, the spec
 * builder, and the classifications that are the same for every service.
 */

/** One extracted example, as `scripts/import-doc-examples.ts` writes it. */
export interface DocExample {
  /** Path relative to the service folder, e.g. `client-api.md`. */
  readonly file: string;
  /** 1-based line of the opening fence or the body's first line. */
  readonly line: number;
  /** The nearest preceding Markdown heading, or the `.http` request line. */
  readonly context: string;
  /** The example, reserialised. */
  readonly json: unknown;
}

/** A classification: what an example is, and how to check it. */
export interface Classifier {
  /** Reported when a check fails, and when the coverage summary is printed. */
  readonly id: string;
  /** Whether this classifier owns the example. First match wins, so order is significant. */
  matches(example: DocExample): boolean;
  /**
   * How to check it. Omitted for a deliberate out-of-scope classification.
   *
   * @remarks
   * Returns the object to key-check and the spec to check it against — or `null` where the example is a
   * shape the SDK declares no type for and the assertion is only that it parsed.
   */
  readonly check?: (example: DocExample) => { value: object; spec: KeySpec } | null;
}

/**
 * One service's classification, with how much of it is actually key-checked.
 *
 * @remarks
 * `minChecked` and `minTypes` are floors, not targets — they exist so a classifier that quietly lost its
 * `check` in a refactor fails loudly instead of silently asserting nothing. Each number is a fact about
 * how many documented examples the SDK has a declared type for; raise one when a type gains an example.
 */
export interface ServiceExamples {
  /** The knowledge-base folder, and the fixture file's stem. */
  readonly id: string;
  readonly classifiers: readonly Classifier[];
  /** How many examples must reach a `check`. */
  readonly minChecked: number;
  /** How many distinct classifiers must do the checking. */
  readonly minTypes: number;
}

/** A list envelope: `data` plus the siblings that make it interpretable. */
interface Envelope {
  data?: unknown;
  next_cursor?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
}

/**
 * The subject of an example: a list's rows, or the resource itself.
 *
 * @remarks
 * A resource response *is* the resource, so this unwraps only a list — recognised by `data` alongside
 * `next_cursor`, which every list carries and nothing else does. Unwrapping `data` unconditionally
 * would strip a *dataset record's own* payload member, which is also called `data`.
 */
export function unwrap(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const envelope = value as Envelope;
  return "data" in envelope && "next_cursor" in envelope ? envelope.data : envelope;
}

/** Whether an example is a plain object, so a classifier can look inside it. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build a {@link KeySpec}. Both arguments are annotated at the call site, where the compiler checks them. */
export function spec(
  all: Readonly<Record<string, true>>,
  required: Readonly<Record<string, true>>,
): KeySpec {
  return { all, required };
}

/** Anything on the admin tier. Out of the SDK's surface entirely — no SDK type could be checked against it. */
export const adminTier: Classifier = {
  id: "out of scope: admin tier",
  matches: (example) =>
    example.file === "admin-api.md" || /\/(api\/)?admin\//.test(example.context),
};

/**
 * An RFC 9457 problem document, which every service answers a failure with.
 *
 * @remarks
 * Checked by hand rather than by key spec: the SDK models this as an *error class*, not as a wire
 * type, so there is no `T` to derive keys from. What is asserted instead is the part the shared
 * reader depends on — the five core members are present, and `type` is a URN whose slug is one of
 * the closed set.
 */
export function problemDocument(id: string): Classifier {
  const slugs = new Set([
    "validation",
    "unauthorized",
    "forbidden",
    "not-found",
    "conflict",
    "payload-too-large",
    "rate-limit",
    "internal",
  ]);

  return {
    id,
    matches: (example) => isRecord(example.json) && String(example.json.type).startsWith("urn:"),
    check: (example) => {
      const problem = example.json as Record<string, unknown>;
      for (const member of ["type", "title", "status", "detail", "instance"]) {
        expect(problem, `${example.file}:${example.line} is missing ${member}`).toHaveProperty(
          member,
        );
      }
      const type = String(problem.type);
      expect(slugs.has(type.slice(type.lastIndexOf(":") + 1)), `unknown slug in ${type}`).toBe(
        true,
      );
      return null;
    },
  };
}

/**
 * A pre-RFC-9457 `{ error: { code, message, details } }` envelope still shown in the docs.
 *
 * @remarks
 * **This is a finding, not a shape the SDK supports.** Every service's conventions now say every
 * failure is `application/problem+json`, and the SDK reads only that. Classified explicitly rather
 * than left unclaimed so the suite stays green while *recording* the divergence: an unclaimed example
 * says "nobody looked at this", and these have been looked at. The entry goes when the documentation
 * is corrected upstream.
 */
export function staleErrorEnvelope(id: string): Classifier {
  return {
    id,
    matches: (example) => isRecord(example.json) && "error" in example.json,
  };
}

/** A request body the SDK sends but declares no named response type for. Asserted only to parse. */
export function requestBody(id: string, matches: Classifier["matches"]): Classifier {
  return { id, matches };
}
