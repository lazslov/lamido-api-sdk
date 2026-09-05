import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dedupeOperations } from "../scripts/lib/dedupe-operations.js";
import { generatedSchemaPath, services } from "../scripts/lib/paths.js";

/**
 * The generator's one rewrite of machine output, and the guard that keeps it narrow.
 *
 * @remarks
 * A rewrite of generated code is a place a real defect can hide. These cases assert the two rules
 * that stop it: an identical repeat goes, a differing one throws, and the committed files carry no
 * duplicate member either way.
 */

/** A generated `operations` interface holding the named members, in order. */
function operationsModule(...members: { name: string; body: string }[]): string {
  const blocks = members
    .map(({ name, body }) => `    ${name}: {\n        ${body}\n    };\n`)
    .join("");
  return `export interface components {\n    schemas: never;\n}\nexport interface operations {\n${blocks}}\n`;
}

describe("dedupeOperations", () => {
  it("drops a byte-identical repeat and names it", () => {
    const source = operationsModule(
      { name: "listThings", body: "responses: never;" },
      { name: "cronDrain", body: "responses: never;" },
      { name: "cronDrain", body: "responses: never;" },
    );
    const result = dedupeOperations(source);

    expect(result.removed).toEqual(["cronDrain"]);
    expect(result.source.match(/cronDrain: \{/g)).toHaveLength(1);
    // Everything else survives, in place.
    expect(result.source).toContain("listThings: {");
    expect(result.source.trimEnd().endsWith("}")).toBe(true);
  });

  it("throws when two members share an id and differ", () => {
    // A genuine collision is a contract error a human has to read, not something to absorb.
    const source = operationsModule(
      { name: "createThing", body: "responses: never;" },
      { name: "createThing", body: "requestBody: never;" },
    );
    expect(() => dedupeOperations(source)).toThrow(/declared twice with different shapes/);
  });

  it("leaves a module with no duplicates exactly as it found it", () => {
    const source = operationsModule(
      { name: "one", body: "responses: never;" },
      { name: "two", body: "responses: never;" },
    );
    expect(dedupeOperations(source)).toEqual({ source, removed: [] });
  });

  it("leaves a module with no operations interface alone", () => {
    const source = "export interface components {\n    schemas: never;\n}\n";
    expect(dedupeOperations(source)).toEqual({ source, removed: [] });
  });
});

describe("the committed schemas", () => {
  it.each(services.map((service) => service.id))("%s declares each operation once", (id) => {
    // The end-to-end assertion: whatever the contract does, the file in the tree compiles.
    const service = services.find((candidate) => candidate.id === id);
    if (!service) throw new Error(`${id} is not a pinned service`);

    const source = readFileSync(generatedSchemaPath(service), "utf8");
    expect(dedupeOperations(source).removed).toEqual([]);
    expect(path.basename(generatedSchemaPath(service))).toBe("schema.ts");
  });
});
