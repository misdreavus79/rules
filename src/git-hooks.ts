import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatResult, runChecks, sha256, sharedBlockOf } from './check.ts';

/**
 * Layer 3: the git hooks, run through `core.hooksPath
 * node_modules/@eumdesigns/rules/hooks/git`. Each reads `rules.config.json`
 * from the repository root; without it, the repository-specific parts skip.
 */

export type Runner = (command: string, args: string[], cwd: string) => number;

const runInherit: Runner = (command, args, cwd) =>
  spawnSync(command, args, { cwd, stdio: 'inherit' }).status ?? 1;

function git(cwd: string, args: string[]): { code: number; stdout: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout ?? '' };
}

function readConfig(root: string): Record<string, unknown> | null {
  const file = join(root, 'rules.config.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function refuse(message: string): number {
  process.stderr.write(`rules-check pre-commit: ${message}\n`);
  return 1;
}

/** pre-commit: rows 86b/148, 145, 122, 92b. Returns the exit code. */
export function preCommit(root: string): number {
  // Row 86b: no commit on main (~/.claude/CLAUDE.md Git: never work on main).
  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).stdout.trim();
  if (branch === 'main') {
    return refuse(
      'refusing a commit on main: every change lands on a branch and a pull request (CLAUDE.md: Working rituals; ~/.claude/CLAUDE.md Git).',
    );
  }

  const staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .stdout.split('\0')
    .filter((file) => file.length > 0);

  // Row 145: prettier on the staged files, through the consumer's own prettier.
  if (staged.length > 0) {
    const prettier = join(root, 'node_modules/.bin/prettier');
    if (!existsSync(prettier)) {
      return refuse(`no prettier at ${prettier}: the format gate cannot run, so it fails closed.`);
    }
    const result = spawnSync(
      prettier,
      ['--check', '--ignore-unknown', '--no-error-on-unmatched-pattern', ...staged],
      { cwd: root, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
      return refuse(
        'prettier would change a staged file; run prettier on it before committing (CLAUDE.md: PRETTIER REFLOWS A HAND-MERGED STORE TEST).',
      );
    }
  }

  const config = readConfig(root);
  if (config === null) return 0;

  // Row 122: DECISIONS.md is append-only, even for a withdrawal.
  const decisions = config.decisions as { file?: unknown } | undefined;
  if (typeof decisions?.file === 'string') {
    const diff = git(root, ['diff', '--cached', '-U0', '--', decisions.file]).stdout;
    const removed = diff
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'));
    if (removed.length > 0) {
      process.stderr.write(`${removed.join('\n')}\n`);
      return refuse(
        `${decisions.file} is append-only: a removed or changed line is refused; a withdrawal is a new dated line (CLAUDE.md: DECISIONS.md IS APPEND-ONLY, EVEN FOR A WITHDRAWAL).`,
      );
    }
  }

  // Row 92b: the shared block's hash when its file is staged.
  const shared = config.sharedBlock as { file?: unknown; hash?: unknown } | undefined;
  if (typeof shared?.file === 'string' && staged.includes(shared.file)) {
    const text = git(root, ['show', `:${shared.file}`]).stdout;
    const block = sharedBlockOf(text);
    if (typeof block !== 'string') return refuse(`${shared.file}: ${block.error}`);
    const actual = sha256(block);
    if (actual !== shared.hash) {
      return refuse(
        `${shared.file}: the staged block hash ${actual} differs from rules.config.json sharedBlock.hash; record the new hash in the same commit (CLAUDE.md: SHARED-BLOCK SYNC, SELF-DESCRIBED).`,
      );
    }
  }
  return 0;
}

/** pre-push: row 89 (`yarn format:check && yarn lint`), then `rules-check check`. */
export function prePush(root: string, run: Runner = runInherit): number {
  for (const script of ['format:check', 'lint']) {
    if (run('yarn', [script], root) !== 0) {
      process.stderr.write(
        `rules-check pre-push: yarn ${script} failed; gates run before the push (CLAUDE.md: Working rituals).\n`,
      );
      return 1;
    }
  }
  const config = readConfig(root);
  if (config === null) return 0;
  const results = runChecks(config, root);
  for (const result of results) process.stdout.write(`${formatResult(result)}\n`);
  return results.some((result) => result.outcome === 'fail') ? 1 : 0;
}
