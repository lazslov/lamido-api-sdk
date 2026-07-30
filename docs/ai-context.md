# AI context

Durable project context that is not obvious from the code or the git history. The build plan
itself lives in [plans/](plans/) — this file records decisions and facts that sit *outside*
it.

## Where things are

- **The knowledge base is a separate repository**, expected at `../knowledge-base` (override
  with `LAMIDO_KB_PATH`, or pass a path to `pnpm contracts:import` / `pnpm contracts:drift`).
  It is deliberately not a submodule. Contracts are pinned copies under `contracts/`, with
  provenance in `contracts/CONTRACTS.json`.
- The service *behaviour* — what a 404 means, when a retry is safe, what an omitted field
  means — lives only in that repository's Markdown. `contracts/*.openapi.yaml` is the
  authority on shapes. When the two disagree, the Markdown wins and the YAML is a bug.

## Phase 1 decisions, and where they deviate from the plan

Phase 1 is complete. Everything below was decided while implementing it and is not recorded
in `plans/phase-1-foundations.md`.

- **Sanitisation is broader than "strip `servers:`".** The plan's rule covers the `servers`
  block; the invariant it serves ("no host in a tarball") covers the whole document, so
  `scripts/lib/sanitize-contract.ts` also rewrites the deployment domain wherever else it
  appears, and normalises upstream's fictional `acme.hu` merchant domain to
  `acme.example.com`. Import and drift-check share one sanitiser, so drift reports contract
  changes rather than host-template noise.
- **The tenant-slug deny list is not committed.** A real client's slug in a tracked deny list
  would itself leak the tenant identity the rule protects, so slugs come from an untracked
  `.leakguard-slugs` file or `LEAKGUARD_TENANT_SLUGS`.
- **The tarball audit checks a fixed expectation, not the manifest's own `"files"`.**
  Comparing a tarball to the field npm packed it *from* can never fail. `requiredFilesField`
  and `expectedEntries` in `scripts/lib/tarball-rules.ts` are the expectation; widening what
  ships means editing them, which is a reviewable diff.
- **Subpath exports arrive with the phase that builds them.** The plan's §3 example shows
  `./fields` and `./next` on `@lamido/content`; declaring them before the files exist would
  fail `publint` and `attw`, so each package ships only `.` for now.
- **`exports` names types per condition** (`import.types` / `require.types`) rather than one
  shared `types` key, plus top-level `main`/`types` for the legacy resolver. This is what
  makes `attw` clean on all four resolution modes, which the plan's own exit criteria require.
- **No sourcemaps in published tarballs.** They embed original source text and are the
  likeliest leak vector. The audit still scans any `.map` it finds.
- **Build runs `tsdown --config-loader tsx`.** The shared options in `tsdown.base.ts` are
  imported through a NodeNext `.js` specifier, which tsdown's default native config loader
  cannot resolve.
- **TypeScript is pinned to 5.9, not 7.** Declaration emit for four published packages is not
  the place to be first onto the native rewrite. Revisit once `rolldown-plugin-dts` states
  support.
- **Dev tooling beyond the plan's list:** `tsx` (runs the `.ts` scripts on Node 20, which has
  no native type stripping) and `@types/node`. Both are dev-only and never packed.
- **`biome.jsonc`, not `biome.json`** — Biome will not parse comments in a `.json` config, and
  the ignore entries need their reasons stated.

## Open questions

- **Licence.** All four packages are MIT with `Copyright (c) 2026 Lamido`, chosen so the
  packages are publishable and `publint` is clean. The licence and the copyright holder were
  never specified — confirm before phase 8 publishes anything.
- **The knowledge base has an unmerged fix.** Branch `fix/openapi-yaml-scalars` in
  `../knowledge-base` quotes two `description` scalars that contained `: ` inside backticks,
  which made `content-service/openapi.yaml` and `payment-service/openapi.yaml` unparseable as
  YAML. Committed locally, not pushed. Until it merges, a fresh clone of the knowledge base
  cannot generate types, and `pnpm contracts:drift` will report the pinned copies as ahead.
