import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFiles } from "../../../scripts/lib/walk.js";
import { createContentClient } from "../src/client/create.js";
import * as fields from "../src/fields/index.js";
import * as content from "../src/index.js";
import { createWebsiteClient } from "../src/website/create.js";
import { testBaseUrl, testPublishableKey, testSecretKey } from "./stubs/fetch.js";

/**
 * What this package promises, and what it promises *not* to offer. Several of phase 3's exit
 * criteria are about an absence — no admin endpoint, no whole-document write — and an absence is
 * only enforceable from the surface and from the source text.
 */

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every hand-written source file, as text. The generated contract is excluded deliberately. */
function sourceText(): string {
  return listFiles(srcDir)
    .filter((file) => file.endsWith(".ts") && !file.includes(`${path.sep}generated${path.sep}`))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

const websiteMethods = Object.keys(
  createWebsiteClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
).sort();

const clientMethods = Object.keys(
  createContentClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
).sort();

describe("the main entry's runtime exports", () => {
  it("are exactly what phase 3 specifies", () => {
    expect(Object.keys(content).sort()).toEqual([
      "ContentApiError",
      "VERSION",
      "createContentClient",
      "createWebsiteClient",
      "signatureHeader",
      "timestampHeader",
      "tryCreateContentClient",
      "tryCreateWebsiteClient",
      "verifyRevalidationWebhook",
    ]);
  });
});

describe("the fields entry", () => {
  it("exports the coercions, the preparer and the shared predicate, and nothing else", () => {
    expect(Object.keys(fields).sort()).toEqual([
      "asImage",
      "asRichtext",
      "asRows",
      "asText",
      "isValidContentUrl",
      "prepareValues",
    ]);
  });

  it("imports nothing, so a client component can hold it", () => {
    const fieldFiles = listFiles(path.join(srcDir, "fields")).filter((file) =>
      file.endsWith(".ts"),
    );
    for (const file of fieldFiles) {
      const text = readFileSync(file, "utf8");
      // Relative imports inside the leaf are fine; anything from another module is not.
      expect(text, file).not.toMatch(/from\s+"@lazslov\/api-core"/);
      expect(text, file).not.toMatch(/from\s+"\.\.\//);
    }
  });
});

describe("the website tier", () => {
  it("offers the six published reads plus health, and no write", () => {
    expect(websiteMethods).toEqual([
      "getCollection",
      "getCollectionItem",
      "getDatasetAggregate",
      "getHealth",
      "getPage",
      "getSite",
      "listPages",
    ]);
  });
});

describe("the client tier", () => {
  it("offers every consumer endpoint the tier documents, and the two composites", () => {
    expect(clientMethods).toEqual(
      [
        "archiveItem",
        "createItem",
        "createRecord",
        "createUploadToken",
        "deleteAsset",
        "deleteItem",
        "deleteRecord",
        "diffDrafts",
        "getAssetIdByUrl",
        "getItem",
        "getMe",
        "getPageStructure",
        "getRecord",
        "getRecords",
        "getRenderedPage",
        "getVersion",
        "listAssets",
        "listCollections",
        "listDatasets",
        "listItems",
        "listPages",
        "listVersions",
        "patchItem",
        "patchRecord",
        "patchValues",
        "publishItem",
        "publishPage",
        "registerAsset",
        "reorderItems",
        "restoreVersion",
        "revertPage",
        "getDatasetAggregate",
      ].sort(),
    );
  });

  it("has no method that writes a whole document or a whole list", () => {
    // A whole-document save is last-write-wins by construction: the form loaded, something else
    // changed, and Save writes the stale copy back over it.
    const wholeUnitWriters =
      /^(put|set|save|replace|write|update)(Page|Document|Values|List|Items|Collection|Record)s?$/i;
    expect(clientMethods.filter((name) => wholeUnitWriters.test(name))).toEqual([]);
  });

  it("has no publish that reads as section-scoped, because publish is per page", () => {
    expect(clientMethods).not.toContain("publishSection");
    expect(clientMethods.filter((name) => /^publish/.test(name))).toEqual([
      "publishItem",
      "publishPage",
    ]);
  });
});

describe("the source text", () => {
  it("names no admin endpoint", () => {
    // Structure is staff's, not an editor's, and a cad_ key reaches every site.
    expect(sourceText()).not.toMatch(/\/api\/admin/);
  });

  it("names no deployment host, and carries no default base URL", () => {
    expect(sourceText()).not.toMatch(/(?:baseUrl|BASE_URL)\s*[=:]\s*["'`]https?:\/\//);
    expect(sourceText()).not.toMatch(/content\.lamido\.hu/);
  });

  it("sets no fetch mode", () => {
    // invoice-service needs `mode: "same-origin"` for a browser tripwire. content-service has no
    // such tripwire and its docs say not to copy the workaround here.
    expect(sourceText()).not.toMatch(/\bmode:\s*["'](?:same-origin|cors|no-cors)["']/);
  });

  it("never sends a view parameter on the website tier", () => {
    const websiteSource = listFiles(path.join(srcDir, "website"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    // Any value but `published` is a 403 there, for every kind of key.
    expect(websiteSource).not.toMatch(/view:/);
  });

  it("sets no timeout and no retry, which are the caller's to decide", () => {
    expect(sourceText()).not.toMatch(/setTimeout|AbortController/);
  });
});
