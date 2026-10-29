import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { assignedNames, basename, commandOf, parseCommand, type Segment } from './shell.ts';

/**
 * Layer 4: Claude Code PreToolUse hooks. Additive to the live guard
 * (`~/.claude/hooks/guard-bash.py`, which stays where it is — DECISIONS
 * 2026-10-28 "P4.87 v0 lands in `misdreavus79/rules` alone"): no row here
 * repeats what the guard blocks (push to main, amend, rebase, force-push,
 * reset, deploys, imports, `.env`, the protected docs).
 */

export type Decision = 'deny' | 'ask' | 'warn' | 'allow';

export interface Verdict {
  decision: Decision;
  reasons: string[];
}

export const REASONS = {
  journal:
    'Never `git add` a work journal: PROMPT_HISTORY.md, HISTORY.md and DEVELOPMENT_NOTES.md are gitignored on purpose (~/.claude/CLAUDE.md Git; CLAUDE.md starter contract, untracked by policy).',
  yarnUp:
    '`yarn up` rewrites the descriptor in every workspace that declares the package; a one-workspace bump is `yarn workspace <ws> add <pkg>@<range>` (CLAUDE.md: `yarn up` IS NOT WORKSPACE-SCOPED).',
  port: 'This starts a server on a port other than 3000, 1337 or 1338. Check the port first; if it is held, stop and ask, never route around to another port (CLAUDE.md: Working rituals, check its port).',
  sleep:
    'A fixed sleep is not readiness: poll the port or /_health (200 or 204) in a loop and fail closed on the timeout (CLAUDE.md: READINESS IS A SIGNAL, NEVER A SLEEP).',
  pipe: 'A pipe hides the gate’s exit code: capture it first (`cmd > log 2>&1; rc=$?`) or `set -o pipefail` (CLAUDE.md: A PIPE HIDES THE EXIT CODE).',
  zshSpecials:
    'zsh ties `status` and `path` to shell state; the captured variable is `rc` (CLAUDE.md: A PIPE HIDES THE EXIT CODE; ~/.claude/CLAUDE.md: never name a variable path).',
  reports:
    'reports/ is the archive: read for the parity preflight and written by nothing; long outputs go under .sandbox/<card>/ (CLAUDE.md: reports/ IS THE ARCHIVE).',
  prChecks:
    '`gh pr checks --watch` can return 0 before the workflow is queued; the CI gate is `gh run watch <run-id> --exit-status` (CLAUDE.md: `gh pr checks --watch` CAN RETURN 0 BEFORE THE WORKFLOW IS QUEUED).',
  mapfile:
    'macOS /bin/bash is 3.2 and has no mapfile or readarray: loop with `while read` (CLAUDE.md: macOS `/bin/bash` IS 3.2).',
  npxVitest:
    '`npx vitest` in a store’s frontend resolves the root’s hoisted vitest, which cannot load jsdom; run `yarn vitest run <files>` (CLAUDE.md: IN A STORE’S `frontend/`, `npx vitest` RESOLVES THE ROOT’S HOISTED VITEST).',
  testEdit:
    'This edits an existing test. A test changes only when the behaviour it describes changes, with Eli’s approval; never edit a test to make it pass (~/.claude/CLAUDE.md: Tests).',
  tag: 'Tags are Eli’s (DECISIONS 2026-10-23 "`@eumdesigns/ui` lives in its own repository").',
} as const;

const RANK: Record<Decision, number> = { allow: 0, warn: 1, ask: 2, deny: 3 };

class Collector {
  private found: { decision: Decision; reason: string }[] = [];

  add(decision: Decision, reason: string): void {
    if (!this.found.some((item) => item.reason === reason)) this.found.push({ decision, reason });
  }

  verdict(): Verdict {
    if (this.found.length === 0) return { decision: 'allow', reasons: [] };
    const top = Math.max(...this.found.map((item) => RANK[item.decision]));
    const decision = (Object.keys(RANK) as Decision[]).find((key) => RANK[key] === top) ?? 'allow';
    return {
      decision,
      reasons: this.found.filter((item) => RANK[item.decision] === top).map((item) => item.reason),
    };
  }
}

// ── command shapes ────────────────────────────────────────────────────────

const RUNNERS = new Set(['yarn', 'npx', 'npm', 'pnpm']);

/** The tool a segment runs, behind yarn/npx/npm/pnpm and a node_modules/.bin path. */
function invocation(words: string[]): { runner: string | null; words: string[] } {
  const first = words[0] ?? '';
  if (!RUNNERS.has(first)) {
    return { runner: null, words: [basename(first), ...words.slice(1)] };
  }
  let rest = words.slice(1);
  if (first === 'yarn') {
    while (rest[0] === '--cwd' || rest[0] === 'workspace') rest = rest.slice(2);
    if (rest[0] === 'run' || rest[0] === 'exec') rest = rest.slice(1);
  } else if (first === 'npm' || first === 'pnpm') {
    if (rest[0] === 'run' || rest[0] === 'exec' || rest[0] === 'run-script' || rest[0] === 'dlx') {
      rest = rest.slice(1);
    }
  } else {
    while ((rest[0] ?? '').startsWith('-')) rest = rest.slice(1);
  }
  return { runner: first, words: rest };
}

