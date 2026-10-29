# @eumdesigns/rules

The estate's rules as machinery. Rules that a machine can check leave the
`CLAUDE.md` prose of the template and the stores and become checks, in four
layers:

1. **ESLint presets** (`base`, `next`, `strapi`) — per file, at every save and gate.
2. **`rules-check check`** — repository checks driven by a `rules.config.json`.
3. **Git hooks** — `pre-commit` and `pre-push`, plain `sh` scripts that call the bin.
4. **Claude Code hooks** — `PreToolUse` entries for `Bash` and `Edit|Write`.

The rows come from the P4.87 Phase 0 table (the v0 cut, 37 ranks). Rulings live
in the template's `DECISIONS.md`, not here.

## Install

Consumed by git tag (tags are Eli's):

```sh
yarn add -D @eumdesigns/rules@github:misdreavus79/rules#v0.1.0
```

Yarn packs a git dependency with its `prepack` script, so `dist/` is built on
install. The package needs Node 24 and ESLint 9 (`peerDependencies.eslint: ^9`).

## The three presets

Each export is a flat-config array of plain config objects. No preset imports a
plugin: the `jsx-a11y` and `@typescript-eslint` rules resolve through the plugins
the consumer's own configs register.

`frontend/eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import rulesNext from '@eumdesigns/rules/eslint/next';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...rulesNext,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts' /* … */]),
]);
```

Delete the local RSC-guard block: `next` carries it. In flat config a later
`no-restricted-syntax` or `no-restricted-imports` replaces the earlier options for a
file, so the preset owns both rules on `src/**` and keeps no option the guard had.

`backend/eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import rulesStrapi from '@eumdesigns/rules/eslint/strapi';

export default defineConfig([
  globalIgnores(['dist/**', '.strapi/**' /* … */]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...rulesStrapi,
  // the consumer's CommonJS declarations stay after it
]);
```

The template's `presets/eslint.config.mjs` spreads the backend config, so it
inherits `strapi` unchanged.

| Preset   | Rows                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`   | 21 `no-console` (scripts exempt); 152 `explicit-module-boundary-types` and 153 `id-length` at warn; `id-denylist` (`tmp`, `foo`, `res`, `obj`, `val`) at warn |
| `next`   | `base`, plus 26 (the RSC guard), 29, 30, 31, 32, 37, 47, 75, 151, 166, 167, 180, 181, and 21 with `console.error` and `console.warn` allowed                  |
| `strapi` | `base`, plus 16 (`db.query` and `entityService`; the seven sanctioned files and tests exempt), 41 (`limit: -1`), 50 (deep `@strapi/*/dist` imports), 151      |

Every `no-restricted-*` message names the `CLAUDE.md` bullet or `DECISIONS` line
it enforces.

## `rules-check check`

```sh
rules-check check [--config rules.config.json] [--cwd <dir>]
```

One line per check: `ok <key>`, `FAIL <key>: <why>` or `skip <key> (not configured)`.
Exit 1 on any `FAIL`. A missing key skips. An unknown key, a malformed value, a
missing config file, or a check with nothing to read fails.

A consumer adds `"rules": "rules-check check"` to its root `package.json` scripts
and a `yarn rules` step to CI after "Check formatting".

| Key                                   | Checks (Phase 0 row)                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `generatedTypes`                      | the directory has tracked files (53)                                                                  |
| `eslintMajor`                         | every `eslint` range starts `^<n>` (35)                                                               |
| `typescriptBelow`                     | every `typescript` range's major is below `<n>` (168)                                                 |
| `mantineCoreLock`                     | every `@mantine/*` range equals `@mantine/core`'s in the same `package.json` (54)                     |
| `hoistingLimits`                      | `{ file, value }`: `installConfig.hoistingLimits` equals `value` (36)                                 |
| `loadingBoundary`                     | `{ appDir }`: no `loading.*`, no `<Suspense` outside comments in a `layout.*` (33)                    |
| `englishSegments`, `reservedSegments` | no directory under the app directory named in the list; reserved names are not entered (111, stores)  |
| `topLevelIgnores`                     | each name is ignored as `/name/` in `.gitignore` and never unanchored (107)                           |
| `untracked`                           | each path is untracked and ignored (7)                                                                |
| `textAttributes`                      | each listed schema attribute exists and is `type: text` (61)                                          |
| `priceSuffix`                         | `true` or `{ except }`: every attribute holding `price` is `price` or ends `_price` (177)             |
| `requiredFiles`                       | each file exists (8, 173)                                                                             |
| `templateOnlyFiles`                   | none of the files is tracked (162, stores)                                                            |
| `e2eWorkflow`                         | the workflow carries `continue-on-error: true` (161)                                                  |
| `backendStrict`                       | the tsconfig's `compilerOptions.strict` is `true` (171)                                               |
| `viteWithVitest`                      | every `package.json` that declares `vitest` declares `vite` (172)                                     |
| `sharedBlock`                         | `{ file, hash }`: each marker once as a whole line; the block's sha256 equals `hash` (92, 140)        |
| `decisions`                           | `{ file, openHeading }`: every line of a ruled section is blank, a heading, or `- YYYY-MM-DD …` (163) |
| `architecture`                        | `{ file }`: each `DECISIONS.md <date> "<words>"` opens exactly one ruling; no line numbers (164)      |
| `noStatusAttribute`                   | no schema attribute is named `status` (13)                                                            |
| `setupStubs`                          | `{ file, names }`: the setup file names each stub (39, 66)                                            |

Schema checks read every content-type `schema.json` and every component JSON
outside `node_modules`, build output and dot-directories.

## Git hooks

Once per clone:

```sh
git config core.hooksPath node_modules/@eumdesigns/rules/hooks/git
```

- `pre-commit`: refuses a commit on `main` (86b); runs the consumer's own
  `node_modules/.bin/prettier --check` on the staged files (145); with
  `decisions` configured, refuses a removed or changed line of that file
  (122); with `sharedBlock` configured and its file staged, refuses a block
  whose hash differs from the config (92b).
- `pre-push`: `yarn format:check`, then `yarn lint` (89), then `rules-check check`
  when `rules.config.json` exists.

## Claude Code hooks

Copy the two entries of `hooks/claude/settings.json` into the project's
`.claude/settings.json` (Eli places this file):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/node_modules/.bin/rules-check hook bash"
          }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/node_modules/.bin/rules-check hook edit"
          }
        ]
      }
    ]
  }
}
```

The hook is additive: the live guard in `~/.claude/hooks` keeps everything it
blocks today, and no row here repeats it.

| Answer | Rows                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deny   | 7b `git add` of a journal; 52 `yarn up`; 101b an assignment to `status` or `path`; 110 a write under a repository's top-level `reports/`; 142 `npx vitest`; 174 `git tag` that creates |
| ask    | 149 an Edit or Write of a test file git already tracks                                                                                                                                 |
| warn   | 94 a dev server on a port other than 3000/1337/1338; 98 `sleep N` outside a loop; 101 a gate piped without `pipefail`; 113 `gh pr checks --watch`; 127 `mapfile`/`readarray`           |

A warning sets no `permissionDecision` (an `allow` would skip the permission
prompt for the whole command); it returns the reason as `additionalContext` and on
stderr. A command no row matches, and any input the hook cannot read, gets no
answer. Heredoc bodies, comments and quoted text are not read as commands.

## What v0.1 adds

| Row        | Why it waits                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 106b       | the secret scan (secretlint, DECISIONS 2026-10-28)                                                               |
| 73         | the admin tsc error count needs a `tsc` run inside `rules-check`                                                 |
| 17         | the `documents()`-without-`status` selector needs `:has` and a public-path scope, unproven against the code      |
| 158        | no ban on routes that re-fetch layout data until Eli rules between the two DECISIONS lines                       |
| 175        | `import/no-extraneous-dependencies` needs `eslint-plugin-import` in the backend and the seven-package allow-list |
| 24         | `react/jsx-no-literals` waits on the P3.65 strings module                                                        |
| 25, 27, 49 | need a parser or a ratchet list                                                                                  |
| —          | the parity manifest and the test floors                                                                          |
| 44         | a backfill check needs a schema diff and a backfill registry                                                     |

## Development

```sh
yarn install
yarn test          # vitest, fixtures under test/fixtures
yarn lint          # the package lints itself with its own base preset
yarn build         # tsc → dist/
yarn format:check
yarn pack --dry-run
```
