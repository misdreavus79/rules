import type { Linter } from 'eslint';
import base from './base.ts';

/**
 * The Next.js preset, layered after `eslint-config-next`'s own configs:
 *
 *   export default defineConfig([...nextVitals, ...nextTs, ...rulesNext, globalIgnores([...])]);
 *
 * It imports no plugin (Phase 0 §5 fact 1): `jsx-a11y` and
 * `@typescript-eslint` resolve through the plugins `eslint-config-next`
 * registers for every JS/TS file.
 *
 * In flat config a later object's `no-restricted-syntax` or
 * `no-restricted-imports` REPLACES the earlier options for a file (§5 fact 2).
 * So this preset owns both rules on `src/**`: it carries the template's RSC
 * guard (row 26, moved in verbatim) and every other selector, split into
 * DISJOINT file classes, each object holding the whole list for its class.
 * A consumer keeps no `no-restricted-*` block of its own on `src/**`.
 */

interface Selector {
  selector: string;
  message: string;
}

const SRC = 'src/**/*.{ts,tsx}';
const UI = 'src/ui/**';
const UI_SOURCE = 'src/ui/**/*.{ts,tsx}';
const UI_TESTS = 'src/ui/**/*.{test,spec}.{ts,tsx}';
const TESTS = 'src/**/*.{test,spec}.{ts,tsx}';
const MEDIA_HELPER = 'src/ui/strapi-media.ts';
const TRANSPORT = 'src/lib/strapi-request.ts';
const SERVER_PAGES = 'src/app/**/{page,layout}.tsx';

// Row 26 — the template's frontend/eslint.config.mjs RSC guard, verbatim.
const RSC_LINK: Selector = {
  selector:
    "JSXAttribute[name.name='component'] > JSXExpressionContainer > Identifier[name='Link']",
  message:
    "component={Link} cannot cross the Server → Client boundary — use AppLink/ButtonLink from '@/ui' (CLAUDE.md: never pass component={Link} into Mantine from a Server Component).",
};

// Row 29 — media URLs through ui/strapi-media.
const MEDIA_ENV: Selector = {
  selector: "MemberExpression[object.property.name='env'][property.name='NEXT_PUBLIC_STRAPI_URL']",
  message:
    'NEXT_PUBLIC_STRAPI_URL is read only in src/ui/strapi-media.ts (CLAUDE.md: images through ui/StrapiImage; media URLs through ui/strapi-media).',
};

// Row 167 — one Strapi transport.
const TRANSPORT_ENV: Selector = {
  selector: "MemberExpression[object.property.name='env'][property.name='STRAPI_URL']",
  message:
    'STRAPI_URL is read only in src/lib/strapi-request.ts (DECISIONS 2026-09-11 "One Strapi transport").',
};

// Row 47 — compound statics resolve to undefined through the client reference proxy.
const COMPOUND_STATICS: Selector = {
  selector:
    'JSXMemberExpression[object.name=/^(Table|List|Tabs|Menu|Accordion|Stepper|Timeline|Grid)$/]',
  message:
    "A Mantine compound static (Table.Tbody, List.Item, …) is undefined in a Server Component — use the flat export (TableTbody, ListItem) (CLAUDE.md: MANTINE COMPOUND STATICS DO NOT CROSS THE RSC BOUNDARY). A page that is itself 'use client' may disable this line.",
};

// Rows that hold in every source file under src/.
const EVERYWHERE: Selector[] = [
  {
    // Row 30
    selector: "JSXAttribute[name.name='size'][value.value='xs']",
    message:
      'size="xs" renders below 1rem; footnote-class text uses the deliberate footnote token (CLAUDE.md: Typography floor).',
  },
  {
    // Row 31
    selector: "JSXOpeningElement[name.name='body'] MemberExpression[property.name='variable']",
    message:
      'next/font variables go on <html>, never <body> (CLAUDE.md: next/font variables go on <html>, NEVER <body>).',
  },
  {
    // Row 32
    selector: "JSXAttribute[name.name=/^(c|color)$/][value.value='dimmed']",
    message:
      '`dimmed` means de-emphasised/disabled and fails AA for body text; secondary copy uses --app-color-text-secondary (CLAUDE.md: `dimmed` is a semantic token).',
  },
  {
    // Row 37
    selector: "JSXOpeningElement[name.name='Grid'] > JSXAttribute[name.name='gutter']",
    message: 'Mantine 9 Grid takes `gap`, not `gutter` (CLAUDE.md: Mantine 9 API drift).',
  },
  {
    // Row 37
    selector: "JSXMemberExpression[object.name='Drawer'][property.name='Root']",
    message:
      'Drawer.Root emits no position CSS vars; use the plain <Drawer> with the Styles API (CLAUDE.md: Mantine 9 API drift).',
  },
  {
    // Row 75
    selector: "CallExpression[callee.name='revalidateTag'] > Literal[value='max']",
    message:
      "revalidateTag(tag, 'max') serves the stale page once more; pass { expire: 0 } (CLAUDE.md: NEXT 16 `revalidateTag` TAKES A PROFILE).",
  },
  {
    // Row 166
    selector: "MemberExpression[object.property.name='env'][property.name='STRAPI_API_TOKEN']",
    message:
      'The frontends use no Strapi API token (DECISIONS 2026-09-11 "The frontends use no Strapi API token").',
  },
];

