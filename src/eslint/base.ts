import type { Linter } from 'eslint';

/**
 * The base preset: rules every workspace shares. Plain config objects only
 * (no `plugins`, no plugin import — Phase 0 §5 fact 1): the
 * `@typescript-eslint/*` rule resolves through the plugin the consumer's own
 * config registers (`eslint-config-next/typescript` in a frontend,
 * `typescript-eslint` in a backend).
 *
 * Core rules take no `message` option, so each object's `name` names the
 * bullet it enforces.
 */
const base: Linter.Config[] = [
  {
    // Row 21 — CLAUDE.md "Backend conventions": "`strapi.log`, never
    // `console.log`". CLI scripts print to their terminal on purpose.
    name: '@eumdesigns/rules/base/no-console (CLAUDE.md: strapi.log, never console.log)',
    ignores: ['**/scripts/**'],
    rules: { 'no-console': 'error' },
  },
  {
    // Row 153 — ~/.claude/CLAUDE.md "Code": "No single-letter variable or
    // parameter names". Warn until a fix batch per repo (DECISIONS 2026-10-28
    // "P4.87 v0 lands in `misdreavus79/rules` alone").
    // Card id-denylist, without `data` and `item` (same DECISIONS line).
    name: '@eumdesigns/rules/base/names (~/.claude/CLAUDE.md: no single-letter names; DECISIONS 2026-10-28 id-denylist)',
    rules: {
      'id-length': ['warn', { min: 2, properties: 'never' }],
      'id-denylist': ['warn', 'tmp', 'foo', 'res', 'obj', 'val'],
    },
  },
  {
    // Row 152 — ~/.claude/CLAUDE.md "Code": "Explicit return types on all
    // exported functions and hooks". Warn, as row 153.
    name: '@eumdesigns/rules/base/return-types (~/.claude/CLAUDE.md: explicit return types on exports)',
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'warn' },
  },
];

export default base;
