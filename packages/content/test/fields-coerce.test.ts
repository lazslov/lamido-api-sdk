import { describe, expect, it } from "vitest";
import { asImage, asRichtext, asRows, asText } from "../src/fields/coerce.js";
import type { ListEntryDescriptor } from "../src/fields/types.js";

describe("asText", () => {
  it('answers "" for a key the document does not carry', () => {
    // A field whose value is null is omitted by the service, so absent is the normal state.
    expect(asText({}, "title")).toBe("");
  });

  it('answers "" for a stored empty string, and does not replace it with a default', () => {
    // Emptying a field is a deliberate editorial action. Falling back to seed copy overrides it.
    const doc = { title: "" };
    expect(asText(doc, "title")).toBe("");
    expect(asText(doc, "title") || "seed copy").toBe("seed copy"); // what a caller must NOT write
    expect(doc.title).toBe(""); // and the stored value is untouched either way
  });

  it("returns a stored string verbatim", () => {
    expect(asText({ title: "  spaced  " }, "title")).toBe("  spaced  ");
  });

  it('answers "" for a value of the wrong shape rather than throwing', () => {
    expect(asText({ title: { url: "x" } }, "title")).toBe("");
  });
});

describe("asRichtext", () => {
  it("returns the markdown source, unrendered", () => {
    expect(asRichtext({ body: "A **bold** word." }, "body")).toBe("A **bold** word.");
  });

  it('answers "" for an absent key', () => {
    expect(asRichtext({}, "body")).toBe("");
  });
});

describe("asImage", () => {
  it("resolves an image, normalising absent dimensions to null", () => {
    expect(
      asImage({ photo: { url: "https://blob.example.com/a.jpg", alt: "Hero" } }, "photo"),
    ).toEqual({
      url: "https://blob.example.com/a.jpg",
      alt: "Hero",
      width: null,
      height: null,
    });
  });

  it("keeps an empty alt, which is the correct signal for a decorative image", () => {
    expect(
      asImage({ photo: { url: "https://blob.example.com/a.jpg", alt: "" } }, "photo")?.alt,
    ).toBe("");
  });

  it("answers null for a deleted asset and for an absent key", () => {
    // The service resolves a deleted asset to null rather than a dangling id: render a placeholder.
    expect(asImage({ photo: null }, "photo")).toBeNull();
    expect(asImage({}, "photo")).toBeNull();
  });
});

const entry: readonly ListEntryDescriptor[] = [
  { key: "icon", label: "Icon", type: "text" },
  { key: "value", label: "Figure", type: "text" },
];

describe("asRows", () => {
  it("answers [] for an absent key and for a stored empty list", () => {
    expect(asRows({}, "stats", entry)).toEqual([]);
    expect(asRows({ stats: [] }, "stats", entry)).toEqual([]);
  });

  it("picks the declared columns and drops one the descriptor does not know", () => {
    // A column the schema gained but this build does not know about cannot reach a component.
    const rows = asRows(
      { stats: [{ icon: "heart", value: "17", gained_later: "surprise" }] },
      "stats",
      entry,
    );
    expect(rows).toEqual([{ icon: "heart", value: "17" }]);
  });

  it("leaves out a column the row does not carry, so a component's own default applies", () => {
    expect(asRows({ stats: [{ value: "17" }] }, "stats", entry)).toEqual([{ value: "17" }]);
  });

  it("resolves an image column the same way a field is resolved", () => {
    const withImage: readonly ListEntryDescriptor[] = [
      { key: "photo", label: "Photo", type: "image" },
    ];
    expect(
      asRows(
        { rows: [{ photo: { url: "https://blob.example.com/a.jpg", alt: "" } }, { photo: null }] },
        "rows",
        withImage,
      ),
    ).toEqual([
      { photo: { url: "https://blob.example.com/a.jpg", alt: "", width: null, height: null } },
      { photo: null },
    ]);
  });

  it("skips an entry that is not a set of columns rather than throwing", () => {
    expect(asRows({ stats: ["nonsense", { value: "17" }] }, "stats", entry)).toEqual([
      { value: "17" },
    ]);
  });
});