/** One config object per disjoint file class; each carries the whole selector list for it. */
function syntax(files: string[], ignores: string[], selectors: Selector[]): Linter.Config {
  return {
    name: `@eumdesigns/rules/next/no-restricted-syntax ${files.join(' ')}`,
    files,
    ...(ignores.length > 0 ? { ignores } : {}),
    rules: { 'no-restricted-syntax': ['error', ...selectors] },
  };
}

const NEXT_LINK = {
  name: 'next/link',
  message:
    "Raw next/link is banned outside src/ui — use AppLink/ButtonLink from '@/ui' (CLAUDE.md: never pass component={Link} into Mantine from a Server Component).",
};
const NEXT_IMAGE = {
  name: 'next/image',
  message:
    'next/image is used only inside src/ui — render images through ui/StrapiImage (CLAUDE.md: images through ui/StrapiImage).',
};
const STRAPI_CLIENT = {
  name: '@strapi/client',
  message: 'No @strapi/client: one Strapi transport (DECISIONS 2026-09-11 "One Strapi transport").',
};

const next: Linter.Config[] = [
  ...base,
  {
    // Row 21 in a frontend: the frontend logger's outlets stay.
    name: '@eumdesigns/rules/next/no-console (CLAUDE.md: strapi.log and the frontend logger are the outlets)',
    ignores: ['**/scripts/**'],
    rules: { 'no-console': ['error', { allow: ['error', 'warn'] }] },
  },
  {
    // Row 151 — ~/.claude/CLAUDE.md "Code": no `any`.
    name: '@eumdesigns/rules/next/no-explicit-any (~/.claude/CLAUDE.md: no any)',
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // Rows 180, 181 — the P4.87 card's correction 2026-09-12: a placeholder
    // is not a label; a <label> is bound to its control.
    name: '@eumdesigns/rules/next/jsx-a11y (P4.87 card: a placeholder is not a label)',
    files: ['**/*.{jsx,tsx}'],
    rules: {
      'jsx-a11y/control-has-associated-label': [
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
      ],
      'jsx-a11y/label-has-associated-control': 'error',
    },
  },
  // no-restricted-imports: rows 26, 29 (outside src/ui) and 167 (everywhere).
  {
    name: '@eumdesigns/rules/next/no-restricted-imports src/** outside src/ui',
    files: [SRC],
    ignores: [UI],
    rules: {
      'no-restricted-imports': ['error', { paths: [NEXT_LINK, STRAPI_CLIENT, NEXT_IMAGE] }],
    },
  },
  {
    name: '@eumdesigns/rules/next/no-restricted-imports src/ui',
    files: [UI_SOURCE],
    rules: { 'no-restricted-imports': ['error', { paths: [STRAPI_CLIENT] }] },
  },
  // no-restricted-syntax, seven disjoint classes. Exemptions: the RSC guard
  // skips src/ui; NEXT_PUBLIC_STRAPI_URL skips the media helper and tests;
  // STRAPI_URL skips the transport and tests; compound statics apply to
  // server pages and layouts only.
  syntax([UI_TESTS], [], EVERYWHERE),
  syntax([MEDIA_HELPER], [], [...EVERYWHERE, TRANSPORT_ENV]),
  syntax([UI_SOURCE], [MEDIA_HELPER, UI_TESTS], [...EVERYWHERE, MEDIA_ENV, TRANSPORT_ENV]),
  syntax([TESTS], [UI], [RSC_LINK, ...EVERYWHERE]),
  syntax([TRANSPORT], [], [RSC_LINK, ...EVERYWHERE, MEDIA_ENV]),
  syntax([SERVER_PAGES], [], [RSC_LINK, ...EVERYWHERE, MEDIA_ENV, TRANSPORT_ENV, COMPOUND_STATICS]),
  syntax(
    [SRC],
    [UI, TESTS, TRANSPORT, SERVER_PAGES],
    [RSC_LINK, ...EVERYWHERE, MEDIA_ENV, TRANSPORT_ENV],
  ),
];

export default next;
