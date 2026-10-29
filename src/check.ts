import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Layer 2: one reader per `rules.config.json` key (Phase 0 §5). A missing key
 * is "not configured" and skips; an unknown key or a malformed value fails
 * closed; a check with nothing to read fails closed.
 */

export type Outcome = 'ok' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  outcome: Outcome;
  detail: string;
}

type Json = Record<string, unknown>;
type Reader = (value: unknown, cwd: string, config: Json) => string[];

export const SHARED_BEGIN = '<!-- P472:SHARED:BEGIN -->';
export const SHARED_END = '<!-- P472:SHARED:END -->';

/** Directories no check descends into: dependencies, build output, dot-directories. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage']);

class ConfigError extends Error {}

function walk(root: string, visit: (file: string) => void): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function readJson(file: string): Json {
  return JSON.parse(readFileSync(file, 'utf8')) as Json;
}

/** JSON with comments and trailing commas (a tsconfig). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      index += 1;
      out += text.slice(start, index);
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function git(cwd: string, args: string[]): { code: number; stdout: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout ?? '' };
}

function requireRepo(cwd: string): void {
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']).code !== 0) {
    throw new ConfigError(`${cwd} is not a git repository`);
  }
}

function tracked(cwd: string, path: string): string[] {
  return git(cwd, ['ls-files', '--', path])
    .stdout.split('\n')
    .filter((line) => line.length > 0);
}

// ── shape guards ──────────────────────────────────────────────────────────

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ConfigError(`expected ${what}`);
  return value;
}

function asStrings(value: unknown, what: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new ConfigError(`expected ${what}`);
  }
  return value as string[];
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new ConfigError(`expected ${what}`);
  return value;
}

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`expected ${what}`);
  }
  return value as Json;
}

function asTrue(value: unknown): void {
  if (value !== true) throw new ConfigError('expected true');
}

// ── package.json readers ──────────────────────────────────────────────────

interface Manifest {
  file: string;
  json: Json;
}

function manifests(cwd: string): Manifest[] {
  const found: Manifest[] = [];
  walk(cwd, (file) => {
    if (file.endsWith('/package.json'))
      found.push({ file: relative(cwd, file), json: readJson(file) });
  });
  if (found.length === 0) throw new ConfigError('no package.json to read');
  return found;
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

function ranges(manifest: Manifest, name: string): string[] {
  const found: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest.json[field] as Record<string, string> | undefined;
    if (deps && typeof deps[name] === 'string') found.push(deps[name]);
  }
  return found;
}

function declares(manifest: Manifest, name: string): boolean {
  return ranges(manifest, name).length > 0;
}

// ── schema readers ────────────────────────────────────────────────────────

interface Attribute {
  file: string;
  name: string;
  type: unknown;
}

/** Every attribute of every content-type `schema.json` and component JSON. */
function attributes(cwd: string): Attribute[] {
  const found: Attribute[] = [];
  let files = 0;
  walk(cwd, (file) => {
    const isSchema = file.endsWith('/schema.json');
    const isComponent = file.endsWith('.json') && file.includes('/components/');
    if (!isSchema && !isComponent) return;
    let json: Json;
    try {
      json = readJson(file);
    } catch {
      return;
    }
    const attrs = json.attributes;
    if (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs)) return;
    files += 1;
    for (const [name, definition] of Object.entries(attrs as Json)) {
      found.push({ file: relative(cwd, file), name, type: (definition as Json | null)?.type });
    }
  });
  if (files === 0) throw new ConfigError('no schema.json or component JSON to read');
  return found;
}

// ── the readers ───────────────────────────────────────────────────────────

