import type { UserConfig } from "tsdown";

/**
 * Build options shared by every published package, so the output shape cannot drift
 * between them. Each package's `tsdown.config.ts` passes these through unchanged.
 *
 * @remarks
 * Each package builds with `tsdown --config-loader tsx`: tsdown's default loader imports the
 * config natively, which cannot resolve this file through the `.js` specifier that NodeNext
 * requires. The tsx loader performs that mapping.
 *
 * @see docs/plans/phase-1-foundations.md §3
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
    format === "es"
      ? { js: ".js" as const, dts: ".d.ts" as const }
      : { js: ".cjs" as const, dts: ".d.cts" as const },
} satisfies UserConfig;
