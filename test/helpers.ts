import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const FIXTURES = join(ROOT, 'test/fixtures');

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `rules-${prefix}-`));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A git repository holding `files`, committed once on `branch`. */
export function initRepo(dir: string, branch = 'queue/test'): string {
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'fixture@example.test');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture', '--no-verify');
  return dir;
}

/** A copy of the store-shaped fixture tree, mutated, then committed in a fresh repository. */
export function storeRepo(mutate?: (dir: string) => void): string {
  const dir = tempDir('store');
  cpSync(join(FIXTURES, 'check/store'), dir, { recursive: true });
  mutate?.(dir);
  return initRepo(dir);
}

export function storeConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, 'check/store/rules.config.json'), 'utf8'));
}

export function editJson(file: string, edit: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  edit(value);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function replaceIn(file: string, from: string | RegExp, to: string): void {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(from, to);
  if (after === before) throw new Error(`replaceIn: no change in ${file}`);
  writeFileSync(file, after);
}