const readers: Record<string, Reader> = {
  // Row 53
  generatedTypes(value, cwd) {
    const dir = asString(value, 'a directory path');
    requireRepo(cwd);
    return tracked(cwd, dir).length > 0 ? [] : [`no tracked file under ${dir}`];
  },

  // Row 35
  eslintMajor(value, cwd) {
    const major = asNumber(value, 'a major version number');
    const pattern = new RegExp(`^\\^${major}(\\.|$)`);
    return manifests(cwd).flatMap((manifest) =>
      ranges(manifest, 'eslint')
        .filter((range) => !pattern.test(range))
        .map((range) => `${manifest.file}: eslint ${range} does not start ^${major}`),
    );
  },

  // Row 168
  typescriptBelow(value, cwd) {
    const ceiling = asNumber(value, 'a major version number');
    return manifests(cwd).flatMap((manifest) =>
      ranges(manifest, 'typescript')
        .filter((range) => {
          const major = Number(/(\d+)/.exec(range)?.[1] ?? Number.NaN);
          return !(major < ceiling);
        })
        .map((range) => `${manifest.file}: typescript ${range} is not below ${ceiling}`),
    );
  },

  // Row 54
  mantineCoreLock(value, cwd) {
    asTrue(value);
    return manifests(cwd).flatMap((manifest) => {
      const core = ranges(manifest, '@mantine/core')[0];
      if (core === undefined) return [];
      const problems: string[] = [];
      for (const field of DEPENDENCY_FIELDS) {
        const deps = (manifest.json[field] as Record<string, string> | undefined) ?? {};
        for (const [name, range] of Object.entries(deps)) {
          if (name.startsWith('@mantine/') && range !== core) {
            problems.push(`${manifest.file}: ${name} ${range} differs from @mantine/core ${core}`);
          }
        }
      }
      return problems;
    });
  },

  // Row 36
  hoistingLimits(value, cwd) {
    const spec = asObject(value, '{ file, value }');
    const file = asString(spec.file, 'hoistingLimits.file');
    const wanted = asString(spec.value, 'hoistingLimits.value');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    const installConfig = readJson(join(cwd, file)).installConfig as Json | undefined;
    const actual = installConfig?.hoistingLimits;
    return actual === wanted
      ? []
      : [`${file}: installConfig.hoistingLimits is ${JSON.stringify(actual)}, not "${wanted}"`];
  },

  // Rows 33, 157
  loadingBoundary(value, cwd) {
    const appDir = asString(asObject(value, '{ appDir }').appDir, 'loadingBoundary.appDir');
    const root = join(cwd, appDir);
    if (!existsSync(root)) throw new ConfigError(`${appDir} not found`);
    const problems: string[] = [];
    walk(root, (file) => {
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (/^loading\.(tsx|ts|jsx|js)$/.test(name)) {
        problems.push(`${relative(cwd, file)} makes every route below it stream a 200`);
      }
      if (
        /^layout\.(tsx|ts|jsx|js)$/.test(name) &&
        readFileSync(file, 'utf8').includes('<Suspense')
      ) {
        problems.push(`${relative(cwd, file)} holds a <Suspense> above its routes`);
      }
    });
    return problems;
  },

  // Row 111 (stores). The app directory is loadingBoundary.appDir, else frontend/src/app.
  englishSegments(value, cwd, config) {
    const names = new Set(asStrings(value, 'a list of segment names'));
    const reservedValue = config.reservedSegments ?? [];
    if (!Array.isArray(reservedValue) || !reservedValue.every((item) => typeof item === 'string')) {
      throw new ConfigError('expected reservedSegments as a list of names');
    }
    const reserved = new Set(reservedValue as string[]);
    const boundary = config.loadingBoundary as Json | undefined;
    const appDir = typeof boundary?.appDir === 'string' ? boundary.appDir : 'frontend/src/app';
    const root = join(cwd, appDir);
    if (!existsSync(root)) throw new ConfigError(`${appDir} not found`);
    const problems: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || reserved.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (names.has(entry.name))
          problems.push(`${relative(cwd, full)} is an English route segment`);
        visit(full);
      }
    };
    visit(root);
    return problems;
  },

  // Row 107
  topLevelIgnores(value, cwd) {
    const names = asStrings(value, 'a list of top-level names');
    const file = join(cwd, '.gitignore');
    if (!existsSync(file)) return ['.gitignore not found'];
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim());
    return names.flatMap((name) => {
      const problems: string[] = [];
      if (!lines.some((line) => line === `/${name}` || line === `/${name}/`)) {
        problems.push(`no anchored /${name}/ rule`);
      }
      if (lines.some((line) => line === name || line === `${name}/`)) {
        problems.push(`an unanchored ${name} rule matches at every depth`);
      }
      return problems;
    });
  },

  // Row 7
  untracked(value, cwd) {
    const paths = asStrings(value, 'a list of paths');
    requireRepo(cwd);
    return paths.flatMap((path) => {
      const problems: string[] = [];
      if (tracked(cwd, path).length > 0) problems.push(`${path} is tracked`);
      if (git(cwd, ['check-ignore', '-q', '--no-index', '--', path]).code !== 0) {
        problems.push(`${path} is not ignored`);
      }
      return problems;
    });
  },

  // Row 61
  textAttributes(value, cwd) {
    const names = asStrings(value, 'a list of attribute names');
    const all = attributes(cwd);
    return names.flatMap((name) => {
      const found = all.filter((attribute) => attribute.name === name);
      if (found.length === 0) return [`${name}: no schema declares it`];
      return found
        .filter((attribute) => attribute.type !== 'text')
        .map((attribute) => `${attribute.file}: ${name} is ${String(attribute.type)}, not text`);
    });
  },

  // Row 177
  priceSuffix(value, cwd) {
    asTrue(value);
    return attributes(cwd)
      .filter(
        (attribute) =>
          attribute.name.includes('price') &&
          attribute.name !== 'price' &&
          !attribute.name.endsWith('_price'),
      )
      .map((attribute) => `${attribute.file}: ${attribute.name} does not end _price`);
  },

  // Rows 8, 173
  requiredFiles(value, cwd) {
    return asStrings(value, 'a list of paths')
      .filter((file) => !existsSync(join(cwd, file)))
      .map((file) => `${file} is missing`);
  },

  // Row 162 (stores)
  templateOnlyFiles(value, cwd) {
    const files = asStrings(value, 'a list of paths');
    requireRepo(cwd);
    return files
      .filter((file) => tracked(cwd, file).length > 0)
      .map((file) => `${file} is tracked`);
  },

  // Row 161
  e2eWorkflow(value, cwd) {
    const file = asString(value, 'a workflow path');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    return /^\s*continue-on-error:\s*true\s*$/m.test(readFileSync(join(cwd, file), 'utf8'))
      ? []
      : [`${file} carries no continue-on-error: true`];
  },

  // Row 171
  backendStrict(value, cwd) {
    const file = asString(value, 'a tsconfig path');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    const tsconfig = parseJsonc(readFileSync(join(cwd, file), 'utf8')) as Json;
    const strict = (tsconfig.compilerOptions as Json | undefined)?.strict;
    return strict === true
      ? []
      : [`${file}: compilerOptions.strict is ${String(strict)}, not true`];
  },

  // Row 172
  viteWithVitest(value, cwd) {
    asTrue(value);
    const workspaces = manifests(cwd).filter((manifest) => declares(manifest, 'vitest'));
    return workspaces
      .filter((manifest) => !declares(manifest, 'vite'))
      .map((manifest) => `${manifest.file} declares vitest without vite`);
  },

  // Rows 92, 140
  sharedBlock(value, cwd) {
    const spec = asObject(value, '{ file, hash }');
    const file = asString(spec.file, 'sharedBlock.file');
    const hash = asString(spec.hash, 'sharedBlock.hash');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    const block = sharedBlockOf(readFileSync(join(cwd, file), 'utf8'));
    if (typeof block !== 'string') return [`${file}: ${block.error}`];
    const actual = sha256(block);
    return actual === hash
      ? []
      : [`${file}: block hash ${actual} differs from the recorded ${hash}`];
  },

  // Rows 163, 179
  decisions(value, cwd) {
    const spec = asObject(value, '{ file, openHeading }');
    const file = asString(spec.file, 'decisions.file');
    const openHeading = asString(spec.openHeading, 'decisions.openHeading');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    return decisionLineProblems(readFileSync(join(cwd, file), 'utf8'), openHeading).map(
      (problem) => `${file}: ${problem}`,
    );
  },

  // Row 164
  architecture(value, cwd, config) {
    const file = asString(asObject(value, '{ file }').file, 'architecture.file');
    const decisions = config.decisions as Json | undefined;
    if (typeof decisions?.file !== 'string')
      throw new ConfigError('architecture needs decisions.file');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    if (!existsSync(join(cwd, decisions.file))) return [`${decisions.file} not found`];
    return citationProblems(
      readFileSync(join(cwd, file), 'utf8'),
      readFileSync(join(cwd, decisions.file), 'utf8'),
    ).map((problem) => `${file}: ${problem}`);
  },

  // Row 13
  noStatusAttribute(value, cwd) {
    asTrue(value);
    return attributes(cwd)
      .filter((attribute) => attribute.name === 'status')
      .map((attribute) => `${attribute.file}: an attribute is named status`);
  },

  // Rows 39, 66
  setupStubs(value, cwd) {
    const spec = asObject(value, '{ file, names }');
    const file = asString(spec.file, 'setupStubs.file');
    const names = asStrings(spec.names, 'setupStubs.names');
    if (!existsSync(join(cwd, file))) return [`${file} not found`];
    const text = readFileSync(join(cwd, file), 'utf8');
    return names
      .filter((name) => !text.includes(name))
      .map((name) => `${file} does not name ${name}`);
  },
};

