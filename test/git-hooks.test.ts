import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prePush, type Runner } from '../src/git-hooks.ts';
import { git, initRepo, ROOT, tempDir } from './helpers.ts';

const BLOCK = [
  '# Conventions',
  '',
  '<!-- P472:SHARED:BEGIN -->',
  '',
  '- A rule.',
  '',
  '<!-- P472:SHARED:END -->',
  '',
].join('\n');

/**
 * A consumer repository: rules.config.json with `decisions` and `sharedBlock`,
 * the package's own prettier through a node_modules link, and core.hooksPath
 * at a hooks directory whose scripts run this checkout's source bin (the
 * shipped hooks/git scripts run dist/, which a test run has not built).
 */
function consumer(options: { config?: boolean; branch?: string } = {}): string {
  const dir = tempDir('githook');
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  writeFileSync(
    join(dir, 'DECISIONS.md'),
    '# DECISIONS\n\n## Estate\n\n- 2026-07-30 The template is a starter.\n',
  );
  writeFileSync(join(dir, 'CLAUDE.md'), BLOCK);
  if (options.config !== false) {
    writeFileSync(
      join(dir, 'rules.config.json'),
      `${JSON.stringify(
        {
          decisions: { file: 'DECISIONS.md', openHeading: '## Open' },
          sharedBlock: { file: 'CLAUDE.md', hash: blockHash(BLOCK) },
        },
        null,
        2,
      )}\n`,
    );
  }
  initRepo(dir, options.branch ?? 'queue/test');
  const hooks = join(dir, '.hooks');
  mkdirSync(hooks);
  for (const name of ['pre-commit', 'pre-push']) {
    const script = join(hooks, name);
    writeFileSync(
      script,
      `#!/bin/sh\nexec "${process.execPath}" "${join(ROOT, 'src/rules-check.ts')}" git ${name}\n`,
    );
    chmodSync(script, 0o755);
  }
  git(dir, 'config', 'core.hooksPath', hooks);
  return dir;
}

function blockHash(text: string): string {
  const lines = text.split('\n');
  const begin = lines.indexOf('<!-- P472:SHARED:BEGIN -->');
  const end = lines.indexOf('<!-- P472:SHARED:END -->');
  const block = `${lines.slice(begin, end + 1).join('\n')}\n`;
  return createHash('sha256').update(block).digest('hex');
}

function commit(dir: string, file: string, content: string): { code: number; output: string } {
  writeFileSync(join(dir, file), content);
  git(dir, 'add', file);
  const run = spawnSync('git', ['commit', '-q', '-m', 'change'], { cwd: dir, encoding: 'utf8' });
  return { code: run.status ?? 1, output: `${run.stdout}${run.stderr}` };
}

describe('git pre-commit', () => {
  it('row 86b: refuses a commit on main', () => {
    const dir = consumer({ branch: 'main' });
    const result = commit(dir, 'note.md', '# Note\n');
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/main/);
  });

  it('row 86b: accepts the same commit on a branch', () => {
    const dir = consumer();
    expect(commit(dir, 'note.md', '# Note\n').code).toBe(0);
  });

  it('row 145: refuses a staged file prettier would change', () => {
    const dir = consumer();
    const result = commit(dir, 'bad.ts', 'export const value = {a:1,\n    b:2}\n');
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/bad\.ts/);
  });

  it('row 122: refuses a changed DECISIONS line', () => {
    const dir = consumer();
    const result = commit(
      dir,
      'DECISIONS.md',
      '# DECISIONS\n\n## Estate\n\n- 2026-07-30 The template is a seed.\n',
    );
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/DECISIONS\.md/);
  });

  it('row 122: accepts an appended DECISIONS line', () => {
    const dir = consumer();
    appendFileSync(join(dir, 'DECISIONS.md'), '- 2026-10-28 A new ruling.\n');
    git(dir, 'add', 'DECISIONS.md');
    const run = spawnSync('git', ['commit', '-q', '-m', 'append'], { cwd: dir, encoding: 'utf8' });
    expect(run.status).toBe(0);
  });

  it('row 92b: refuses a staged CLAUDE.md whose block hash differs from the config', () => {
    const dir = consumer();
    const result = commit(dir, 'CLAUDE.md', BLOCK.replace('- A rule.', '- A changed rule.'));
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/hash/);
  });

  it('without rules.config.json the repo-specific parts skip', () => {
    const dir = consumer({ config: false });
    const result = commit(
      dir,
      'DECISIONS.md',
      '# DECISIONS\n\n## Estate\n\n- 2026-07-30 The template is a seed.\n',
    );
    expect(result.code).toBe(0);
  });
});

describe('git pre-push (row 89)', () => {
  function recorder(failOn?: string): { run: Runner; calls: string[] } {
    const calls: string[] = [];
    const run: Runner = (command, args) => {
      const line = [command, ...args].join(' ');
      calls.push(line);
      return line.includes(failOn ?? '\u0000') ? 1 : 0;
    };
    return { run, calls };
  }

  it('stops at the first failing gate', () => {
    const { run, calls } = recorder('format:check');
    expect(prePush(consumer(), run)).toBe(1);
    expect(calls).toEqual(['yarn format:check']);
  });

  it('runs format:check, then lint, then rules-check check', () => {
    const { run, calls } = recorder();
    expect(prePush(consumer(), run)).toBe(0);
    expect(calls).toEqual(['yarn format:check', 'yarn lint']);
  });

  it('a failing rules-check check fails the push', () => {
    const dir = consumer();
    writeFileSync(join(dir, 'rules.config.json'), '{"eslintMajor": 9}\n');
    const { run } = recorder();
    expect(prePush(dir, run)).toBe(1);
  });
});

describe('the shipped hook files', () => {
  it.each(['pre-commit', 'pre-push'])(
    'hooks/git/%s is an executable sh script that runs the bin',
    (name) => {
      const file = join(ROOT, 'hooks/git', name);
      expect(statSync(file).mode & 0o777).toBe(0o755);
      const text = readFileSync(file, 'utf8');
      expect(text.startsWith('#!/bin/sh\n')).toBe(true);
      expect(text).toMatch(new RegExp(`exec node .*dist/rules-check\\.js" git ${name}`));
    },
  );

  it('hooks/claude/settings.json carries the Bash and Edit|Write PreToolUse entries', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, 'hooks/claude/settings.json'), 'utf8'));
    const entries = settings.hooks.PreToolUse as {
      matcher: string;
      hooks: { type: string; command: string }[];
    }[];
    const byMatcher = Object.fromEntries(entries.map((entry) => [entry.matcher, entry.hooks]));
    expect(byMatcher.Bash[0].type).toBe('command');
    expect(byMatcher.Bash[0].command).toMatch(/rules-check hook bash$/);
    expect(byMatcher['Edit|Write'][0].command).toMatch(/rules-check hook edit$/);
  });
});
