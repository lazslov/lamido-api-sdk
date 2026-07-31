import { describe, expect, it } from "vitest";
import { prepareValues } from "../src/fields/prepare-values.js";
import type { SectionDescriptor } from "../src/fields/types.js";

/** One section exercising every type the descriptor model has. */
const ABOUT: SectionDescriptor = {
  key: "about",
  label: "About us",
  summary: "The lead paragraph and the highlighted figures.",
  previewHref: "/#about",
  fields: [
    { key: "title", label: "Heading", type: "text" },
    { key: "body", label: "Text", type: "richtext" },
    { key: "cta_href", label: "Button target", type: "url" },
    { key: "goal", label: "Goal", type: "number" },
    { key: "visible", label: "Shown", type: "boolean" },
    { key: "photo", label: "Photo", type: "image" },
    {
      key: "stats",
      label: "Highlighted figures",
      type: "list",
      entry: [
        { key: "icon", label: "Icon", type: "text", options: ["heart", "star"], required: true },
        { key: "value", label: "Figure", type: "text" },
      ],
    },
  ],
};

describe("prepareValues", () => {
  it("iterates the descriptor, so a key it does not declare never reaches the wire", () => {
    // A server action is a public endpoint, and one stray key fails the entire save with a 400.
    const result = prepareValues(ABOUT, { title: "New", injected: "surprise" }, {});
    expect(result).toEqual({ ok: true, values: { "about.title": "New" } });
  });

  it("prefixes each key with the section, ready for patchValues", () => {
    const result = prepareValues(ABOUT, { title: "New" }, { title: "Old" });
    expect(result.ok && Object.keys(result.values)).toEqual(["about.title"]);
  });

  it("returns only changed keys", () => {
    const result = prepareValues(
      ABOUT,
      { title: "Same", body: "New body" },
      { title: "Same", body: "Old" },
    );
    expect(result).toEqual({ ok: true, values: { "about.body": "New body" } });
  });

  it("returns {} when nothing changed, so the caller makes no request at all", () => {
    // A save is usually followed by a publish, and a publish carries every other pending draft on
    // the page live. An idly pressed Save must not be able to do that.
    const result = prepareValues(ABOUT, { title: "Same" }, { title: "Same" });
    expect(result).toEqual({ ok: true, values: {} });
  });

  it("treats an empty input for a never-set field as no change", () => {
    // Which is exactly what an untouched form looks like for a field nobody has ever filled in.
    expect(prepareValues(ABOUT, { title: "", stats: [] }, {})).toEqual({ ok: true, values: {} });
  });

  it("sends an empty string when a stored value is being cleared", () => {
    expect(prepareValues(ABOUT, { title: "" }, { title: "Something" })).toEqual({
      ok: true,
      values: { "about.title": "" },
    });
  });

  it("rejects a bad url with a per-field error naming the field", () => {
    const result = prepareValues(ABOUT, { cta_href: "www.example.org" }, {});
    expect(result).toEqual({
      ok: false,
      errors: { cta_href: expect.stringContaining("Button target") },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.cta_href).toMatch(/mailto:/);
  });

  it("reports every bad field at once, keyed for the form's own inputs", () => {
    const result = prepareValues(ABOUT, { cta_href: "nope", goal: "abc" }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["cta_href", "goal"]);
  });

  it("parses the string forms a FormData submission carries", () => {
    const result = prepareValues(ABOUT, { goal: "6200000", visible: "true" }, {});
    expect(result).toEqual({
      ok: true,
      values: { "about.goal": 6_200_000, "about.visible": true },
    });
  });

  it("rejects a number that is not one, rather than sending NaN", () => {
    expect(prepareValues(ABOUT, { goal: "" }, { goal: 1 }).ok).toBe(false);
    expect(prepareValues(ABOUT, { goal: Number.POSITIVE_INFINITY }, {}).ok).toBe(false);
  });

  it("keeps only assetId and alt for an image, and always treats it as a change", () => {
    // A read document carries the resolved image and never the assetId, so equality cannot be
    // proven — which is also why an image gets its own save action.
    const result = prepareValues(
      ABOUT,
      { photo: { assetId: "0f2c", alt: "Hero", extra: "dropped" } },
      { photo: { url: "https://blob.example.com/a.jpg", alt: "Hero", width: null, height: null } },
    );
    expect(result).toEqual({
      ok: true,
      values: { "about.photo": { assetId: "0f2c", alt: "Hero" } },
    });
  });

  it("requires alt text but accepts an empty one for a decorative image", () => {
    expect(prepareValues(ABOUT, { photo: { assetId: "0f2c" } }, {}).ok).toBe(false);
    expect(prepareValues(ABOUT, { photo: { assetId: "0f2c", alt: "" } }, {}).ok).toBe(true);
  });

  it("picks list columns from the descriptor and drops an unknown one", () => {
    const result = prepareValues(
      ABOUT,
      { stats: [{ icon: "heart", value: "17", gained: "x" }] },
      {},
    );
    expect(result).toEqual({
      ok: true,
      values: { "about.stats": [{ icon: "heart", value: "17" }] },
    });
  });

  it("preserves a stored option this build does not offer", () => {
    // A model that gained an icon after this build shipped. Opening the form and pressing Save must
    // not silently rewrite a value nobody touched.
    const stored = { stats: [{ icon: "sparkles", value: "17" }] };
    const result = prepareValues(ABOUT, { stats: [{ icon: "sparkles", value: "18" }] }, stored);
    expect(result).toEqual({
      ok: true,
      values: { "about.stats": [{ icon: "sparkles", value: "18" }] },
    });
  });

  it("refuses an option outside the set when it is a change", () => {
    const result = prepareValues(ABOUT, { stats: [{ icon: "invented", value: "1" }] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.stats).toMatch(/heart, star/);
  });

  it("names the row when a required column is empty", () => {
    const result = prepareValues(ABOUT, { stats: [{ icon: "heart" }, { value: "2" }] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.stats).toMatch(/row 2/);
  });

  it("enforces a fixed row set in order", () => {
    const BANK: SectionDescriptor = {
      key: "bank",
      label: "Bank details",
      summary: "The transfer details.",
      previewHref: "/#bank",
      fields: [
        {
          key: "rows",
          label: "Rows",
          type: "list",
          rowKeys: ["accountNumber", "iban"],
          entry: [
            { key: "key", label: "Key", type: "text", locked: true },
            { key: "value", label: "Value", type: "text" },
          ],
        },
      ],
    };

    const inOrder = [
      { key: "accountNumber", value: "1" },
      { key: "iban", value: "2" },
    ];
    expect(prepareValues(BANK, { rows: inOrder }, {}).ok).toBe(true);
    expect(prepareValues(BANK, { rows: [...inOrder].reverse() }, {}).ok).toBe(false);
    expect(prepareValues(BANK, { rows: [inOrder[0]] }, {}).ok).toBe(false);
  });

  it("matches a stored row by its locked key, not by its index", () => {
    // A row's identity is its key — the whole reason `locked` exists.
    const LINKS: SectionDescriptor = {
      key: "footer",
      label: "Footer",
      summary: "The footer links.",
      previewHref: "/#footer",
      fields: [
        {
          key: "links",
          label: "Links",
          type: "list",
          entry: [
            { key: "key", label: "Key", type: "text", locked: true },
            { key: "label", label: "Label", type: "text", options: ["Hírlevél"] },
          ],
        },
      ],
    };

    const stored = {
      links: [
        { key: "privacy", label: "Adatvédelem" },
        { key: "newsletter", label: "Hírlevél" },
      ],
    };
    // Reordered submission: the "Adatvédelem" label is outside `options` but unchanged for its row.
    const result = prepareValues(
      LINKS,
      {
        links: [
          { key: "newsletter", label: "Hírlevél" },
          { key: "privacy", label: "Adatvédelem" },
        ],
      },
      stored,
    );
    expect(result.ok).toBe(true);
  });

  it("throws for a malformed descriptor rather than blaming the editor", () => {
    const broken: SectionDescriptor = {
      key: "x",
      label: "X",
      summary: "",
      previewHref: "/",
      fields: [{ key: "rows", label: "Rows", type: "list" }],
    };
    expect(() => prepareValues(broken, { rows: [] }, {})).toThrow(TypeError);
  });

  it("does not report a submitted key the section does not declare as an error", () => {
    // Dropping is the contract; erroring would make an out-of-date form unusable.
    expect(prepareValues(ABOUT, { unknown_key: "x" }, {})).toEqual({ ok: true, values: {} });
  });
});
