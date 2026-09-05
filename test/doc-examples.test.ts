import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../scripts/lib/paths.js";
import { authExamples } from "./lib/doc-examples/auth-service.js";
import { bookingExamples } from "./lib/doc-examples/booking-service.js";
import { contentExamples } from "./lib/doc-examples/content-service.js";
import { emailExamples } from "./lib/doc-examples/email-service.js";
import { invoiceExamples } from "./lib/doc-examples/invoice-service.js";
import { paymentExamples } from "./lib/doc-examples/payment-service.js";
import type { Classifier, DocExample, ServiceExamples } from "./lib/doc-examples/shared.js";
import { webshopExamples } from "./lib/doc-examples/webshop-service.js";
import { checkKeys } from "./lib/type-keys.js";

/**
 * Every JSON example the knowledge base documents, checked against the type the SDK declares for it.
 *
 * @remarks
 * The examples are free, authoritative fixtures — they are what the services' own maintainers wrote down
 * as the shape of a request or a response. The point of checking them is not that they parse. It is that
 * **when a doc example and the SDK disagree, one of them is wrong**, and finding out at commit time is the
 * whole reason this repository exists.
 *
 * Three properties make this a real check rather than a green tick:
 *
 * 1. The key lists are verified **by the compiler** at their definition site — see `./lib/type-keys.ts`.
 *    A list that drifted from its type does not compile.
 * 2. Divergence is checked **in both directions**: a documented key the type does not declare, and a
 *    required key the example does not carry.
 * 3. **Every example must be claimed**, by a type or by an explicit out-of-scope reason. A new example
 *    upstream fails this suite until somebody says what it is. Without that, the whole file would report
 *    green over examples nobody had looked at.
 *
 * The classifiers live in one module per service under `./lib/doc-examples/`, each written against that
 * service's own package. This file is the runner, and the one place the services are listed.
 *
 * Regenerate the fixtures with `pnpm examples:import`; CI asserts the tree is clean afterwards.
 */

/** Read one service's committed examples. */
function examplesOf(service: string): DocExample[] {
  const file = path.join(repoRoot, "test", "fixtures", "doc-examples", `${service}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as DocExample[];
}

/** Which classifier owns an example, if any. */
function classify(example: DocExample, classifiers: readonly Classifier[]): Classifier | undefined {
  return classifiers.find((classifier) => classifier.matches(example));
}

/** Every service with a pinned contract, and its classification. */
const services: readonly ServiceExamples[] = [
  contentExamples,
  invoiceExamples,
  paymentExamples,
  emailExamples,
  authExamples,
  bookingExamples,
  webshopExamples,
];

describe.each(services)(
  "$id's documented examples",
  ({ id, classifiers, minChecked, minTypes }) => {
    const examples = examplesOf(id);

    it("has examples to check at all", () => {
      // Guards the whole file: if extraction silently produced nothing, every assertion below would pass.
      expect(examples.length).toBeGreaterThan(10);
    });

    it("classifies every one of them", () => {
      // The assertion that keeps this suite honest. An example nobody has looked at is a failure, not a
      // pass — otherwise a new upstream shape lands silently and this file reports green over it.
      const unclaimed = examples
        .filter((example) => classify(example, classifiers) === undefined)
        .map(
          (example) => `${example.file}:${example.line} {${Object.keys(example.json as object)}}`,
        );

      expect(unclaimed).toEqual([]);
    });

    it("matches the SDK's declared keys, in both directions", () => {
      const divergences: string[] = [];

      for (const example of examples) {
        const classifier = classify(example, classifiers);
        const target = classifier?.check?.(example);
        if (!target) continue;

        const { undeclared, missing } = checkKeys(target.value, target.spec);
        const where = `${example.file}:${example.line} (${classifier?.id})`;

        // A key the service documents and the SDK's type does not declare. Either the type is behind the
        // service, or the example is wrong — and both are worth a build failure.
        for (const key of undeclared) divergences.push(`${where}: undeclared key "${key}"`);
        // A key the SDK insists on that the documented response omits. Usually the SDK guessing.
        for (const key of missing) divergences.push(`${where}: required key "${key}" absent`);
      }

      expect(divergences).toEqual([]);
    });

    it("actually key-checks a meaningful share of them, against distinct types", () => {
      // Without this the suite above could be green because nothing was checked. It is the same trap the
      // classification rule guards, one level down: a classifier whose `check` was dropped in a refactor
      // silently stops asserting, and every remaining assertion still passes.
      const checked = examples
        .map((example) => classify(example, classifiers))
        .filter((classifier) => classifier?.check !== undefined)
        .map((classifier) => classifier?.id ?? "");

      expect(checked.length, checked.join(", ")).toBeGreaterThanOrEqual(minChecked);
      // More than one type, so a single over-broad classifier cannot be doing all the work.
      expect(new Set(checked).size).toBeGreaterThanOrEqual(minTypes);
    });
  },
);

describe("the fixtures themselves", () => {
  it("carry no deployment host and no credential-shaped string", () => {
    // The docs are full of both; `sanitizeExample` rewrites them on the way in. The repository-wide leak
    // guard scans these files too — this is the assertion that says *why* they are clean.
    for (const { id } of services) {
      const raw = readFileSync(
        path.join(repoRoot, "test", "fixtures", "doc-examples", `${id}.json`),
        "utf8",
      );
      expect(raw, id).not.toMatch(/lamido\.hu/);
      expect(raw, id).not.toMatch(
        /\b(cpk|csk|cad|isk|iad|pmk|pad|apk|ask|aad|bpk|bsk|bad|esk|ead|wpk|wsk|wad|whsec)_(?!YOUR_)[A-Za-z0-9_-]{8,}/,
      );
    }
  });

  it("record where each example came from, so a failure is findable upstream", () => {
    for (const { id } of services) {
      for (const example of examplesOf(id)) {
        expect(example.file).toMatch(/\.(md|http)$/);
        expect(example.line).toBeGreaterThan(0);
        expect(example.context.length).toBeGreaterThan(0);
      }
    }
  });
});
