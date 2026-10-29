import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import base from '../src/eslint/base.ts';
import next from '../src/eslint/next.ts';
import strapi from '../src/eslint/strapi.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/eslint');

// The presets import no plugin (Phase 0 §5 fact 1): the consumer's own
// configs register them. The test plays the consumer: typescript-eslint's
// parser and plugin for .ts/.tsx, and a stand-in jsx-a11y plugin whose rules
// do nothing (rows 180 and 181 are asserted by shape here, proven live in a
// consumer).
const noopRule: { meta: { schema: false }; create: () => Record<string, never> } = {
  meta: { schema: false },
  create: () => ({}),
};
const consumerSetup: Linter.Config[] = [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser as Linter.Parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin as unknown as ESLint.Plugin,
      'jsx-a11y': {
        rules: {
          'control-has-associated-label': noopRule,
          'label-has-associated-control': noopRule,
        },
      },
    },
  },
];

interface Hit {
  ruleId: string | null;
  severity: number;
  message: string;
}

async function lint(preset: Linter.Config[], root: string, file: string): Promise<Hit[]> {
  const eslint = new ESLint({
    cwd: join(FIXTURES, root),
    overrideConfigFile: true,
    overrideConfig: [...consumerSetup, ...preset],
  });
  const filePath = join(FIXTURES, root, file);
  const [result] = await eslint.lintText(readFileSync(filePath, 'utf8'), { filePath });
  return result.messages.map((message) => ({
    ruleId: message.ruleId,
    severity: message.severity,
    message: message.message,
  }));
}

function count(hits: Hit[], ruleId: string, severity?: number): number {
  return hits.filter(
    (hit) => hit.ruleId === ruleId && (severity === undefined || hit.severity === severity),
  ).length;
}

const ERROR = 2;
const WARN = 1;
const RESTRICTED = ['no-restricted-syntax', 'no-restricted-imports'];

function restrictedHits(hits: Hit[]): Hit[] {
  return hits.filter((hit) => hit.ruleId !== null && RESTRICTED.includes(hit.ruleId));
}

describe('preset shape', () => {
  it.each([
    ['base', base],
    ['next', next],
    ['strapi', strapi],
  ])('%s is an array of plain config objects with no plugins key', (_name, preset) => {
    expect(Array.isArray(preset)).toBe(true);
    expect(preset.length).toBeGreaterThan(0);
    for (const config of preset) {
      expect(config).not.toHaveProperty('plugins');
      expect(config).not.toHaveProperty('languageOptions');
    }
  });

  it('every restricted-syntax and restricted-imports entry names the bullet it enforces', () => {
    for (const config of [...base, ...next, ...strapi]) {
      for (const [ruleId, entry] of Object.entries(config.rules ?? {})) {
        if (!RESTRICTED.includes(ruleId)) continue;
        const options = (entry as unknown[]).slice(1);
        const messages: string[] = [];
        for (const option of options) {
          if (typeof option === 'string') {
            messages.push(option);
            continue;
          }
          const record = option as Record<string, unknown>;
          if (typeof record.selector === 'string') messages.push(String(record.message));
          for (const path of (record.paths as Record<string, unknown>[] | undefined) ?? []) {
            messages.push(String(path.message));
          }
          for (const pattern of (record.patterns as Record<string, unknown>[] | undefined) ?? []) {
            messages.push(String(pattern.message));
          }
        }
        expect(messages.length).toBeGreaterThan(0);
        for (const message of messages) expect(message).toMatch(/CLAUDE\.md|DECISIONS/);
      }
    }
  });

  it('next carries row 180 and row 181 with their options (proven live in a consumer)', () => {
    const rules = Object.assign({}, ...next.map((config) => config.rules ?? {}));
    expect(rules['jsx-a11y/control-has-associated-label']).toEqual([
      'error',
      {
        labelAttributes: ['label', 'aria-label'],
        controlComponents: [
          'TextInput',
          'NumberInput',
          'Select',
          'Textarea',
          'PasswordInput',
          'Checkbox',
          'Radio',
        ],
      },
    ]);
    expect(rules['jsx-a11y/label-has-associated-control']).toBe('error');
  });

  it('next carries the template RSC guard verbatim (row 26)', () => {
    const selectors = next.flatMap((config) => {
      const entry = config.rules?.['no-restricted-syntax'];
      return Array.isArray(entry)
        ? entry.slice(1).map((option) => (option as { selector: string }).selector)
        : [];
    });
    expect(selectors).toContain(
      "JSXAttribute[name.name='component'] > JSXExpressionContainer > Identifier[name='Link']",
    );
  });

  it('strapi exempts the seven sanctioned db-layer files from row 16 (DECISIONS question 10)', () => {
    const ignores = strapi.flatMap((config) => config.ignores ?? []);
    for (const file of [
      'bootstrap/backfills/display-label.ts',
      'bootstrap/backfills/low-stock-threshold.ts',
      'bootstrap/backfills/p681.ts',
      'bootstrap/backfills/search-text.ts',
      'bootstrap/roles.ts',
      'lib/category-search-text.ts',
      'lib/reservation-expiry.ts',
    ]) {
      expect(ignores).toContain(`**/${file}`);
    }
  });
});

