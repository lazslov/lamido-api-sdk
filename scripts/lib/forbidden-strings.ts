import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.js";

/**
 * The guard from phase 1 §5.1: nothing about a deployment — host, credential or tenant
 * identity — may appear in anything that could reach a tarball.
 *
 * @remarks
 * `scripts/` is deliberately outside the scan scope, because this file necessarily spells
 * out the very strings it forbids. Scripts are devDependencies of the repository and are
 * never packed; the `"files"` allowlist in each package is what keeps them out.
 */

/** Which rule a finding violates. */
export type RuleId = "deployment-domain" | "non-example-host" | "credential" | "tenant-slug";

/** A single violation, located and safe to print. */
export interface Finding {
  readonly rule: RuleId;
  /** 1-based line number. */
  readonly line: number;
  /** Human-readable reason, suitable for a CI log. */
  readonly reason: string;
  /** The offending line with any credential-shaped text masked. */
  readonly excerpt: string;
}

/** Configuration for a scan. */
export interface ScanOptions {
  /**
   * Tenant slugs that must not appear. Never hard-coded: a real client's slug in a
   * committed deny list would itself leak the tenant identity the rule protects.
   * @see loadTenantSlugs
   */
  readonly tenantSlugs?: readonly string[];
}

/** The deployment domain, in any subdomain form. */
const deploymentDomain = /\blamido\.hu\b/i;

/** Any absolute URL. The host is extracted and checked against the allowlist below. */
const urlPattern = /\bhttps?:\/\/([A-Za-z0-9._:-]+)/g;

/**
 * Hosts allowed to appear in source, contracts and READMEs.
 *
 * Documentation placeholders plus a short, deliberate list of hosts that are references
 * rather than deployments. Every addition here is a reviewable diff — that is the point.
 */
const allowedHosts = new Set([
  "example.com",
  "example.org",
  "localhost",
  "127.0.0.1",
  // Repository and registry links in package metadata, READMEs and upstream contracts.
  "github.com",
  "registry.npmjs.org",
  // Schema and licence references.
  "json.schemastore.org",
  "spdx.org",
  "opensource.org",
  // The Telegram Bot API host — @lazslov/telemetry's alert channel (OB-14). A vendor
  // reference fixed by Telegram, not a deployment of ours.
  "api.telegram.org",
]);

/**
 * Key prefixes for the seven services' credential tiers, plus webhook signing secrets.
 *
 * @remarks
 * Every tier of every service, the browser-safe ones included: a publishable key is not a secret,
 * but a real one still names a tenant, and tenant identity is not ours to commit.
 */
export const credentialPrefixes =
  "cpk|csk|cad|isk|iad|pmk|pad|apk|ask|aad|bpk|bsk|bad|esk|ead|wpk|wsk|wad|whsec";

/**
 * A credential-shaped token: a tier prefix and at least twelve characters of payload.
 *
 * @remarks
 * A **function** rather than a shared constant, because a `g` regular expression carries
 * `lastIndex` between calls and two callers sharing one object skip matches at random.
 *
 * Exported so the import sanitisers rewrite exactly what this guard rejects, rather than keeping a
 * second pattern of their own. Two patterns would drift, and the one that drifted would be the
 * sanitiser — which fails *open*. Same reasoning as {@link isAllowedHost}.
 */
export function credentialShaped(): RegExp {
  return new RegExp(`\\b(${credentialPrefixes})_([A-Za-z0-9_-]{12,})\\b`, "g");
}

/** Placeholder tails that mark a documentation example rather than a real key. */
const placeholderTail = /^(YOUR|EXAMPLE)_/;

/**
 * True when a URL's host is a documentation placeholder or an allowed reference.
 *
 * @remarks
 * Exported so the doc-example extractor can rewrite anything this would reject, rather than keeping a
 * second list of what counts as allowed. Two lists would drift, and the one that drifted would be the
 * sanitiser — which fails *open*.
 */
export function isAllowedHost(hostWithPort: string): boolean {
  const host = hostWithPort
    .replace(/:\d+$/, "")
    // A trailing dot is sentence punctuation from prose, or an absolute-FQDN root label.
    // Either way it is not part of the name being checked.
    .replace(/\.+$/, "")
    .toLowerCase();
  if (allowedHosts.has(host)) return true;
  // Any subdomain of the documentation domains, e.g. content.example.com.
  return host.endsWith(".example.com") || host.endsWith(".example.org");
}

/** Replace credential-shaped text so a finding can be logged without reprinting a secret. */
function maskCredentials(line: string): string {
  return line.replace(credentialShaped(), (match, prefix: string, tail: string) =>
    placeholderTail.test(tail) ? match : `${prefix}_<redacted:${tail.length}chars>`,
  );
}

/**
 * Scan text for anything deployment-specific.
 *
 * @param text - File contents.
 * @param options - Tenant slugs to additionally forbid.
 * @returns One finding per violation, in line order. Empty means clean.
 */
export function scanText(text: string, options: ScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const slugs = options.tenantSlugs ?? [];

  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const excerpt = () => maskCredentials(line.trim()).slice(0, 200);

    if (deploymentDomain.test(line)) {
      findings.push({
        rule: "deployment-domain",
        line: lineNumber,
        reason: "the deployment domain appears in a file that could be packed",
        excerpt: excerpt(),
      });
    }

    for (const [, host] of line.matchAll(urlPattern)) {
      if (host && !isAllowedHost(host)) {
        findings.push({
          rule: "non-example-host",
          line: lineNumber,
          reason: `host "${host}" is neither a documentation placeholder nor an allowed reference`,
          excerpt: excerpt(),
        });
      }
    }

    for (const [, prefix, tail] of line.matchAll(credentialShaped())) {
      if (tail && !placeholderTail.test(tail)) {
        findings.push({
          rule: "credential",
          line: lineNumber,
          reason: `a ${prefix}_ key with ${tail.length} characters of payload — real credentials never belong in the repository`,
          excerpt: excerpt(),
        });
      }
    }

    for (const slug of slugs) {
      if (new RegExp(`\\b${escapeRegExp(slug)}\\b`, "i").test(line)) {
        findings.push({
          rule: "tenant-slug",
          line: lineNumber,
          reason: "a configured tenant slug appears — tenant identity is not ours to ship",
          excerpt: excerpt(),
        });
      }
    }
  });

  return findings;
}

/** Escape a literal string for use inside a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the tenant slugs to forbid.
 *
 * @returns Slugs from `LEAKGUARD_TENANT_SLUGS` (comma-separated) and from an untracked
 * `.leakguard-slugs` file, one per line, `#` for comments.
 * @remarks
 * Both sources are outside version control on purpose — see {@link ScanOptions.tenantSlugs}.
 */
export function loadTenantSlugs(): string[] {
  const fromEnv = (process.env.LEAKGUARD_TENANT_SLUGS ?? "").split(",");

  const slugFile = path.join(repoRoot, ".leakguard-slugs");
  const fromFile = existsSync(slugFile)
    ? readFileSync(slugFile, "utf8")
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("#"))
    : [];

  return [...fromEnv, ...fromFile].map((slug) => slug.trim()).filter((slug) => slug.length > 0);
}

/** Format one file's findings as indented CI log lines. */
export function formatFindings(file: string, findings: readonly Finding[]): string {
  return findings
    .map((f) => `  ${file}:${f.line}  [${f.rule}] ${f.reason}\n      ${f.excerpt}`)
    .join("\n");
}
