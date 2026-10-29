import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_NAMES, formatResult, runChecks, type CheckResult } from '../src/check.ts';
import { editJson, git, replaceIn, storeConfig, storeRepo, tempDir } from './helpers.ts';

function byName(results: CheckResult[]): Record<string, CheckResult> {
  return Object.fromEntries(results.map((result) => [result.name, result]));
}

function only(name: string, config: Record<string, unknown>, cwd: string): CheckResult {
  const result = byName(runChecks(config, cwd))[name];
  if (!result) throw new Error(`no result for ${name}`);
  return result;
}

describe('rules-check check: the store-shaped fixture', () => {
  it('passes every configured check; templateOnlyFiles is not configured and skips', () => {
    const results = runChecks(storeConfig(), storeRepo());
    const failures = results.filter((result) => result.outcome === 'fail');
    expect(failures).toEqual([]);
    const outcomes = byName(results);
    expect(outcomes.templateOnlyFiles.outcome).toBe('skip');
    for (const name of CHECK_NAMES) {
      if (name === 'templateOnlyFiles') continue;
      expect(outcomes[name]?.outcome, name).toBe('ok');
    }
  });

  it('has one reader per rules.config.json key', () => {
    expect([...CHECK_NAMES].sort()).toEqual(
      [
        'architecture',
        'backendStrict',
        'decisions',
        'e2eWorkflow',
        'englishSegments',
        'eslintMajor',
        'generatedTypes',
        'hoistingLimits',
        'loadingBoundary',
        'mantineCoreLock',
        'noStatusAttribute',
        'priceSuffix',
        'requiredFiles',
        'setupStubs',
        'sharedBlock',
        'templateOnlyFiles',
        'textAttributes',
        'topLevelIgnores',
        'typescriptBelow',
        'untracked',
        'viteWithVitest',
      ].sort(),
    );
  });

  it('a missing key is "not configured": every check skips and none fails', () => {
    const results = runChecks({}, storeRepo());
    expect(results.map((result) => result.outcome)).toEqual(CHECK_NAMES.map(() => 'skip'));
  });

  it('an unknown key fails closed (a typo is not a skipped check)', () => {
    const results = runChecks({ generatedType: 'backend/types/generated' }, storeRepo());
    const config = results.find((result) => result.name === 'config');
    expect(config?.outcome).toBe('fail');
    expect(config?.detail).toMatch(/generatedType/);
  });

  it('a malformed value fails closed', () => {
    expect(only('eslintMajor', { eslintMajor: '9' }, storeRepo()).outcome).toBe('fail');
  });

  it('formats one line per check', () => {
    expect(formatResult({ name: 'eslintMajor', outcome: 'ok', detail: '' })).toBe('ok eslintMajor');
    expect(formatResult({ name: 'eslintMajor', outcome: 'fail', detail: 'why' })).toBe(
      'FAIL eslintMajor: why',
    );
    expect(formatResult({ name: 'eslintMajor', outcome: 'skip', detail: '' })).toBe(
      'skip eslintMajor (not configured)',
    );
  });
});

