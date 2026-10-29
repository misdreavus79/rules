import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, ROOT, storeRepo } from './helpers.ts';

const BIN = join(ROOT, 'src/rules-check.ts');

function run(args: string[], input = ''): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

describe('rules-check bin', () => {
  it('hook bash reads the PreToolUse JSON on stdin and answers on stdout with exit 0', () => {
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npx vitest run' },
      cwd: ROOT,
    });
    const result = run(['hook', 'bash'], payload);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('hook bash with an empty stdin exits 0 and says nothing', () => {
    expect(run(['hook', 'bash'], '')).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('hook edit answers ask for an existing test file', () => {
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(ROOT, 'test/bin.test.ts') },
      cwd: ROOT,
    });
    const result = run(['hook', 'edit'], payload);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('check prints one line per check and exits 0 when all pass', () => {
    const dir = storeRepo();
    const result = run([
      'check',
      '--config',
      join(FIXTURES, 'check/store/rules.config.json'),
      '--cwd',
      dir,
    ]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(21);
    expect(lines).toContain('ok generatedTypes');
    expect(lines).toContain('skip templateOnlyFiles (not configured)');
  });

  it('check reads rules.config.json from --cwd by default and exits 1 on a FAIL', () => {
    const dir = storeRepo();
    writeFileSync(join(dir, 'rules.config.json'), '{"eslintMajor": 10}\n');
    const result = run(['check', '--cwd', dir]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL eslintMajor: /m);
  });

  it('check without a config file fails closed', () => {
    const dir = storeRepo();
    const result = run(['check', '--cwd', dir, '--config', join(dir, 'absent.json')]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL config: /m);
  });

  it('an unknown subcommand prints the usage and exits 2', () => {
    const result = run(['deploy']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
  });
});
