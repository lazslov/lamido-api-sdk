/**
 * Turning a TypeScript type's keys into a value a runtime assertion can use.
 *
 * @remarks
 * The problem this solves: "does this JSON parse into that SDK type?" is a question about a compile-time
 * type and a runtime value, and neither side can see the other. A `json as Invoice` cast proves nothing —
 * it is the assertion being asked for, asserted by fiat.
 *
 * The trick is a mapped type plus `satisfies`. A hand-written key list annotated
 * `satisfies AllKeys<Invoice>` is checked **by the compiler** in both directions: a missing key makes the
 * literal unassignable, and an extra key trips the excess-property check. So the list is provably the
 * type's own key set, and it is also an ordinary object a test can iterate.
 *
 * With that, two real assertions become possible:
 *
 * - every key in a documented example is a key the SDK's type declares — catching a field the service
 *   documents and the SDK does not know about;
 * - every **required** key of the SDK's type is present in the example — catching a field the SDK insists
 *   on that the service does not actually send.
 *
 * Both are divergences between the docs and the types, which is exactly what phase 7 §2 is for.
 */

/**
 * `T` without its index signature, if it has one.
 *
 * @remarks
 * A type that ends in `& { [key: string]: unknown }` — invoice-service's health body does — has
 * `keyof T` of `string`, which makes {@link AllKeys} degenerate into "any keys at all" and the
 * assertion vacuous. Filtering the index signature out leaves the declared keys, which is what a
 * key spec is about; the open half is open by design and there is nothing to enumerate.
 */
export type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/**
 * Every key of `T`, optional ones included, as a required record.
 *
 * @remarks
 * `Required<T>` first, so an optional property still has to appear in the list. Annotate a key list with
 * `satisfies AllKeys<T>` and the compiler enforces that it names the type's keys **exactly**.
 */
export type AllKeys<T> = Record<keyof Required<KnownKeys<T>>, true>;

/**
 * Just the required keys of `T`.
 *
 * @remarks
 * `{} extends Pick<T, K>` is the test for "this property may be absent": it holds only when `K` is
 * optional. `-?` strips the modifier first so the mapped type itself does not make everything optional.
 */
export type RequiredKeys<T> = {
  [K in keyof KnownKeys<T>]-?: Record<string, never> extends Pick<KnownKeys<T>, K> ? never : K;
}[keyof KnownKeys<T>];

/** Just the required keys of `T`, as a required record. See {@link AllKeys}. */
export type MandatoryKeys<T> = Record<RequiredKeys<T>, true>;

/** A type's key sets, both verified by the compiler at their definition site. */
export interface KeySpec {
  /** Every key the type declares. */
  readonly all: Readonly<Record<string, true>>;
  /** The subset that may not be absent. */
  readonly required: Readonly<Record<string, true>>;
}

/** The outcome of checking one value against one {@link KeySpec}. */
export interface KeyCheck {
  /** Keys the value carries that the type does not declare. */
  readonly undeclared: string[];
  /** Required keys the value does not carry. */
  readonly missing: string[];
}

/**
 * Check one object's key set against a type's.
 *
 * @param value - A documented example, or any part of one.
 * @param spec - The compiler-verified key sets.
 * @returns What diverged. Two empty arrays means the example fits the type.
 * @remarks
 * Keys only, deliberately, and not value types. A doc example's `"grossAmount": 38100` cannot tell a
 * `number` from a `38100`-literal type, and a runtime type check deep enough to be meaningful would be a
 * second, hand-maintained copy of every type — which would then be the thing that drifts. Key sets are
 * where documented shapes and declared types actually disagree in practice: a renamed field, a field
 * added upstream, a field the SDK made required on a guess.
 */
export function checkKeys(value: object, spec: KeySpec): KeyCheck {
  const present = new Set(Object.keys(value));

  return {
    undeclared: [...present].filter((key) => !(key in spec.all)).sort(),
    missing: Object.keys(spec.required)
      .filter((key) => !present.has(key))
      .sort(),
  };
}
