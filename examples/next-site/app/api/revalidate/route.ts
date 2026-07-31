import { createRevalidationHandler } from "@lazslov/content/next";
import { tag } from "../../../lib/content";

/**
 * `POST /api/revalidate` — content-service's one outbound integration point.
 *
 * @remarks
 * The whole route. The handler reads the raw body before anything parses it, answers `400` for a stale
 * timestamp or an unreadable body and `401` for a bad signature, busts the tag, and answers `200`.
 *
 * `tag` comes from `lib/content.ts`, which is the same value the page's reads set. That is the point:
 * a tag mismatch between the two answers `200`, invalidates nothing, and produces **no error anywhere** —
 * the only symptom is content going stale for as long as the time-based fallback.
 *
 * The Node runtime is not strictly required here — content-service's verifier tolerates it either way —
 * but it is set for the same reason the payment webhook needs it: an edge runtime may transform the body,
 * and the signature is over the raw bytes.
 */
export const runtime = "nodejs";

export const POST = createRevalidationHandler({ tag });
