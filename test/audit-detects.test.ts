import { describe, expect, it } from "vitest";
import { scanText } from "../scripts/lib/forbidden-strings.js";
import { checkTarball, type PackedManifest } from "../scripts/lib/tarball-rules.js";

/**
 * The audit that guards the audit.
 *
 * @remarks
 * `audit-tarballs` is the last thing standing between a mistake and a permanent public artifact: npm's
 * unpublish window is narrow and a mirror may already hold the tarball. Its own failure mode is the worst
 * kind — **it stops matching and keeps passing.** A rule quietly narrowed by a regex edit produces a
 * green CI run and no other signal at all.
 *
 * So every forbidden pattern is planted here and asserted to be **caught**, and then removed and asserted
 * to pass. `test/forbidden-strings.test.ts` and `test/tarball-rules.test.ts` cover the two libraries case
 * by case; this file is the composed check — a whole plausible package, one defect at a time.
 */

/** A manifest a real published package would have. */
const cleanManifest: PackedManifest = {
  name: "@lazslov/content",
  version: "0.1.0",
  files: ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  dependencies: { "@lazslov/api-core": "^0.1.0" },
  exports: { ".": {}, "./fields": {}, "./next": {} },
};

/** The file list a real published package would have. */
const cleanFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/index.d.cts",
  "dist/next/index.js",
];

/** Run both halves of the audit over one candidate tarball. */
function audit(
  files: readonly string[],
  manifest: PackedManifest = cleanManifest,
  contents = "",
): string[] {
  const violations = checkTarball({ packageDir: "content", files, manifest }).map(
    (violation) => violation.rule,
  );
  const findings = scanText(contents, { tenantSlugs: ["acme_foundation"] }).map(
    (finding) => finding.rule,
  );
  return [...violations, ...findings];
}

describe("a clean package passes", () => {
  it("reports nothing at all", () => {
    // The control. Without it, every assertion below could be passing because the audit fails on
    // everything.
    expect(audit(cleanFiles)).toEqual([]);
  });
});

describe("each forbidden file is caught", () => {
  it.each([
    ["contracts/content-service.openapi.yaml", "a pinned contract directory"],
    ["dist/content-service.openapi.yaml", "an OpenAPI document copied into dist"],
    ["dist/openapi.yaml", "an OpenAPI document under its bare name"],
    ["dist/openapi.json", "the JSON form of one"],
    [".env", "an environment file"],
    [".env.production", "a suffixed environment file"],
    [".npmrc", "an npm config, which can carry an auth token"],
    ["tsconfig.json", "a TypeScript config"],
    ["dist/index.test.js", "a test file"],
    ["test/stubs/fetch.ts", "a test directory"],
    ["fixtures/hmac/valid.json", "a fixture directory"],
    ["src/index.ts", "source outside dist"],
  ])("catches %s — %s", (file) => {
    const rules = audit([...cleanFiles, file]);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("passes again once the file is removed", () => {
    // The other half of the assertion. A rule that fails on everything is not a rule.
    expect(audit([...cleanFiles, "contracts/x.openapi.yaml"])).not.toEqual([]);
    expect(audit(cleanFiles)).toEqual([]);
  });
});

describe("each forbidden string is caught, in any packed file", () => {
  it.each([
    ["https://content.lamido.hu/api", "deployment-domain"],
    ["the host is content.lamido.hu", "deployment-domain"],
    ["https://internal.example.net/api", "non-example-host"],
    ["csk_9Kd2mQx7RtY4wZ1nB8vC3jL6", "credential"],
    ["whsec_9Kd2mQx7RtY4wZ1nB8vC3jL6", "credential"],
    ["site acme_foundation is live", "tenant-slug"],
  ])("catches %s as %s", (line, rule) => {
    expect(audit(cleanFiles, cleanManifest, line)).toContain(rule);
  });

  it("still passes the placeholders and prefixes the SDK legitimately contains", () => {
    // These must NOT be caught: the browser guard matches on bare prefixes, and every README and test
    // uses `_YOUR_` placeholders. A scan that flagged them would be turned off within a week.
    const legitimate = [
      "csk_YOUR_SECRET_KEY",
      "pmk_YOUR_MERCHANT_KEY_test00",
      "whsec_EXAMPLE_TEST_SECRET_0123456789",
      'serverOnlyPrefixes: ["csk_", "isk_", "pmk_"]',
      "https://content.example.com",
      "http://localhost:3000",
      "https://github.com/lazslov/lamido-api-sdk",
    ].join("\n");

    expect(audit(cleanFiles, cleanManifest, legitimate)).toEqual([]);
  });
});

describe("each forbidden manifest shape is caught", () => {
  it("catches a runtime dependency that is not api-core", () => {
    const manifest = { ...cleanManifest, dependencies: { zod: "^3.0.0" } };
    expect(audit(cleanFiles, manifest)).toContain("dependency-policy");
  });

  it("catches a peer arriving as a runtime dependency", () => {
    // `next` belongs in peerDependencies. As a dependency it would install Next for every consumer.
    const manifest = { ...cleanManifest, dependencies: { next: "^16.0.0" } };
    expect(audit(cleanFiles, manifest)).toContain("dependency-policy");
  });

  it("catches a widened files allowlist", () => {
    const manifest = { ...cleanManifest, files: ["dist", "src", "README.md", "LICENSE"] };
    expect(audit(cleanFiles, manifest)).toContain("files-allowlist-declared");
  });

  it("catches a missing files allowlist, because an ignore list fails open", () => {
    const { files: _dropped, ...manifest } = cleanManifest;
    expect(audit(cleanFiles, manifest)).toContain("files-allowlist-declared");
  });

  it("catches a wildcard export subpath", () => {
    const manifest = { ...cleanManifest, exports: { ".": {}, "./*": {} } };
    expect(audit(cleanFiles, manifest)).toContain("no-wildcard-exports");
  });
});
