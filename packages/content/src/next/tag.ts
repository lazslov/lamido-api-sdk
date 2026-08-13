/**
 * The one cache tag, in the one place both halves of the integration read it from.
 *
 * @remarks
 * This module exists because of a failure mode that has no error message. If a site's reads say
 * `next: { tags: ["content"] }` and its revalidation route busts `` `content:${body.site}` ``, the
 * webhook answers `200`, nothing is invalidated, and the only symptom is content going stale for
 * exactly as long as the time-based fallback — with nothing wrong anywhere in a log.
 *
 * It is a mismatch between two string literals in two files. Sharing one constant is the structural
 * fix: `createNextContentGateway` and `createRevalidationHandler` default to this value, so a
 * consumer who overrides the tag in one place and not the other now has a visible asymmetry in their
 * own code rather than two unrelated strings.
 */

/**
 * The default framework cache tag every published read carries, and the webhook busts.
 *
 * @remarks
 * **One coarse tag per site is the right default,** not a tag per page. A page publish can also
 * change `GET /v1/public/site` — the reserved `settings` section lives on a page — and nothing in
 * the delivery payload says whether it did. A finer tag would leave the site's own chrome stale
 * after the one publish most likely to change it.
 */
export const CONTENT_TAG = "content";