describe('rules-check check: each check fails on its broken fixture', () => {
  const config = storeConfig();
  const cases: [string, string, (dir: string) => void, RegExp][] = [
    [
      'row 53: generated types untracked',
      'generatedTypes',
      (dir) => git(dir, 'rm', '-r', '-q', '--cached', 'backend/types'),
      /backend\/types\/generated/,
    ],
    [
      'row 35: an eslint range off ^9',
      'eslintMajor',
      (dir) =>
        editJson(join(dir, 'backend/package.json'), (pkg) => {
          (pkg.devDependencies as Record<string, string>).eslint = '^10.0.0';
        }),
      /backend\/package\.json.*\^10\.0\.0/,
    ],
    [
      'row 168: TypeScript 6',
      'typescriptBelow',
      (dir) =>
        editJson(join(dir, 'frontend/package.json'), (pkg) => {
          (pkg.devDependencies as Record<string, string>).typescript = '^6.0.2';
        }),
      /frontend\/package\.json.*\^6\.0\.2/,
    ],
    [
      'row 54: a family package off the core version',
      'mantineCoreLock',
      (dir) =>
        editJson(join(dir, 'frontend/package.json'), (pkg) => {
          (pkg.dependencies as Record<string, string>)['@mantine/carousel'] = '9.7.4';
        }),
      /@mantine\/carousel/,
    ],
    [
      'row 36: hoistingLimits removed',
      'hoistingLimits',
      (dir) =>
        editJson(join(dir, 'frontend/package.json'), (pkg) => {
          delete pkg.installConfig;
        }),
      /hoistingLimits/,
    ],
    [
      'row 33: a loading.tsx above a route',
      'loadingBoundary',
      (dir) => writeFileSync(join(dir, 'frontend/src/app/productos/loading.tsx'), 'export {};\n'),
      /productos\/loading\.tsx/,
    ],
    [
      'row 33: a Suspense in a layout',
      'loadingBoundary',
      (dir) =>
        writeFileSync(
          join(dir, 'frontend/src/app/productos/layout.tsx'),
          'export default function L({ c }) { return <Suspense>{c}</Suspense>; }\n',
        ),
      /productos\/layout\.tsx/,
    ],
    [
      'row 111: an English route segment',
      'englishSegments',
      (dir) => {
        mkdirSync(join(dir, 'frontend/src/app/cart'));
        writeFileSync(join(dir, 'frontend/src/app/cart/page.tsx'), 'export {};\n');
      },
      /app\/cart/,
    ],
    [
      'row 111: an English segment inside a route group',
      'englishSegments',
      (dir) => {
        mkdirSync(join(dir, 'frontend/src/app/(tienda)/checkout'));
        writeFileSync(join(dir, 'frontend/src/app/(tienda)/checkout/page.tsx'), 'export {};\n');
      },
      /\(tienda\)\/checkout/,
    ],
    [
      'row 107: an unanchored top-level ignore',
      'topLevelIgnores',
      (dir) => replaceIn(join(dir, '.gitignore'), '/reports/', 'reports/'),
      /reports/,
    ],
    [
      'row 7: a journal tracked',
      'untracked',
      (dir) => {
        writeFileSync(join(dir, 'PROMPT_HISTORY.md'), '# journal\n');
        git(dir, 'add', '-f', 'PROMPT_HISTORY.md');
      },
      /PROMPT_HISTORY\.md/,
    ],
    [
      'row 7: an ignore rule missing',
      'untracked',
      (dir) => replaceIn(join(dir, '.gitignore'), 'DEVELOPMENT_NOTES.md\n', ''),
      /DEVELOPMENT_NOTES\.md/,
    ],
    [
      'row 61: a derived field typed string',
      'textAttributes',
      (dir) =>
        replaceIn(
          join(dir, 'backend/src/api/product/content-types/product/schema.json'),
          '"search_text": { "type": "text" }',
          '"search_text": { "type": "string" }',
        ),
      /search_text/,
    ],
    [
      'row 61: a listed attribute declared nowhere',
      'textAttributes',
      (dir) =>
        replaceIn(
          join(dir, 'backend/src/components/order/line.json'),
          '"display_label"',
          '"label"',
        ),
      /display_label/,
    ],
    [
      'row 177: a price field without the suffix',
      'priceSuffix',
      (dir) =>
        replaceIn(
          join(dir, 'backend/src/components/order/line.json'),
          '"unit_price"',
          '"price_cost"',
        ),
      /price_cost/,
    ],
    [
      'row 173: a required file missing',
      'requiredFiles',
      (dir) => rmSync(join(dir, 'frontend/src/ui/README.md')),
      /frontend\/src\/ui\/README\.md/,
    ],
    [
      'row 161: the e2e step blocking',
      'e2eWorkflow',
      (dir) =>
        replaceIn(join(dir, '.github/workflows/e2e.yml'), /^\s*continue-on-error: true\n/m, ''),
      /continue-on-error/,
    ],
    [
      'row 171: backend not strict',
      'backendStrict',
      (dir) => replaceIn(join(dir, 'backend/tsconfig.json'), '"strict": true', '"strict": false'),
      /strict/,
    ],
    [
      'row 172: vitest without vite',
      'viteWithVitest',
      (dir) =>
        editJson(join(dir, 'backend/package.json'), (pkg) => {
          delete (pkg.devDependencies as Record<string, string>).vite;
        }),
      /backend\/package\.json/,
    ],
    [
      'row 92: the block changed without the hash',
      'sharedBlock',
      (dir) => replaceIn(join(dir, 'block.md'), '- A rule.\n', '- A rule.\n- A new rule.\n'),
      /hash/,
    ],
    [
      'row 140: a marker that appears twice as a whole line',
      'sharedBlock',
      (dir) =>
        replaceIn(join(dir, 'block.md'), '## Local\n', '## Local\n\n<!-- P472:SHARED:END -->\n'),
      /marker/,
    ],
    [
      'row 163: an undated ruling',
      'decisions',
      (dir) =>
        replaceIn(
          join(dir, 'DECISIONS.md'),
          '## Estate and process\n\n',
          '## Estate and process\n\n- The template is a starter, undated.\n',
        ),
      /line 9/,
    ],
    [
      'row 163: a ruling wrapped onto a second line',
      'decisions',
      (dir) =>
        replaceIn(join(dir, 'DECISIONS.md'), 'No post-birth sync.\n', 'No post-birth\n  sync.\n'),
      /line 10/,
    ],
    [
      'row 164: a citation that resolves to no line',
      'architecture',
      (dir) =>
        replaceIn(
          join(dir, 'ARCHITECTURE.md'),
          'The template is a starter',
          'The template is a seed',
        ),
      /The template is a seed/,
    ],
    [
      'row 164: a citation by line number',
      'architecture',
      (dir) => replaceIn(join(dir, 'ARCHITECTURE.md'), 'So does', 'See DECISIONS.md:12. So does'),
      /DECISIONS\.md:12/,
    ],
    [
      'row 164: a citation that resolves to two lines',
      'architecture',
      (dir) =>
        replaceIn(
          join(dir, 'ARCHITECTURE.md'),
          'both resolve.',
          'both resolve. DECISIONS.md 2026-07-30 "a" does not.',
        ),
      /"a"/,
    ],
    [
      'row 13: an attribute named status',
      'noStatusAttribute',
      (dir) =>
        replaceIn(
          join(dir, 'backend/src/components/order/line.json'),
          '"unit_price"',
          '"status": { "type": "string" },\n    "unit_price"',
        ),
      /status/,
    ],
    [
      'rows 39, 66: a jsdom stub missing',
      'setupStubs',
      (dir) =>
        replaceIn(
          join(dir, 'frontend/vitest.setup.ts'),
          'globalThis.IntersectionObserver = class {} as never;\n',
          '',
        ),
      /IntersectionObserver/,
    ],
  ];

  it.each(cases)('%s', (_title, name, breakIt, detail) => {
    const dir = storeRepo();
    breakIt(dir);
    const result = only(name, config, dir);
    expect(result.outcome).toBe('fail');
    expect(result.detail).toMatch(detail);
  });

  it('row 162: a template-only file tracked in a store fails; untracked it passes', () => {
    const dir = storeRepo();
    const storeOnly = { templateOnlyFiles: ['DECISIONS.md', 'ARCHITECTURE.md'] };
    const tracked = only('templateOnlyFiles', storeOnly, dir);
    expect(tracked.outcome).toBe('fail');
    expect(tracked.detail).toMatch(/DECISIONS\.md/);
    git(dir, 'rm', '-q', '--cached', 'DECISIONS.md', 'ARCHITECTURE.md');
    expect(only('templateOnlyFiles', storeOnly, dir).outcome).toBe('ok');
  });

  it('row 111: a reserved segment is never flagged (api/cart passes in the fixture)', () => {
    const result = only('englishSegments', config, storeRepo());
    expect(result.outcome).toBe('ok');
    const unreserved = { ...config, reservedSegments: [] };
    expect(only('englishSegments', unreserved, storeRepo()).detail).toMatch(/api\/cart/);
  });
});

