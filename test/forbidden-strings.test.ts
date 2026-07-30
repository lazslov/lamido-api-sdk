import { describe, expect, it } from "vitest";
import { type RuleId, scanText } from "../scripts/lib/forbidden-strings.js";

/** Rule ids of every finding, for terse assertions. */
function rules(text: string, tenantSlugs: readonly string[] = []): RuleId[] {
  return scanText(text, { tenantSlugs }).map((finding) => finding.rule);
}

describe("the leak guard", () => {
  it("fails on the deployment host", () => {
    // The planted string from phase 1's exit criteria.
    expect(rules("const base = 'https://content.lamido.hu';")).toContain("deployment-domain");
  });

  it("fails on the deployment domain even without a scheme", () => {
    expect(rules("# see the runbook at content.lamido.hu")).toContain("deployment-domain");
  });

  it("fails on a real-looking secret key", () => {
    // 30 characters of payload, as the exit criteria specify.
    expect(rules("csk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5")).toContain("credential");
  });

  it("fails on every credential tier prefix", () => {
    for (const prefix of ["cpk", "csk", "cad", "isk", "iad", "pmk", "pad", "whsec"]) {
      expect(rules(`${prefix}_a1b2c3d4e5f6g7h8i9j0`), prefix).toContain("credential");
    }
  });

  it("passes on a documentation placeholder", () => {
    expect(scanText("CONTENT_SERVICE_SECRET_KEY=csk_YOUR_SECRET_KEY")).toEqual([]);
    expect(scanText("secret: pad_EXAMPLE_ADMIN_KEY")).toEqual([]);
  });

  it("passes on a bare key prefix, which phase 2 matches on deliberately", () => {
    expect(scanText('if (key.startsWith("csk_")) { /* server tier */ }')).toEqual([]);
  });

  it("passes on documentation hosts and localhost", () => {
    expect(scanText("https://content.example.com/api/content/pages")).toEqual([]);
    expect(scanText("https://example.org")).toEqual([]);
    expect(scanText("http://localhost:3000/api/health")).toEqual([]);
    expect(scanText("http://127.0.0.1:3000")).toEqual([]);
  });

  it("fails on any other host", () => {
    expect(rules("await fetch('https://content.acme.test/api')")).toContain("non-example-host");
  });

  it("passes on the short allowlist of reference hosts", () => {
    expect(scanText("https://github.com/lazslov/lamido-api-sdk")).toEqual([]);
    expect(scanText("registry=https://registry.npmjs.org/")).toEqual([]);
  });

  it("passes on a documentation host at the end of a sentence", () => {
    // The trailing dot is punctuation, not part of the hostname. Getting this wrong makes the
    // guard cry wolf on prose, which is how a guard stops being trusted.
    expect(scanText("Expected something like https://service.example.com.")).toEqual([]);
  });

  it("fails on a configured tenant slug, matched whole-word and case-insensitively", () => {
    expect(rules("const site = 'Northwind';", ["northwind"])).toContain("tenant-slug");
    // A substring is not a slug: "northwindow" is a different word.
    expect(rules("const s = 'northwindow';", ["northwind"])).toEqual([]);
  });

  it("reports the line number and masks the secret it found", () => {
    const findings = scanText("ok\nkey = 'csk_a1b2c3d4e5f6g7h8i9j0'\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
    // A guard that reprints the secret into a CI log has leaked it a second time.
    expect(findings[0]?.excerpt).not.toContain("a1b2c3d4e5f6g7h8i9j0");
    expect(findings[0]?.excerpt).toContain("csk_<redacted:20chars>");
  });
});
