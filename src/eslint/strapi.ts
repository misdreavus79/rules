import type { Linter } from 'eslint';
import base from './base.ts';

/**
 * The Strapi preset, layered after `typescript-eslint`'s recommended configs:
 *
 *   export default defineConfig([globalIgnores([...]), js.configs.recommended,
 *     ...tseslint.configs.recommended, ...rulesStrapi, ...]);
 *
 * It imports no plugin (Phase 0 §5 fact 1). Its `no-restricted-syntax` and
 * `no-restricted-imports` objects carry every option a backend needs (§5
 * fact 2): a later object for the same rule replaces the earlier options.
 *
 * Paths start with a globstar segment and then the path under src, so they
 * match both a child's
 * `backend/src/...` and the template's `presets/<preset>/...` layout, which
 * `yarn lint:presets` lints from `presets/`.
 */

interface Selector {
  selector: string;
  message: string;
}

const CODE = '**/*.{js,mjs,cjs,ts,tsx,mts,cts}';
const TESTS = '**/*.{test,spec}.{js,ts,tsx}';

/**
 * Row 16's allow-list: the seven files that call the db layer, each with its
 * loud comment (DECISIONS 2026-10-28 "P4.87 v0 lands in `misdreavus79/rules`
 * alone": "the seven-file `db.query` allow-list as it stands").
 */
export const SANCTIONED_DB_FILES: readonly string[] = [
  '**/bootstrap/backfills/display-label.ts',
  '**/bootstrap/backfills/low-stock-threshold.ts',
  '**/bootstrap/backfills/p681.ts',
  '**/bootstrap/backfills/search-text.ts',
  '**/bootstrap/roles.ts',
  '**/lib/category-search-text.ts',
  '**/lib/reservation-expiry.ts',
];

const DOCUMENT_SERVICE_ONLY: Selector[] = [
  {
    selector: "MemberExpression[property.name='query'][object.property.name='db']",
    message:
      'Document Service only: no strapi.db.query in app code; the one sanctioned exception is a both-rows counter with a loud comment (CLAUDE.md: Backend conventions, Document Service only).',
  },
  {
    selector: "Identifier[name='entityService']",
    message:
      'Document Service only: no entityService (CLAUDE.md: Backend conventions, Document Service only).',
  },
];

const NO_LIMIT_MINUS_ONE: Selector = {
  // Row 41
  selector: "Property[key.name='limit'] > UnaryExpression[operator='-']",
  message:
    'Never `limit: -1`: page with offset and a fixed limit, or omit limit (CLAUDE.md: SQLITE IS NOT POSTGRES).',
};

const strapi: Linter.Config[] = [
  ...base,
  {
    // Row 151 — ~/.claude/CLAUDE.md "Code": no `any`.
    name: '@eumdesigns/rules/strapi/no-explicit-any (~/.claude/CLAUDE.md: no any)',
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // Row 50 — CLAUDE.md "hasSuperAdminRole IS NOT EXPORTED".
    name: '@eumdesigns/rules/strapi/no-restricted-imports',
    files: [CODE],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@strapi/*/dist/**'],
              message:
                'Never deep-import an unexported @strapi/* path; restate it from the installed source with a citation (CLAUDE.md: hasSuperAdminRole IS NOT EXPORTED).',
            },
          ],
        },
      ],
    },
  },
  {
    // Rows 16 and 41 in app code. Tests fake the db layer and are not app code.
    name: '@eumdesigns/rules/strapi/no-restricted-syntax app code',
    files: [CODE],
    ignores: [...SANCTIONED_DB_FILES, TESTS],
    rules: { 'no-restricted-syntax': ['error', ...DOCUMENT_SERVICE_ONLY, NO_LIMIT_MINUS_ONE] },
  },
  {
    // Row 41 alone in the sanctioned files and tests.
    name: '@eumdesigns/rules/strapi/no-restricted-syntax sanctioned files and tests',
    files: [...SANCTIONED_DB_FILES, TESTS],
    rules: { 'no-restricted-syntax': ['error', NO_LIMIT_MINUS_ONE] },
  },
];

export default strapi;