describe('base preset', () => {
  it('row 21: console is an error outside scripts', async () => {
    const hits = await lint(base, 'base', 'src/sample.ts');
    expect(count(hits, 'no-console', ERROR)).toBe(1);
    expect(await lint(base, 'base', 'scripts/tool.ts')).toEqual([]);
  });

  it('rows 152, 153 and id-denylist warn', async () => {
    const hits = await lint(base, 'base', 'src/sample.ts');
    expect(count(hits, '@typescript-eslint/explicit-module-boundary-types', WARN)).toBe(1);
    expect(count(hits, 'id-length', WARN)).toBe(1);
    expect(count(hits, 'id-denylist', WARN)).toBe(1);
  });
});

describe('next preset: each row trips on its fixture and stays quiet elsewhere', () => {
  const cases: [string, string, Record<string, number>][] = [
    [
      'row 26: next/link and component={Link} outside src/ui',
      'src/components/LinkProp.tsx',
      { 'no-restricted-imports': 1, 'no-restricted-syntax': 1 },
    ],
    ['row 26: allowed inside src/ui', 'src/ui/AppLink.tsx', {}],
    ['row 29: next/image outside src/ui', 'src/components/Img.tsx', { 'no-restricted-imports': 1 }],
    [
      'row 29: NEXT_PUBLIC_STRAPI_URL outside the media helper',
      'src/components/MediaUrl.ts',
      { 'no-restricted-syntax': 1 },
    ],
    ['row 29: the media helper may read it', 'src/ui/strapi-media.ts', {}],
    ['rows 29, 167: tests may read the env', 'src/components/media.test.ts', {}],
    ['row 30: size="xs"', 'src/components/Small.tsx', { 'no-restricted-syntax': 1 }],
    ['row 31: the font variable on <body>', 'src/app/layout.tsx', { 'no-restricted-syntax': 1 }],
    ['row 32: dimmed as a weight', 'src/components/Dimmed.tsx', { 'no-restricted-syntax': 2 }],
    [
      'row 37: Grid gutter and Drawer.Root',
      'src/components/GridGutter.tsx',
      { 'no-restricted-syntax': 2 },
    ],
    [
      'row 47: a compound static in a server page',
      'src/app/catalog/page.tsx',
      { 'no-restricted-syntax': 1 },
    ],
    ['row 47: a client component may use them', 'src/components/ClientTable.tsx', {}],
    [
      "row 75: revalidateTag(…, 'max')",
      'src/app/api/revalidate/route.ts',
      { 'no-restricted-syntax': 1 },
    ],
    ['row 166: STRAPI_API_TOKEN', 'src/lib/token.ts', { 'no-restricted-syntax': 1 }],
    ['row 167: @strapi/client', 'src/lib/client.ts', { 'no-restricted-imports': 1 }],
    [
      'row 167: @strapi/client inside src/ui too',
      'src/ui/client.ts',
      { 'no-restricted-imports': 1 },
    ],
    [
      'row 167: STRAPI_URL outside the transport',
      'src/lib/base-url.ts',
      { 'no-restricted-syntax': 1 },
    ],
    ['row 167: the transport may read STRAPI_URL', 'src/lib/strapi-request.ts', {}],
    [
      'row 151: no explicit any',
      'src/components/AnyType.ts',
      { '@typescript-eslint/no-explicit-any': 1 },
    ],
    ['a clean component', 'src/components/Clean.tsx', {}],
  ];

  it.each(cases)('%s', async (_title, file, expected) => {
    const hits = await lint(next, 'next', file);
    const errors = hits.filter((hit) => hit.severity === ERROR);
    const tally: Record<string, number> = {};
    for (const hit of errors) tally[String(hit.ruleId)] = (tally[String(hit.ruleId)] ?? 0) + 1;
    expect(tally).toEqual(expected);
    for (const hit of restrictedHits(hits)) expect(hit.message).toMatch(/CLAUDE\.md|DECISIONS/);
  });

  it('row 21 in the frontend: console.log errors, console.error and console.warn pass', async () => {
    const hits = await lint(next, 'next', 'src/components/Logger.ts');
    expect(count(hits, 'no-console', ERROR)).toBe(1);
    expect(await lint(next, 'next', 'scripts/report.ts')).toEqual([]);
  });

  it('rows 152, 153 and id-denylist warn without data and item', async () => {
    const hits = await lint(next, 'next', 'src/components/Boundary.ts');
    expect(count(hits, '@typescript-eslint/explicit-module-boundary-types', WARN)).toBe(1);
    expect(count(hits, 'id-length', WARN)).toBe(1);
    expect(count(hits, 'id-denylist', WARN)).toBe(1);
    expect(hits.filter((hit) => hit.severity === ERROR)).toEqual([]);
  });
});

