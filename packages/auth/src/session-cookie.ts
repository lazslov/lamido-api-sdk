/**
 * Reading a session token out of the one place the service puts it.
 *
 * @remarks
 * **The session token is never in a response body.** Both exchanges and both Google callbacks set it
 * as an `HttpOnly` cookie and return, at most, the user. A browser keeps the cookie and needs nothing
 * here. A backend driving the flow — a smoke test, a server-rendered sign-in — reads the token out of
 * the `Set-Cookie` header once and then sends it as `X-Session-Token`. This module is that read.
 */

/** The platform person's cookie. `__Host-` means it is never stored over plain `http`. */
export const platformSessionCookie = "__Host-lamido_platform_session";

/**
 * The website customer's cookie.
 *
 * @remarks
 * A different name from the platform one, deliberately: one browser holds both at once whenever a
 * tenant's staff shop on their own site.
 */
export const customerSessionCookie = "__Host-lamido_customer_session";

/** The two cookies this service sets, and the only two this reader accepts. */
const sessionCookies: readonly string[] = [platformSessionCookie, customerSessionCookie];

/**
 * Read the session token out of a `Set-Cookie` header.
 *
 * @param setCookie - The header as `Headers.get("set-cookie")` returns it, or `null`.
 * @returns The token, or `null` when the header is absent or names neither session cookie.
 * @remarks
 * Matches the two documented cookie names only. Anything else in the header — a CSRF cookie, an OAuth
 * state cookie — is not a session and is not returned, so a caller cannot mistake one credential for
 * another. Attributes after the first `;` are ignored: `Max-Age` is the website's own session
 * lifetime and the service resolves it, so there is nothing for a client to compute from it.
 *
 * Answers `null` rather than throwing because a `null` here has an ordinary cause: a browser, where
 * `Set-Cookie` is a forbidden response header and the platform stored the cookie itself.
 *
 * @example
 * ```ts
 * const { setCookie } = await auth.exchangeCustomerMagicLink(body);
 * const token = sessionTokenFromSetCookie(setCookie);
 * if (token) await backend.verifyCustomerSession({ website, token });
 * ```
 */
export function sessionTokenFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;

  // A combined header joins cookies with ", " and attributes with "; ". The date inside an `Expires`
  // attribute also contains ", ", so split on the cookie names themselves rather than on commas.
  for (const name of sessionCookies) {
    const start = setCookie.indexOf(`${name}=`);
    if (start === -1) continue;
    const from = start + name.length + 1;
    const end = setCookie.indexOf(";", from);
    const token = (end === -1 ? setCookie.slice(from) : setCookie.slice(from, end)).trim();
    if (token !== "") return token;
  }
  return null;
}
