import { describe, expect, it } from "vitest";
import {
  customerSessionCookie,
  platformSessionCookie,
  sessionTokenFromSetCookie,
} from "../src/session-cookie.js";

/**
 * Reading the one place the service puts a session token.
 *
 * @remarks
 * The token is never in a body. A backend driving a sign-in reads it out of `Set-Cookie` once; these
 * cases pin what that read accepts and what it refuses.
 */

const platform = `${platformSessionCookie}=tok_platform; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
const customer = `${customerSessionCookie}=tok_customer; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;

describe("sessionTokenFromSetCookie", () => {
  it("binds the two documented cookie names", () => {
    expect(platformSessionCookie).toBe("__Host-lamido_platform_session");
    expect(customerSessionCookie).toBe("__Host-lamido_customer_session");
  });

  it("reads the platform token and the customer token", () => {
    expect(sessionTokenFromSetCookie(platform)).toBe("tok_platform");
    expect(sessionTokenFromSetCookie(customer)).toBe("tok_customer");
  });

  it("ignores the attributes after the value", () => {
    expect(sessionTokenFromSetCookie(`${customerSessionCookie}=abc; Max-Age=60`)).toBe("abc");
    expect(sessionTokenFromSetCookie(`${customerSessionCookie}=abc`)).toBe("abc");
  });

  it("finds the session cookie inside a combined header carrying another cookie first", () => {
    // Node's `Headers.get` joins multiple Set-Cookie values with ", ", and an Expires date carries a
    // comma of its own — so the read is anchored on the cookie name, not on a comma split.
    const combined = `__Host-lamido_oauth_state=st; Path=/; Expires=Thu, 14 Aug 2026 09:14:31 GMT, ${customer}`;
    expect(sessionTokenFromSetCookie(combined)).toBe("tok_customer");
  });

  it("answers null for no header, which is what a browser sees", () => {
    expect(sessionTokenFromSetCookie(null)).toBeNull();
    expect(sessionTokenFromSetCookie("")).toBeNull();
  });

  it("answers null for a header naming neither session cookie", () => {
    // An OAuth state cookie is not a session, and returning it would hand a caller the wrong credential.
    expect(sessionTokenFromSetCookie("__Host-lamido_oauth_state=st; Path=/; HttpOnly")).toBeNull();
  });

  it("answers null for an empty value, such as the one a logout clears with", () => {
    expect(sessionTokenFromSetCookie(`${platformSessionCookie}=; Max-Age=0`)).toBeNull();
  });
});