describe('strapi preset: each row trips on its fixture and stays quiet elsewhere', () => {
  const cases: [string, string, Record<string, number>][] = [
    [
      'row 16: db.query and entityService in app code',
      'src/api/order/services/order.ts',
      { 'no-restricted-syntax': 2 },
    ],
    ['row 16: a sanctioned file', 'src/bootstrap/backfills/display-label.ts', {}],
    ['row 16: a sanctioned file in the preset layout', 'ecommerce/bootstrap/roles.ts', {}],
    ['row 16: a test fakes the db layer', 'src/lib/stock.test.ts', {}],
    ['row 41: limit -1', 'src/api/product/services/list.ts', { 'no-restricted-syntax': 1 }],
    [
      'row 41: limit -1 in a sanctioned file too',
      'src/bootstrap/backfills/search-text.ts',
      { 'no-restricted-syntax': 1 },
    ],
    ['row 50: a deep @strapi dist import', 'src/admin/deep.ts', { 'no-restricted-imports': 1 }],
    ['row 151: no explicit any', 'src/api/any.ts', { '@typescript-eslint/no-explicit-any': 1 }],
    ['row 21: console.log in app code', 'src/index.ts', { 'no-console': 1 }],
    ['row 21: scripts may log', 'scripts/seed.ts', {}],
  ];

  it.each(cases)('%s', async (_title, file, expected) => {
    const hits = await lint(strapi, 'strapi', file);
    const errors = hits.filter((hit) => hit.severity === ERROR);
    const tally: Record<string, number> = {};
    for (const hit of errors) tally[String(hit.ruleId)] = (tally[String(hit.ruleId)] ?? 0) + 1;
    expect(tally).toEqual(expected);
    for (const hit of restrictedHits(hits)) expect(hit.message).toMatch(/CLAUDE\.md|DECISIONS/);
  });
});