/** The check names, in output order: one per key. */
export const CHECK_NAMES: readonly string[] = Object.keys(readers);

/** Keys that are read but are not checks of their own: englishSegments reads reservedSegments. */
const MODIFIER_KEYS = ['reservedSegments', '$schema'];

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The shared block, both marker lines inclusive, each line newline-terminated
 * — the bytes `sed -n '/BEGIN/,/END/p' | shasum -a 256` hashes. Each marker
 * must appear exactly once as a whole line (row 140).
 */
export function sharedBlockOf(text: string): string | { error: string } {
  const lines = text.split('\n');
  const begins = lines.filter((line) => line === SHARED_BEGIN).length;
  const ends = lines.filter((line) => line === SHARED_END).length;
  if (begins !== 1 || ends !== 1) {
    return { error: `marker count wrong (BEGIN ${begins}, END ${ends}; each must be 1)` };
  }
  const begin = lines.indexOf(SHARED_BEGIN);
  const end = lines.indexOf(SHARED_END);
  if (end < begin) return { error: 'END marker precedes BEGIN' };
  return `${lines.slice(begin, end + 1).join('\n')}\n`;
}

const DATED = /^- \d{4}-\d{2}-\d{2} /;

/** Every line in a ruled section is blank, a heading, or one dated ruling. */
export function decisionLineProblems(text: string, openHeading: string): string[] {
  const problems: string[] = [];
  let ruled = false;
  text.split('\n').forEach((line, index) => {
    if (line.startsWith('## ')) {
      ruled = !line.startsWith(openHeading);
      return;
    }
    if (!ruled || line.trim() === '' || line.startsWith('#') || DATED.test(line)) return;
    problems.push(`line ${index + 1} is not a dated one-line ruling: ${line.slice(0, 60)}`);
  });
  return problems;
}