const GATE_SCRIPT = /^(test|lint|build|format:check|typecheck)(:|$)/;

function isGate(words: string[]): boolean {
  const { runner, words: tool } = invocation(words);
  const name = basename(tool[0] ?? '');
  if (runner !== null && runner !== 'npx' && GATE_SCRIPT.test(name)) return true;
  if (['tsc', 'vitest', 'eslint'].includes(name)) return true;
  if (name === 'prettier') return tool.some((arg) => arg === '--check' || arg === '-c');
  if (name === 'next') return tool[1] === 'build';
  return false;
}

const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

function gitSubcommand(words: string[]): { name: string; args: string[] } | null {
  if (basename(words[0] ?? '') !== 'git') return null;
  let index = 1;
  while (index < words.length && (words[index] ?? '').startsWith('-')) {
    index += GIT_OPTIONS_WITH_VALUE.has(words[index] ?? '') ? 2 : 1;
  }
  const name = words[index];
  return name === undefined ? null : { name, args: words.slice(index + 1) };
}

const JOURNALS = new Set(['PROMPT_HISTORY.md', 'HISTORY.md', 'DEVELOPMENT_NOTES.md']);

const TAG_LISTING =
  /^(-l|--list|-n\d*|--contains|--no-contains|--points-at|--merged|--no-merged|--column|--sort|--format|-v|--verify|-d|--delete)(=|$)/;
const TAG_VALUE_OPTIONS = new Set([
  '-m',
  '--message',
  '-F',
  '--file',
  '-u',
  '--local-user',
  '--cleanup',
]);

function createsTag(args: string[]): boolean {
  if (args.some((arg) => TAG_LISTING.test(arg))) return false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (TAG_VALUE_OPTIONS.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return true;
  }
  return false;
}

const SERVER_SCRIPTS = new Set(['dev', 'start', 'develop']);
const ALLOWED_PORTS = new Set(['3000', '1337', '1338']);

function serverPort(env: Record<string, string>, words: string[]): string | null {
  const { runner, words: tool } = invocation(words);
  const name = basename(tool[0] ?? '');
  const isServer =
    (name === 'next' && ['dev', 'start'].includes(tool[1] ?? '')) ||
    (name === 'strapi' && ['develop', 'start', 'dev'].includes(tool[1] ?? '')) ||
    (runner !== null && runner !== 'npx' && SERVER_SCRIPTS.has(name));
  if (!isServer) return null;
  for (let index = 0; index < tool.length; index += 1) {
    const arg = tool[index] ?? '';
    if (arg === '-p' || arg === '--port') return tool[index + 1] ?? null;
    const inline = /^(?:--port=|-p)(\d+)$/.exec(arg);
    if (inline) return inline[1] ?? null;
  }
  return env.PORT ?? null;
}

function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
  if (path.startsWith('$HOME/')) return join(homedir(), path.slice('$HOME'.length));
  return path;
}

/** True when the path sits under `reports/` at the top of a git repository. */
export function underTopLevelReports(path: string): boolean {
  const parts = resolve(path).split('/');
  for (let index = 1; index < parts.length; index += 1) {
    if (parts[index] !== 'reports') continue;
    const parent = parts.slice(0, index).join('/') || '/';
    if (existsSync(join(parent, '.git'))) return true;
  }
  return false;
}

function writeTargets(segment: Segment, words: string[]): string[] {
  const targets = [...segment.redirects];
  const tool = basename(words[0] ?? '');
  const args = words.slice(1);
  const operands = args.filter((arg) => !arg.startsWith('-'));
  if (tool === 'cp' || tool === 'mv') {
    const flagged = args.findIndex((arg) => arg === '-t' || arg.startsWith('--target-directory'));
    if (flagged !== -1) {
      const arg = args[flagged] ?? '';
      targets.push(arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : (args[flagged + 1] ?? ''));
    } else if (operands.length >= 2) {
      targets.push(operands[operands.length - 1] ?? '');
    }
  }
  if (tool === 'tee' || tool === 'mkdir') targets.push(...operands);
  return targets.filter((target) => target.length > 0);
}

const ZSH_SPECIALS = new Set(['status', 'path']);
const DECLARERS = new Set([
  'export',
  'local',
  'declare',
  'typeset',
  'readonly',
  'integer',
  'float',
]);

function assignsZshSpecial(segment: Segment, words: string[]): boolean {
  if (assignedNames(segment).some((name) => ZSH_SPECIALS.has(name))) return true;
  const first = words[0] ?? '';
  const rest = words.slice(1);
  if (DECLARERS.has(first)) {
    return rest.some((arg) => ZSH_SPECIALS.has(arg.split('=')[0]?.replace(/\+$/, '') ?? ''));
  }
  if (first === 'for' || first === 'select') return ZSH_SPECIALS.has(rest[0] ?? '');
  if (first === 'read') return rest.some((arg) => !arg.startsWith('-') && ZSH_SPECIALS.has(arg));
  return false;
}

