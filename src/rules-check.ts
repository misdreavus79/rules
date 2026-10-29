#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatResult, runChecks } from './check.ts';
import { prePush, preCommit } from './git-hooks.ts';
import { hookAnswer } from './hook.ts';

const USAGE = `usage:
  rules-check check [--config rules.config.json] [--cwd <dir>]   layer 2: the repo checks
  rules-check hook bash|edit                                     layer 4: a Claude Code PreToolUse hook (JSON on stdin)
  rules-check git pre-commit|pre-push                            layer 3: the git hooks
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function check(args: string[]): number {
  const cwd = resolve(option(args, '--cwd') ?? process.cwd());
  const configPath = resolve(option(args, '--config') ?? join(cwd, 'rules.config.json'));
  if (!existsSync(configPath)) {
    process.stdout.write(`FAIL config: ${configPath} not found\n`);
    return 1;
  }
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    process.stdout.write(`FAIL config: ${configPath} is not JSON (${String(error)})\n`);
    return 1;
  }
  const results = runChecks(config, cwd);
  for (const result of results) process.stdout.write(`${formatResult(result)}\n`);
  return results.some((result) => result.outcome === 'fail') ? 1 : 0;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function hook(kind: string | undefined): number {
  if (kind !== 'bash' && kind !== 'edit') {
    process.stderr.write(USAGE);
    return 2;
  }
  const answer = hookAnswer(kind, readStdin());
  process.stdout.write(answer.stdout);
  process.stderr.write(answer.stderr);
  return 0;
}

function gitHook(name: string | undefined): number {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const root = top.status === 0 ? top.stdout.trim() : process.cwd();
  if (name === 'pre-commit') return preCommit(root);
  if (name === 'pre-push') return prePush(root);
  process.stderr.write(USAGE);
  return 2;
}

function main(args: string[]): number {
  const [command, ...rest] = args;
  if (command === 'check') return check(rest);
  if (command === 'hook') return hook(rest[0]);
  if (command === 'git') return gitHook(rest[0]);
  process.stderr.write(USAGE);
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  // A hook must never block Claude Code by crashing; every other command fails closed.
  if (process.argv[2] === 'hook') {
    process.exitCode = 0;
  } else {
    process.stderr.write(
      `rules-check: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
