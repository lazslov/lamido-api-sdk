import "server-only";
import { tryCreateNextContentGateway } from "@lamido/content/next";

/**
 * The one gateway module.
 *
 * @remarks
 * Everything that leaves this app for content-service goes through here, so one place knows the base
 * URL, the credential and the cache mode — and nothing else can get any of the three wrong.
 *
 * `import "server-only"` is the enforcement rather than a comment: a client component importing this
 * file is a **build error**, which is what you want for a module that holds a `csk_` key.
 *
 * `tryCreate…` and not `create…`, because this module is imported at build time while prerendering. The
 * strict constructor throws when nothing is configured, and a throw here is not a degraded page — it is
 * a failed build with no environment to explain it. This app must build with an empty environment.
 */
export const content = tryCreateNextContentGateway();

/**
 * The cache tag mode A's reads set, and the tag the revalidation route busts.
 *
 * @remarks
 * Read off the gateway rather than written as a literal, so the two cannot drift. A mismatch between
 * them answers `200` from the webhook, invalidates nothing, and produces no error anywhere.
 */
export const tag = content?.tag;
