import { describe, expect, it } from "vitest";
import { diffContracts, formatDiff, isUnchanged } from "../scripts/lib/contract-diff.js";

/**
 * The half of the drift protocol that decides whether anyone acts on it.
 *
 * @remarks
 * "The pinned contract differs from the knowledge base" is true of a fixed typo and of a deleted
 * endpoint alike, and an issue that says only that gets closed unread. These cases pin the
 * distinctions that make the report worth opening.
 */

/** A minimal document, so each case shows only what it is about. */
function contract(paths: string, schemas = "    Page:\n      type: object\n"): string {
  return `openapi: 3.1.0\ninfo:\n  title: t\n  version: "1"\npaths:\n${paths}components:\n  schemas:\n${schemas}`;
}

const base = contract(
  '  /api/pages/{slug}:\n    get:\n      operationId: getPage\n      responses:\n        "200":\n          description: ok\n',
);

describe("diffing two contracts", () => {
  it("finds nothing when they are identical", () => {
    expect(isUnchanged(diffContracts(base, base))).toBe(true);
  });

  it("names an added operation", () => {
    const upstream = contract(
      '  /api/pages/{slug}:\n    get:\n      operationId: getPage\n      responses:\n        "200":\n          description: ok\n    delete:\n      operationId: deletePage\n',
    );
    expect(diffContracts(base, upstream).operations.added).toEqual(["DELETE /api/pages/{slug}"]);
  });

  it("names a removed operation", () => {
    const upstream = contract("  /api/health:\n    get:\n      operationId: getHealth\n");
    const { added, removed } = diffContracts(base, upstream).operations;
    expect(removed).toEqual(["GET /api/pages/{slug}"]);
    expect(added).toEqual(["GET /api/health"]);
  });

  it("names an operation whose definition changed", () => {
    // The case that matters most and is easiest to miss: same path, same verb, different
    // behaviour. A 404 added to a response set is exactly the kind of change the wrappers encode.
    const upstream = contract(
      '  /api/pages/{slug}:\n    get:\n      operationId: getPage\n      responses:\n        "200":\n          description: ok\n        "404":\n          description: absent\n',
    );
    const { added, removed, changed } = diffContracts(base, upstream).operations;
    expect(changed).toEqual(["GET /api/pages/{slug}"]);
    expect([...added, ...removed]).toEqual([]);
  });

  it("names schema changes separately from operations", () => {
    const upstream = contract(
      '  /api/pages/{slug}:\n    get:\n      operationId: getPage\n      responses:\n        "200":\n          description: ok\n',
      "    Page:\n      type: object\n    Section:\n      type: object\n",
    );
    const diff = diffContracts(base, upstream);
    expect(diff.schemas.added).toEqual(["Section"]);
    expect(isUnchanged(diff)).toBe(false);
  });

  it("ignores keys under a path that are not operations", () => {
    // `parameters` and `summary` sit beside the verbs and are not endpoints.
    const upstream = contract(
      '  /api/pages/{slug}:\n    summary: a page\n    parameters: []\n    get:\n      operationId: getPage\n      responses:\n        "200":\n          description: ok\n',
    );
    expect(diffContracts(base, upstream).operations.added).toEqual([]);
  });
});

describe("the issue body", () => {
  it("lists what moved, under a heading naming the service", () => {
    const upstream = contract("  /api/health:\n    get:\n      operationId: getHealth\n");
    const body = formatDiff("content-service", diffContracts(base, upstream));

    expect(body).toContain("### content-service");
    expect(body).toContain("`GET /api/health`");
    expect(body).toContain("`GET /api/pages/{slug}`");
  });

  it("says so plainly when only prose changed", () => {
    // A byte-different contract with no structural change is a real outcome — a description or a
    // comment. Reporting an empty list would read as a bug in the detector.
    const body = formatDiff("invoice-service", diffContracts(base, base));
    expect(body).toContain("no operation or schema moved");
  });
});
