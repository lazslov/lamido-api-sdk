import { NotConfiguredError } from "@lamido/api-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentApiError } from "../src/errors.js";
import { asSaveResult } from "../src/next/save-result.js";

/**
 * The server-action error shape.
 *
 * @remarks
 * A thrown server-action message is redacted in production, so a rejected save reaches the editor as an
 * opaque generic failure and the one thing they needed — which field, and why — is gone. Every case here
 * is really the same assertion: **this never throws.**
 */

beforeEach(() => {
  // The helper logs server-side on purpose; the suite would otherwise print a stack per case.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A content error with the given code and details. */
function contentError(code: "validation_error" | "conflict" | "unauthorized", details?: unknown) {
  return new ContentApiError({
    status: 400,
    code,
    message: `stub ${code}`,
    requestPath: "/api/client/pages/home/values",
    retryable: false,
    ...(details === undefined ? {} : { details: details as never }),
  });
}

describe("the happy path", () => {
  it("answers ok for a resolved body", async () => {
    expect(await asSaveResult(async () => undefined)).toEqual({ ok: true });
  });

  it("discards whatever the body returned, because an action's caller wants the outcome", async () => {
    expect(await asSaveResult(async () => ({ version: 9 }))).toEqual({ ok: true });
  });
});

describe("a failure becomes a result object", () => {
  it("never throws, for any of the codes the service sends", async () => {
    for (const code of ["validation_error", "conflict", "unauthorized"] as const) {
      const result = await asSaveResult(async () => {
        throw contentError(code);
      });
      expect(result).toMatchObject({ ok: false, error: code });
    }
  });

  it("never throws for a value that is not an error at all", async () => {
    // A JavaScript caller, or a bug in the action's own body.
    expect(await asSaveResult(async () => Promise.reject("a bare string"))).toEqual({
      ok: false,
      error: "internal_error",
    });
  });

  it("never throws for a synchronous throw in the body", async () => {
    expect(
      await asSaveResult(() => {
        throw new TypeError("prepareValues rejected a url");
      }),
    ).toEqual({ ok: false, error: "internal_error" });
  });

  it("routes not_configured through the same channel as a real 401", async () => {
    // Core's status: 0 sentinel is what lets a site need one translator rather than two.
    const result = await asSaveResult(async () => {
      throw new NotConfiguredError({ service: "content-service", message: "no base URL" });
    });
    expect(result).toEqual({ ok: false, error: "not_configured" });
  });

  it("logs server-side, so a swallowed failure is still reproducible", async () => {
    await asSaveResult(async () => {
      throw contentError("conflict");
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("validation_error details become per-field messages", () => {
  it("maps invalid[] entries onto their keys", async () => {
    const result = await asSaveResult(async () => {
      throw contentError("validation_error", {
        invalid: [
          {
            key: "cta_url",
            message: "must be an absolute URL, a mailto:, a tel:, /path or #anchor",
          },
          { key: "headline", message: "must be a string" },
        ],
      });
    });

    expect(result).toEqual({
      ok: false,
      error: "validation_error",
      fields: {
        cta_url: "must be an absolute URL, a mailto:, a tel:, /path or #anchor",
        headline: "must be a string",
      },
    });
  });

  it("maps unknownKeys, which say which field rather than why", async () => {
    const result = await asSaveResult(async () => {
      throw contentError("validation_error", { unknownKeys: ["old_field"] });
    });

    expect(result).toMatchObject({ fields: { old_field: expect.stringContaining("schema") } });
  });

  it("prefers invalid[] on a collision, because it explains why", async () => {
    const result = await asSaveResult(async () => {
      throw contentError("validation_error", {
        unknownKeys: ["cta_url"],
        invalid: [{ key: "cta_url", message: "must be an absolute URL" }],
      });
    });

    expect(result).toMatchObject({ fields: { cta_url: "must be an absolute URL" } });
  });

  it("omits fields entirely when the service named none", async () => {
    const result = await asSaveResult(async () => {
      throw contentError("validation_error");
    });

    expect(result).toEqual({ ok: false, error: "validation_error" });
    expect("fields" in result).toBe(false);
  });

  it("does not map a publish conflict's missing[], which is not a form's fields", async () => {
    // Those entries are "<section>.<field>" paths across a whole page and each one wants to be a
    // link; the site reads details.missing off the caught error instead.
    const result = await asSaveResult(async () => {
      throw contentError("conflict", { missing: ["hero.headline", "about.body"] });
    });

    expect(result).toEqual({ ok: false, error: "conflict" });
  });
});
