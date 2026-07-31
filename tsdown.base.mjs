/**
 * Build options shared by every published package, so the output shape cannot drift
 * between them. Each package's `tsdown.config.mjs` passes these through unchanged.
 *
 * Plain `.mjs`, not TypeScript, and imported by a `.mjs` config: tsdown loads a config with a bare
 * `import()`, so both files have to be loadable by Node itself on every version that builds this
 * repository. A `.ts` config needs either Node's own type stripping (22.18+, so not the Node 20 CI
 * runs on) or tsdown's `--config-loader tsx`, whose loader hooks fail on Node 24. Neither is a
 * dependency worth having for twenty lines of options that no type checks better than a failing
 * build already does.
 *
 * @see docs/plans/phase-1-foundations.md §3
 * @type {import("tsdown").UserConfig}
 */
export const sharedOptions = {
  entry: ["src/index.ts"],
  // Dual output: ESM is what every current toolchain wants, CJS keeps a `require` in a
  // client project's scripts/ directory from becoming a support conversation.
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // No sourcemaps in a published tarball. They embed original source text and are the
  // likeliest leak vector; nothing in the plan asks consumers to step through this code.
  sourcemap: false,
  // The packages are `"type": "module"`, so ESM is plain `.js` and only CJS needs an
  // explicit extension. Keeps each exports map readable.
  outExtensions: ({ format }) =>
    format === "es" ? { js: ".js", dts: ".d.ts" } : { js: ".cjs", dts: ".d.cts" },
};
