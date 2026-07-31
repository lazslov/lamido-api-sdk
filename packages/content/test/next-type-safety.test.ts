import { describe, expect, it } from "vitest";
import type { NextContentGateway } from "../src/next/gateway.js";
import type { SaveResult } from "../src/next/save-result.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The absences are written as **type** lookups
 * rather than property reads, because a property read on a value that does not exist throws at runtime
 * instead of proving anything — the claim is about the type, so the assertion belongs in type space.
 * The aliases are `_`-prefixed because they exist to be declared, not to be used, and that is how the
 * linter is told so.
 *
 * Note that the directive applies to the **following line**, so these are kept short enough that the
 * formatter cannot wrap them out from under it.
 */

describe("no no-store read is reachable from a render path", () => {
  it("has no fourth, uncached reader on the gateway", () => {
    // The reason `no-store` got reached for in the reference build is that "a short revalidate window"
    // was not a thing the gateway offered. Mode B is that thing; there is no mode D.
    // @ts-expect-error — three modes and a tag, and nothing that spells uncached.
    type _Absent = NextContentGateway["uncached"];
    const keys: (keyof NextContentGateway)[] = ["published", "live", "client", "tag"];
    expect(keys).toHaveLength(4);
  });

  it("has no way to ask published for a draft, the other reason to reach for no-store", () => {
    type Published = NextContentGateway["published"];
    // @ts-expect-error — a draft read is a client-tier method; the published reader has none.
    type _Absent = Published["getRenderedPage"];
    expect(true).toBe(true);
  });

  it("has no way to write through live", () => {
    type Live = NextContentGateway["live"];
    // @ts-expect-error — the write tier is `client`, and only `client` carries cache: "no-store".
    type _Absent = Live["patchValues"];
    expect(true).toBe(true);
  });

  it("does put the draft read and the write on the client tier, which is never in a render path", () => {
    // The positive half: mode C exists and is typed to the tier whose methods are writes and drafts.
    type Client = NextContentGateway["client"];
    const draftRead: keyof Client = "getRenderedPage";
    const write: keyof Client = "patchValues";
    expect([draftRead, write]).toEqual(["getRenderedPage", "patchValues"]);
  });

  it("types published and live as the same read-only tier", () => {
    // Which is what makes "there is no no-store read here" structural rather than a convention.
    const sameTier: NextContentGateway["published"] extends NextContentGateway["live"]
      ? true
      : false = true;
    expect(sameTier).toBe(true);
  });
});

describe("a SaveResult's error is a code, not prose", () => {
  it("narrows on ok, and exposes fields only on the failure branch", () => {
    type Success = Extract<SaveResult, { ok: true }>;
    // @ts-expect-error — there is nothing to render on the success branch.
    type _Absent = Success["fields"];
    expect(true).toBe(true);
  });

  it("rejects a code the service does not send", () => {
    const bad = {
      ok: false,
      // @ts-expect-error — `error` is ContentErrorCode, so a site's own sentence cannot land here.
      error: "Sajnáljuk, valami hiba történt.",
    } satisfies SaveResult;
    expect(bad.ok).toBe(false);
  });

  it("accepts every code the service does send, including the SDK's own", () => {
    const codes: SaveResult[] = [
      { ok: false, error: "validation_error", fields: { cta_url: "must be an absolute URL" } },
      { ok: false, error: "conflict" },
      { ok: false, error: "not_configured" },
    ];
    expect(codes).toHaveLength(3);
  });
});