describe('rules-check check fails closed', () => {
  it('a git check outside a repository fails', () => {
    const dir = tempDir('nogit');
    expect(only('generatedTypes', { generatedTypes: 'backend/types/generated' }, dir).outcome).toBe(
      'fail',
    );
    expect(only('untracked', { untracked: ['PROMPT_HISTORY.md'] }, dir).outcome).toBe('fail');
  });

  it('an app directory that does not exist fails', () => {
    const dir = tempDir('noapp');
    expect(
      only('loadingBoundary', { loadingBoundary: { appDir: 'frontend/src/app' } }, dir).outcome,
    ).toBe('fail');
    expect(only('englishSegments', { englishSegments: ['cart'] }, dir).outcome).toBe('fail');
  });

  it('a package check with no package.json to read fails', () => {
    const dir = tempDir('nopkg');
    expect(only('eslintMajor', { eslintMajor: 9 }, dir).outcome).toBe('fail');
  });

  it('a schema check with no schema to read fails', () => {
    const dir = tempDir('noschema');
    expect(only('noStatusAttribute', { noStatusAttribute: true }, dir).outcome).toBe('fail');
  });
});

describe('rules-check check: readers measured against the consumers (queue 2026-10-29)', () => {
  const config = storeConfig();

  it('row 33: a comment that names <Suspense> in a layout is not a boundary', () => {
    const dir = storeRepo((tree) =>
      writeFileSync(
        join(tree, 'frontend/src/app/productos/layout.tsx'),
        [
          '// A LAYOUT only — never a loading.tsx, and no <Suspense> here.',
          '/* nor a <Suspense> in a block comment */',
          'export default function L({ children }) { return children; }',
          '',
        ].join('\n'),
      ),
    );
    expect(only('loadingBoundary', config, dir).outcome).toBe('ok');
  });

  it('row 164: a same-date ruling that quotes the words elsewhere does not count', () => {
    const dir = storeRepo((tree) =>
      replaceIn(
        join(tree, 'DECISIONS.md'),
        '## Open',
        '- 2026-07-30 Eli approved the lines "The template is a starter" and "Loading-boundary rule".\n\n## Open',
      ),
    );
    expect(only('architecture', config, dir).outcome).toBe('ok');
  });

  it('row 164: words that are not a ruling’s opening words do not resolve', () => {
    const dir = storeRepo((tree) =>
      replaceIn(
        join(tree, 'ARCHITECTURE.md'),
        'So does',
        'DECISIONS.md 2026-07-30 "No post-birth sync" does not. So does',
      ),
    );
    const result = only('architecture', config, dir);
    expect(result.outcome).toBe('fail');
    expect(result.detail).toMatch(/No post-birth sync/);
  });

  it('row 177: priceSuffix { except } passes the names that predate the ruling and fails the rest', () => {
    const dir = storeRepo((tree) =>
      replaceIn(
        join(tree, 'backend/src/components/order/line.json'),
        '"unit_price"',
        '"price_tier": { "type": "string" },\n    "unit_price"',
      ),
    );
    expect(only('priceSuffix', { priceSuffix: { except: ['price_tier'] } }, dir).outcome).toBe(
      'ok',
    );
    replaceIn(join(dir, 'backend/src/components/order/line.json'), '"unit_price"', '"price_cost"');
    const result = only('priceSuffix', { priceSuffix: { except: ['price_tier'] } }, dir);
    expect(result.outcome).toBe('fail');
    expect(result.detail).toMatch(/price_cost/);
    expect(result.detail).not.toMatch(/price_tier/);
  });
});
