import { describe, expect, it } from "vitest";
import { readContractsManifest, readFrontMatterField } from "../scripts/lib/contracts-manifest.js";
import { services } from "../scripts/lib/paths.js";

const document = [
  "---",
  "id: content-service/README",
  "service: content-service",
  "source_commit: d7b5c46",
  "verified: 2026-07-28",
  "---",
  "",
  "# content-service",
].join("\n");

describe("readFrontMatterField", () => {
  it("reads a field from the YAML front matter", () => {
    expect(readFrontMatterField(document, "source_commit")).toBe("d7b5c46");
    expect(readFrontMatterField(document, "verified")).toBe("2026-07-28");
  });

  it("throws on a document with no front matter", () => {
    expect(() => readFrontMatterField("# no front matter", "source_commit")).toThrow(
      /no YAML front matter/,
    );
  });

  it("throws on a missing field, rather than pinning provenance it could not read", () => {
    expect(() => readFrontMatterField(document, "kb_commit")).toThrow(/no "kb_commit" field/);
  });

  it("ignores keys that appear after the front matter", () => {
    const withBodyKey = `${document}\n\nsource_commit: deadbeef\n`;
    expect(readFrontMatterField(withBodyKey, "source_commit")).toBe("d7b5c46");
  });
});

describe("contracts/CONTRACTS.json", () => {
  it("records provenance for every service package", () => {
    const manifest = readContractsManifest();
    for (const service of services) {
      const provenance = manifest.contracts[service.id];
      expect(provenance, service.id).toBeDefined();
      expect(provenance?.kbCommit).toMatch(/^[0-9a-f]{7,40}$/);
      expect(provenance?.sourceCommit).toMatch(/^[0-9a-f]{7,40}$/);
      expect(provenance?.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