// ── the deciders ──────────────────────────────────────────────────────────

export function decideBash(command: string, cwd: string): Verdict {
  const found = new Collector();
  const segments = parseCommand(command);
  const hasLoop = segments.some((segment) =>
    ['while', 'until', 'for', 'select'].includes(segment.words[0] ?? ''),
  );
  const pipefail = /\bpipefail\b/.test(command);

  // Row 127: the text, heredoc bodies included (a gate script written by heredoc is the case).
  if (/\b(mapfile|readarray)\b/.test(command)) found.add('warn', REASONS.mapfile);

  for (const segment of segments) {
    const { env, words } = commandOf(segment);
    const { runner, words: tool } = invocation(words);
    const git = gitSubcommand(words);

    // Row 101b
    if (assignsZshSpecial(segment, words)) found.add('deny', REASONS.zshSpecials);

    // Row 142
    if (runner === 'npx' || (runner !== null && (words[1] === 'exec' || words[1] === 'dlx'))) {
      if (/^vitest(@|$)/.test(tool[0] ?? '')) found.add('deny', REASONS.npxVitest);
    }

    // Row 52
    if (words[0] === 'yarn' && tool[0] === 'up' && runner === 'yarn')
      found.add('deny', REASONS.yarnUp);

    // Row 7b
    if (git?.name === 'add' && git.args.some((arg) => JOURNALS.has(basename(arg)))) {
      found.add('deny', REASONS.journal);
    }

    // Row 174 (`git tag -d` is the guard's)
    if (git?.name === 'tag' && createsTag(git.args)) found.add('deny', REASONS.tag);

    // Row 110
    for (const target of writeTargets(segment, words)) {
      const absolute = expandHome(target);
      if (underTopLevelReports(isAbsolute(absolute) ? absolute : join(cwd, absolute))) {
        found.add('deny', REASONS.reports);
      }
    }

    // Row 113
    if (basename(words[0] ?? '') === 'gh' && words[1] === 'pr' && words[2] === 'checks') {
      if (words.includes('--watch')) found.add('warn', REASONS.prChecks);
    }

    // Row 94
    const port = serverPort(env, words);
    if (port !== null && !ALLOWED_PORTS.has(port)) found.add('warn', REASONS.port);

    // Row 98
    if (basename(words[0] ?? '') === 'sleep' && /^\d/.test(words[1] ?? '') && !hasLoop) {
      found.add('warn', REASONS.sleep);
    }

    // Row 101
    if (segment.pipedTo && !pipefail && isGate(words)) found.add('warn', REASONS.pipe);
  }
  return found.verdict();
}

function isTracked(file: string): boolean {
  const directory = dirname(file);
  if (!existsSync(directory)) return false;
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', basename(file)], {
    cwd: directory,
    encoding: 'utf8',
  });
  return result.status === 0;
}

export function decideEdit(filePath: string, cwd: string): Verdict {
  const found = new Collector();
  const file = resolve(cwd, expandHome(filePath));
  // Row 110
  if (underTopLevelReports(file)) found.add('deny', REASONS.reports);
  // Row 149: an existing test file is one git tracks in its own repository.
  if (/\.test\.(ts|tsx|js)$/.test(file) && isTracked(file)) found.add('ask', REASONS.testEdit);
  return found.verdict();
}

// ── the wire format ───────────────────────────────────────────────────────

export interface HookAnswer {
  stdout: string;
  stderr: string;
}

const SILENT: HookAnswer = { stdout: '', stderr: '' };

/**
 * Claude Code's PreToolUse answer. deny and ask carry `permissionDecision`.
 * A warning carries NO permission decision — `allow` would bypass the
 * permission system for the whole command — only `additionalContext` (seen
 * by the model) and the reason on stderr. A command no row matches, and any
 * input this cannot read, answers nothing: the hook never blocks by crashing.
 */
export function hookAnswer(kind: 'bash' | 'edit', stdin: string): HookAnswer {
  try {
    if (stdin.trim() === '') return SILENT;
    const payload = JSON.parse(stdin) as {
      cwd?: unknown;
      tool_input?: { command?: unknown; file_path?: unknown };
    };
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
    const input = payload.tool_input ?? {};
    let verdict: Verdict;
    if (kind === 'bash') {
      if (typeof input.command !== 'string') return SILENT;
      verdict = decideBash(input.command, cwd);
    } else {
      if (typeof input.file_path !== 'string') return SILENT;
      verdict = decideEdit(input.file_path, cwd);
    }
    if (verdict.decision === 'allow') return SILENT;
    const reason = verdict.reasons.join(' ');
    if (verdict.decision === 'warn') {
      return {
        stdout: JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reason },
        }),
        stderr: `rules-check: ${reason}\n`,
      };
    }
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: verdict.decision,
          permissionDecisionReason: reason,
        },
      }),
      stderr: '',
    };
  } catch {
    return SILENT;
  }
}
