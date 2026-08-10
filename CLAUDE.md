# CLAUDE.md

## Working rules

These rules are non-negotiable and apply to every change.

### 1. Code quality
- All code must be **clean and well-commented**. Comments explain *why*, not *what*.
- Use meaningful names. Prefer clarity over cleverness.
- **Use TSDoc for all exported symbols** — every exported `function`, `class`, `interface`, `type`, and `const` must have a TSDoc comment (`/** … */`).
  - Use `@param`, `@returns`, `@throws`, `@example`, and `@remarks` where appropriate.
  - Keep descriptions concise: one sentence for simple items, a short paragraph for complex ones.
  - Do **not** repeat what the type signature already says — focus on intent, constraints, and non-obvious behaviour.

### 2. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- **Always ask questions** if an instruction is unclear, ambiguous, or missing details.
- **Do not decide on your own.** When in doubt about scope, design choices, naming, file layout, dependencies, or interpretation — **ask first**.
- This applies even to small choices that feel obvious. Confirm before acting.

## 3. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- **Always** split functionality into components and modules.
- **Never** create large monolithic files. If a file grows long, split it into smaller component files by responsibility.
- One concern per module. Separate parts go into separate files.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 4. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Tests are mandatory
- **Always** write tests alongside the implementation.
- Run `pnpm test` after writing a test and confirm it passes before reporting work as done.
- Test files are named after the concern they guard — `test/theme.test.ts`,
  `packages/payment/test/money.test.ts` — and live flat in a `test/` directory, never in a
  per-layer subdirectory. Module stubs go in `test/stubs/`.
- This is a pnpm workspace, so `test/` exists at two levels and Vitest collects both:
  - `packages/<pkg>/test/**/*.test.ts` for a package's own behaviour, next to its `src/`;
  - `test/**/*.test.ts` at the root for repository-level concerns — the guardrails in
    `scripts/lib/`, and invariants compared *across* the four packages.
- `pnpm verify` is the full gate: lint, leak guard, type-check, test, build, tarball audit.

## 6. Answer in Simplified Technical English

**Write every answer in ASD-STE100 Simplified Technical English.**

Always answer in English. Answer in English also when the user writes in Hungarian
or in another language.

This applies to all prose you write for the user: chat answers, plans, commit messages,
PR descriptions, code comments, and TSDoc.

- Use one idea per sentence. Keep instructions to 20 words or less, descriptive text to 25 words or less.
- Use the active voice. Name the actor: "The service validates the token", not "The token is validated".
- Use the simple present tense when possible. Do not use complex tense forms.
- Use one term for one thing. Do not use synonyms for a technical term.
- Do not use noun clusters of more than three words.
- Do not use verbs as nouns. Write "when you configure the client", not "at client configuration time".
- Do not use idioms, jokes, or metaphors.
- Write one topic per paragraph, and keep paragraphs to six sentences or less.
- Write lists as vertical lists, not as long sentences.

Code identifiers, error strings, and quoted output keep their original text.

## Memory

When you learn important project context, update `docs/ai-context.md` instead of relying only on user-level memory.