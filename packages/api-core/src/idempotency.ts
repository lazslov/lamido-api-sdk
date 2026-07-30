/**
 * A validated idempotency key.
 *
 * @remarks
 * Branded so an endpoint that requires a key cannot receive an arbitrary string. A caller
 * cannot pass `crypto.randomUUID()` without routing it through {@link idempotencyKey} and
 * noticing what they are doing.
 */
export type IdempotencyKey = string & { readonly __idempotencyKey: unique symbol };

/** The services accept a header value; anything outside printable ASCII is not one. */
const printableAscii = /^[\x20-\x7E]+$/;

/** Documented maximum length. */
const maxLength = 255;

/**
 * Validate and brand an idempotency key.
 *
 * @param value - The key, derived by the caller from the operation being performed.
 * @returns The same string, branded.
 * @throws `TypeError` when the key is empty, longer than 255 characters, or not printable ASCII.
 * @remarks
 * Core validates and places keys. It **never generates** one — not from a clock, a counter or a
 * random source. payment-service is explicit that a key must be derived from the operation
 * (`order-12345-attempt-1`, never a fresh UUID per retry) because Barion does not deduplicate
 * on its own request id: a retry under a new key is simply a second payment. A convenience that
 * produced a key would be used by default, would be correct in the happy path, and would
 * silently reintroduce exactly the double charge the requirement exists to prevent.
 */
export function idempotencyKey(value: string): IdempotencyKey {
  if (value.length === 0) {
    throw new TypeError("an idempotency key cannot be empty");
  }
  if (value.length > maxLength) {
    throw new TypeError(
      `an idempotency key cannot exceed ${maxLength} characters, received ${value.length}`,
    );
  }
  if (!printableAscii.test(value)) {
    throw new TypeError("an idempotency key must be printable ASCII");
  }
  return value as IdempotencyKey;
}

/**
 * Build the documented key shape, `${operation}-attempt-${attempt}`.
 *
 * @param operation - What is being done, stable across retries — e.g. `order-12345`.
 * @param attempt - Which attempt this is, from 1.
 * @throws `TypeError` when `attempt` is not a positive integer, or the result is not a valid key.
 * @remarks
 * `attempt` is a parameter rather than something this function tracks, so incrementing it is a
 * visible decision at the call site. A new key after an unanswered request is how double
 * charges happen.
 *
 * @example
 * ```ts
 * await payments.create({ … }, derivedIdempotencyKey(`order-${order.id}`, 1));
 * ```
 */
export function derivedIdempotencyKey(operation: string, attempt: number): IdempotencyKey {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError(`attempt must be a positive integer, received ${attempt}`);
  }
  return idempotencyKey(`${operation}-attempt-${attempt}`);
}
