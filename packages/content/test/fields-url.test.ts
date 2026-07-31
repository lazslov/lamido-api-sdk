import { describe, expect, it } from "vitest";
import { isValidContentUrl } from "../src/fields/url.js";

describe("isValidContentUrl", () => {
  it.each([
    "https://example.org",
    "http://localhost:3000",
    "mailto:a@b.hu",
    "tel:+3611234567",
    "/rolunk",
    "#about",
  ])("accepts %s, exactly as the service does", (value) => {
    expect(isValidContentUrl(value)).toBe(true);
  });

  it.each([
    "www.example.org",
    "example.org",
    "javascript:alert(1)",
    "ftp://example.org",
    "",
    " /rolunk",
  ])("rejects %s", (value) => {
    expect(isValidContentUrl(value)).toBe(false);
  });

  it("rejects an empty string, because the service has no way to clear a url", () => {
    // Offer replace, not clear: "the link disappeared" is not a recoverable state.
    expect(isValidContentUrl("")).toBe(false);
  });
});
