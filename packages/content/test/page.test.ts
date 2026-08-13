import { describe, expect, it } from "vitest";
import { asText } from "../src/fields/coerce.js";
import { toPublishedPage } from "../src/page.js";
import { pageDocument } from "./stubs/fetch.js";

const page = toPublishedPage(
  pageDocument([
    { key: "hero", type: "hero", fields: { title: "Minden gyermek egy **csoda.**" } },
    { key: "about", type: "prose", fields: { body: "" } },
  ]),
);

describe("a page's section lookup", () => {
  it("returns the section a document carries", () => {
    expect(page.section("hero")).toEqual({
      key: "hero",
      type: "hero",
      fields: { title: "Minden gyermek egy **csoda.**" },
    });
  });

  it("returns an empty section rather than null for a key that is absent", () => {
    // One unpublished section must not be able to take a route down.
    const missing = page.section("nope");
    expect(missing).not.toBeNull();
    expect(missing.fields).toEqual({});
    expect(missing.type).toBeNull();
  });

  it("does not throw for an absent section, and the coercions still answer", () => {
    expect(() => page.section("nope")).not.toThrow();
    expect(asText(page.section("nope").fields, "title")).toBe("");
  });

  it("keeps the page's own metadata, nullability included", () => {
    const unpublished = toPublishedPage(pageDocument([], { version: null, published_at: null }));
    expect(unpublished.version).toBeNull();
    expect(unpublished.published_at).toBeNull();
  });

  it("keeps sections in the order the service served them", () => {
    expect(page.sections.map((section) => section.key)).toEqual(["hero", "about"]);
  });

  it("does not rewrite wire keys", () => {
    // The model is shared with the service's own tooling and the site's provisioning document, so
    // a "tidied" camelCase key here would match nothing on either side.
    const snake = toPublishedPage(pageDocument([{ key: "hero", fields: { cta_href: "/rolunk" } }]));
    expect(Object.keys(snake.section("hero").fields)).toEqual(["cta_href"]);
  });
});