const CITATION = /DECISIONS(?:\.md)?\s+(\d{4}-\d{2}-\d{2})\s+["“]([^"”]+)["”]/g;

/** Each citation resolves to exactly one ruling with that date holding the words. */
export function citationProblems(architecture: string, decisions: string): string[] {
  const rulings = decisions.split('\n').filter((line) => DATED.test(line));
  const problems: string[] = [];
  for (const match of architecture.matchAll(/DECISIONS\.md:\d+/g)) {
    problems.push(`${match[0]} cites a line number`);
  }
  for (const match of architecture.matchAll(CITATION)) {
    const date = match[1] ?? '';
    const words = (match[2] ?? '').replace(/\s+/g, ' ');
    const hits = rulings.filter((line) => line.startsWith(`- ${date} `) && line.includes(words));
    if (hits.length !== 1) {
      problems.push(`${date} "${words}" resolves to ${hits.length} rulings, not 1`);
    }
  }
  return problems;
}

const SHOWN = 5;

function summarise(problems: string[]): string {
  const shown = problems.slice(0, SHOWN).join('; ');
  return problems.length > SHOWN ? `${shown}; (+${problems.length - SHOWN} more)` : shown;
}

export function runChecks(config: unknown, cwd: string): CheckResult[] {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [{ name: 'config', outcome: 'fail', detail: 'rules.config.json is not an object' }];
  }
  const json = config as Json;
  const results: CheckResult[] = [];
  const unknown = Object.keys(json).filter(
    (key) => !CHECK_NAMES.includes(key) && !MODIFIER_KEYS.includes(key),
  );
  if (unknown.length > 0) {
    results.push({ name: 'config', outcome: 'fail', detail: `unknown key ${unknown.join(', ')}` });
  }
  if (json.reservedSegments !== undefined && json.englishSegments === undefined) {
    results.push({
      name: 'config',
      outcome: 'fail',
      detail: 'reservedSegments without englishSegments configures nothing',
    });
  }
  for (const name of CHECK_NAMES) {
    const value = json[name];
    if (value === undefined || value === false) {
      results.push({ name, outcome: 'skip', detail: '' });
      continue;
    }
    try {
      const problems = readers[name]?.(value, cwd, json) ?? [];
      results.push(
        problems.length === 0
          ? { name, outcome: 'ok', detail: '' }
          : { name, outcome: 'fail', detail: summarise(problems) },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name, outcome: 'fail', detail: message });
    }
  }
  return results;
}

export function formatResult(result: CheckResult): string {
  if (result.outcome === 'ok') return `ok ${result.name}`;
  if (result.outcome === 'skip') return `skip ${result.name} (not configured)`;
  return `FAIL ${result.name}: ${result.detail}`;
}
