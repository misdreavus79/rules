import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideBash, decideEdit, hookAnswer } from '../src/hook.ts';
import { initRepo, tempDir } from './helpers.ts';

/** A repository with a tracked test file, a tracked source file and a reports plugin. */
function repo(): string {
  const dir = tempDir('hook');
  mkdirSync(join(dir, 'src/plugins/reports/server'), { recursive: true });
  writeFileSync(join(dir, 'src/a.test.ts'), 'export {};\n');
  writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
  writeFileSync(join(dir, 'src/plugins/reports/server/index.js'), 'module.exports = {};\n');
  return initRepo(dir);
}

const REPO = repo();

type Expected = 'deny' | 'ask' | 'warn' | 'allow';

const bashCases: [string, string, Expected][] = [
  // row 7b — a journal is never staged
  ['7b', 'git add PROMPT_HISTORY.md', 'deny'],
  ['7b', 'git -C /tmp/x add backend/HISTORY.md', 'deny'],
  ['7b', 'git add -f DEVELOPMENT_NOTES.md src/a.ts', 'deny'],
  ['7b', 'git add src/a.ts', 'allow'],
  ['7b', 'cat PROMPT_HISTORY.md', 'allow'],
  ['7b', 'git add PROMPT_HISTORY.md.bak', 'allow'],
  // row 52 — `yarn up` is not workspace-scoped
  ['52', 'yarn up eslint', 'deny'],
  ['52', 'yarn workspace backend up vite', 'deny'],
  ['52', 'yarn workspace backend add vite@^8.3.5', 'allow'],
  ['52', 'yarn upgrade-interactive', 'allow'],
  // row 94 — a server on a port other than 3000/1337/1338
  ['94', 'PORT=3100 yarn dev', 'warn'],
  ['94', 'npx next dev -p 3100', 'warn'],
  ['94', 'yarn develop --port=1400', 'warn'],
  ['94', 'npx next dev -p 3000', 'allow'],
  ['94', 'yarn dev', 'allow'],
  ['94', 'PORT=1337 yarn develop', 'allow'],
  // row 98 — readiness is a signal, never a sleep
  ['98', 'sleep 5', 'warn'],
  ['98', 'yarn dev & sleep 10; curl -s localhost:3000', 'warn'],
  ['98', 'until curl -s localhost:1337/_health; do sleep 1; done', 'allow'],
  ['98', 'echo sleep 5', 'allow'],
  // row 101 — a gate piped without pipefail
  ['101', 'yarn test | tail -5', 'warn'],
  ['101', 'yarn lint 2>&1 | tee lint.log', 'warn'],
  ['101', 'npx tsc --noEmit | head', 'warn'],
  ['101', 'yarn vitest run | grep fail', 'warn'],
  ['101', 'prettier --check . | tail', 'warn'],
  ['101', 'set -o pipefail; yarn test | tail -5', 'allow'],
  ['101', 'yarn test > log 2>&1; rc=$?; echo "exit $rc"', 'allow'],
  ['101', 'prettier --write . | tail', 'allow'],
  ['101', 'yarn test || echo failed', 'allow'],
  // row 101b — the captured variable is rc, never status or path
  ['101b', 'yarn test; status=$?', 'deny'],
  ['101b', 'rc=0; path=/tmp/x', 'deny'],
  ['101b', 'export path=/a', 'deny'],
  ['101b', 'for path in a b; do echo $path; done', 'deny'],
  ['101b', 'yarn test; rc=$?', 'allow'],
  ['101b', 'rc_status=1', 'allow'],
  ['101b', 'git status', 'allow'],
  ['101b', 'echo status=ok', 'allow'],
  // row 113 — the CI gate is gh run watch
  ['113', 'gh pr checks 12 --watch', 'warn'],
  ['113', 'gh pr checks 12', 'allow'],
  ['113', 'gh run watch 123 --exit-status', 'allow'],
  // row 127 — macOS bash 3.2 has no mapfile
  ['127', 'mapfile -t files < list.txt', 'warn'],
  ['127', 'readarray lines < list.txt', 'warn'],
  ['127', 'while read -r line; do echo "$line"; done < list.txt', 'allow'],
  // row 142 — never npx vitest
  ['142', 'npx vitest run src/a.test.ts', 'deny'],
  ['142', 'cd frontend && npx vitest', 'deny'],
  ['142', 'yarn vitest run src/a.test.ts', 'allow'],
  ['142', 'npx tsc --noEmit', 'allow'],
  // row 174 — tags are Eli's
  ['174', 'git tag v0.1.0', 'deny'],
  ['174', 'git tag -a v0.1.0 -m "release"', 'deny'],
  ['174', 'git tag', 'allow'],
  ['174', 'git tag -l', 'allow'],
  ['174', "git tag --list 'v*'", 'allow'],
  ['174', 'git tag -d v0.1.0', 'allow'],
  // row 110 — reports/ is written by nothing
  ['110', 'echo x > reports/a.md', 'deny'],
  ['110', 'cp a.md reports/', 'deny'],
  ['110', 'mv a.md reports/b.md', 'deny'],
  ['110', 'yarn lint 2>&1 | tee reports/lint.log', 'deny'],
  ['110', 'mkdir -p reports/new', 'deny'],
  ['110', `echo x >> ${REPO}/reports/y.md`, 'deny'],
  ['110', 'cat reports/a.md', 'allow'],
  ['110', 'cp reports/a.md .sandbox/b.md', 'allow'],
  ['110', 'echo x > src/plugins/reports/a.ts', 'allow'],
  // text the shell never runs is not a command
  ['heredoc', "cat > note.md <<'EOF'\nnpx vitest run\ngit tag v1\nEOF", 'allow'],
  ['quoted', 'git commit -m "never npx vitest; never git tag v1"', 'allow'],
  ['empty', '', 'allow'],
];

