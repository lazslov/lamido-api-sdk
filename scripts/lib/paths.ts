import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directory holding the pinned copies of the knowledge base's OpenAPI contracts. */
export const contractsDir = path.join(repoRoot, "contracts");

/** Provenance file recording which knowledge-base commit each pinned contract came from. */
export const contractsManifest = path.join(contractsDir, "CONTRACTS.json");

/**
 * One published package that is generated from an upstream contract.
 *
 * @remarks
 * `@lazslov/api-core` is absent by design — it has no contract of its own.
 */
export interface ServiceDescriptor {
  /** Knowledge-base folder name, and the key used in `CONTRACTS.json`. */
  readonly id: "content-service" | "invoice-service" | "payment-service";
  /** Workspace directory under `packages/`. */
  readonly pkg: "content" | "invoice" | "payment";
  /**
   * Host written into the pinned contract's `servers` template default, replacing
   * the deployment host. Documentation-only; never a fallback the SDK would use.
   */
  readonly exampleHost: string;
}

/** The three contract-backed service packages, in the order the phases build them. */
export const services: readonly ServiceDescriptor[] = [
  { id: "content-service", pkg: "content", exampleHost: "https://content.example.com" },
  { id: "invoice-service", pkg: "invoice", exampleHost: "https://invoice.example.com" },
  { id: "payment-service", pkg: "payment", exampleHost: "https://payment.example.com" },
];

/** Every published package directory name, core first — the order `pnpm -r` builds them in. */
export const packageDirs = ["api-core", "content", "invoice", "payment", "telemetry"] as const;

/** Absolute path of a package directory. */
export function packagePath(dir: string): string {
  return path.join(repoRoot, "packages", dir);
}

/** Absolute path of a pinned contract. */
export function contractPath(service: ServiceDescriptor): string {
  return path.join(contractsDir, `${service.id}.openapi.yaml`);
}

/** Absolute path of the generated schema module for a service package. */
export function generatedSchemaPath(service: ServiceDescriptor): string {
  return path.join(packagePath(service.pkg), "src", "generated", "schema.ts");
}

/**
 * Locate the knowledge-base checkout that contracts are imported from.
 *
 * @param override - Explicit path, usually from `argv`.
 * @returns Absolute path to a directory containing the service doc folders.
 * @throws If no candidate exists — the caller cannot proceed without the source of truth.
 * @remarks
 * Resolution order: the argument, then `LAMIDO_KB_PATH`, then a `knowledge-base`
 * sibling of this repository. The knowledge base is intentionally *not* a submodule
 * (phase 1 §4), so its location is a local fact, never a committed one.
 */
export function resolveKnowledgeBase(override?: string): string {
  const candidates = [
    override,
    process.env.LAMIDO_KB_PATH,
    path.resolve(repoRoot, "..", "knowledge-base"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, "content-service", "openapi.yaml"))) return resolved;
  }

  throw new Error(
    "Cannot find the knowledge-base checkout. Pass it as an argument or set LAMIDO_KB_PATH.\n" +
      `Tried: ${candidates.join(", ")}`,
  );
}
