import { describe, expect, it } from "vitest";
import { buildQuery } from "../src/query.js";

describe("buildQuery", () => {
  it("returns an empty string for no parameters", () => {
    expect(buildQuery(undefined)).toBe("");
    expect(buildQuery({})).toBe("");
  });

  it("prefixes with a question mark when there is something to send", () => {
    expect(buildQuery({ limit: 10 })).toBe("?limit=10");
  });

  it("drops null and undefined rather than serialising them", () => {
    // Serialising `undefined` produces the literal string "undefined", which a service reads
    // as a real value.
    expect(buildQuery({ limit: 10, cursor: undefined, after: null })).toBe("?limit=10");
  });

  it("keeps an empty string, which is a value a caller may mean", () => {
    expect(buildQuery({ search: "" })).toBe("?search=");
  });

  it("serialises booleans as true and false", () => {
    // content-service answers 400 for anything else rather than treating it as falsy.
    expect(buildQuery({ published: true, draft: false })).toBe("?published=true&draft=false");
  });

  it("percent-encodes values", () => {
    expect(buildQuery({ slug: "a b/c" })).toBe("?slug=a+b%2Fc");
  });

  it("keeps numbers, including zero", () => {
    expect(buildQuery({ offset: 0 })).toBe("?offset=0");
  });

  it("repeats an array parameter rather than joining it", () => {
    // content-service's `eq` filter is repeatable; a comma-joined value would be one bad filter.
    expect(buildQuery({ eq: ["manual:false", "beneficiaryId:3f1c"] })).toBe(
      "?eq=manual%3Afalse&eq=beneficiaryId%3A3f1c",
    );
  });

  it("drops an empty array entirely", () => {
    expect(buildQuery({ eq: [], limit: 5 })).toBe("?limit=5");
  });
});
