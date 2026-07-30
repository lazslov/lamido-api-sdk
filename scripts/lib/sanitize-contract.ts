/**
 * Text transforms applied to every pinned contract on import (phase 1 §4).
 *
 * @remarks
 * Deliberately line-based rather than YAML round-tripping: the pinned file stays
 * byte-identical to upstream everywhere it is not rewritten, so a contract update is a
 * reviewable diff instead of a reserialisation. The same functions run in the drift check,
 * so upstream and pinned are always compared after identical sanitisation.
 */

/** What sanitisation changed, for the import log and for the drift check's reporting. */
export interface SanitizeResult {
  /** The sanitised document. */
  readonly yaml: string;
  /** Whether a top-level `servers:` block was found and replaced. */
  readonly serversReplaced: boolean;
  /** How many deployment or example hostnames were rewritten outside `servers:`. */
  readonly hostRewrites: number;
}

/**
 * Replace the deployment host in a contract's `servers:` block with a `{baseUrl}` template.
 *
 * @param yaml - Contract source.
 * @param exampleHost - Documentation placeholder used as the template variable's default.
 * @returns The rewritten document, and whether a block was actually found.
 */
export function replaceServersBlock(
  yaml: string,
  exampleHost: string,
): { yaml: string; replaced: boolean } {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^servers:\s*$/.test(line));
  if (start === -1) return { yaml, replaced: false };

  // The block runs to the last indented line after `servers:`. Blank lines inside it are
  // consumed; blank lines and column-0 comments that follow it are left where they are.
  let cursor = start + 1;
  let lastBlockLine = start;
  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    if (line.trim() === "") {
      cursor += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      lastBlockLine = cursor;
      cursor += 1;
      continue;
    }
    break;
  }

  const template = [
    "servers:",
    "  # The deployment host is deliberately absent from this pinned copy. No host ships in",
    "  # a tarball, and contracts/ is one `files` mistake away from being published — see",
    "  # docs/plans/phase-1-foundations.md §4. The consuming project supplies the base URL",
    "  # from its own environment; the SDK has no fallback.",
    '  - url: "{baseUrl}"',
    "    description: Supplied by the consuming project from its own environment.",
    "    variables:",
    "      baseUrl:",
    `        default: ${exampleHost}`,
    "        description: Documentation placeholder, not a usable default.",
  ];

  lines.splice(start, lastBlockLine - start + 1, ...template);
  return { yaml: lines.join("\n"), replaced: true };
}

/**
 * Rewrite hostnames that survive outside `servers:` — a webhook URL example, a contact
 * link — to documentation placeholders.
 *
 * @param yaml - Contract source.
 * @returns The rewritten document and the number of substitutions.
 * @remarks
 * Two families: the deployment domain, which must never ship; and `acme.hu`, the fictional
 * merchant domain upstream uses in examples, normalised so this repository has exactly one
 * documentation-domain convention and the leak guard needs no extra allowance for it.
 */
export function redactExampleHosts(yaml: string): { yaml: string; rewrites: number } {
  let rewrites = 0;

  const withoutDeploymentDomain = yaml.replace(
    /([A-Za-z0-9-]+\.)?lamido\.hu/gi,
    (_match, subdomain: string | undefined) => {
      rewrites += 1;
      return `${subdomain ?? ""}example.com`;
    },
  );

  const withoutFictionalMerchant = withoutDeploymentDomain.replace(/\bacme\.hu\b/gi, () => {
    rewrites += 1;
    return "acme.example.com";
  });

  return { yaml: withoutFictionalMerchant, rewrites };
}

/**
 * Apply every import-time transform to a contract.
 *
 * @param yaml - Upstream contract source.
 * @param exampleHost - Documentation placeholder for this service.
 */
export function sanitizeContract(yaml: string, exampleHost: string): SanitizeResult {
  const servers = replaceServersBlock(yaml, exampleHost);
  const hosts = redactExampleHosts(servers.yaml);
  return { yaml: hosts.yaml, serversReplaced: servers.replaced, hostRewrites: hosts.rewrites };
}