describe('hook bash: each row answers a matching and a non-matching command', () => {
  it.each(bashCases)('row %s: %s → %s', (_row, command, expected) => {
    const answer = decideBash(command, REPO);
    expect(answer.decision).toBe(expected);
    if (expected !== 'allow') expect(answer.reasons.join(' ')).toMatch(/CLAUDE\.md|DECISIONS/);
  });

  it('a block wins over a warning in the same command', () => {
    expect(decideBash('sleep 5; npx vitest run', REPO).decision).toBe('deny');
  });
});

describe('hook edit', () => {
  it('row 149: an Edit of an existing test file asks', () => {
    expect(decideEdit(join(REPO, 'src/a.test.ts'), REPO).decision).toBe('ask');
  });

  it('row 149: a new test file and an existing source file pass', () => {
    expect(decideEdit(join(REPO, 'src/b.test.ts'), REPO).decision).toBe('allow');
    expect(decideEdit(join(REPO, 'src/a.ts'), REPO).decision).toBe('allow');
  });

  it('row 110: a write under the top-level reports/ is blocked; the reports plugin is not', () => {
    expect(decideEdit(join(REPO, 'reports/audit.md'), REPO).decision).toBe('deny');
    expect(decideEdit(join(REPO, 'src/plugins/reports/server/index.js'), REPO).decision).toBe(
      'allow',
    );
  });
});

describe('hookAnswer: the PreToolUse wire format', () => {
  const payload = (tool: string, input: Record<string, unknown>): string =>
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_input: input,
      cwd: REPO,
    });

  it('a block answers deny with the bullet it enforces', () => {
    const answer = hookAnswer('bash', payload('Bash', { command: 'npx vitest run' }));
    const output = JSON.parse(answer.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/npx vitest/);
  });

  it('an existing test file answers ask', () => {
    const answer = hookAnswer('edit', payload('Edit', { file_path: join(REPO, 'src/a.test.ts') }));
    expect(JSON.parse(answer.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('a warning never grants a permission: it carries context and stderr, no decision', () => {
    const answer = hookAnswer('bash', payload('Bash', { command: 'sleep 5' }));
    const output = JSON.parse(answer.stdout);
    expect(output.hookSpecificOutput).not.toHaveProperty('permissionDecision');
    expect(output.hookSpecificOutput.additionalContext).toMatch(/sleep/);
    expect(answer.stderr).toMatch(/sleep/);
  });

  it('a command no row matches answers nothing (the permission flow is untouched)', () => {
    expect(hookAnswer('bash', payload('Bash', { command: 'git status' }))).toEqual({
      stdout: '',
      stderr: '',
    });
  });

  it('an empty or unparsable stdin answers nothing: the hook never blocks by crashing', () => {
    expect(hookAnswer('bash', '')).toEqual({ stdout: '', stderr: '' });
    expect(hookAnswer('bash', '{not json')).toEqual({ stdout: '', stderr: '' });
    expect(hookAnswer('edit', JSON.stringify({ tool_name: 'Edit' }))).toEqual({
      stdout: '',
      stderr: '',
    });
  });
});
