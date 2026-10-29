/**
 * A small reader for the shell commands Claude Code's Bash tool runs. It is
 * not a shell: it splits a command into simple commands (segments), drops
 * heredoc bodies and comments (text the shell never runs as a command), and
 * pulls out words and output-redirect targets. The layer-4 rows match on
 * segments, so a quoted commit message or a heredoc that names a command is
 * not that command.
 */

export interface Segment {
  /** The words of one simple command, quotes removed. */
  words: string[];
  /** Targets of output redirects (`>`, `>>`, `&>`, `>|`, `2>`). */
  redirects: string[];
  /** The segment's output feeds a pipe (`|` or `|&`, not `||`). */
  pipedTo: boolean;
}

const HEREDOC_START = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

/** The command without heredoc bodies; the line that opens a heredoc stays. */
export function stripHeredocs(command: string): string {
  const kept: string[] = [];
  const pending: { delimiter: string; dash: boolean }[] = [];
  for (const line of command.split('\n')) {
    const open = pending[0];
    if (open) {
      const candidate = open.dash ? line.replace(/^\t+/, '') : line;
      if (candidate === open.delimiter) pending.shift();
      continue;
    }
    kept.push(line);
    for (const match of line.matchAll(HEREDOC_START)) {
      pending.push({ delimiter: match[3] ?? '', dash: match[1] === '-' });
    }
  }
  return kept.join('\n');
}

export function parseCommand(command: string): Segment[] {
  const text = stripHeredocs(command);
  const segments: Segment[] = [];
  let words: string[] = [];
  let redirects: string[] = [];
  let word = '';
  let inWord = false;
  let redirect: 'out' | 'in' | null = null;

  const endWord = (): void => {
    if (!inWord) return;
    if (redirect === 'out') redirects.push(word);
    else if (redirect === null) words.push(word);
    redirect = null;
    word = '';
    inWord = false;
  };
  const endSegment = (pipedTo: boolean): void => {
    endWord();
    if (words.length > 0 || redirects.length > 0) segments.push({ words, redirects, pipedTo });
    words = [];
    redirects = [];
    redirect = null;
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const nextChar = text[index + 1] ?? '';

    if (char === "'") {
      const end = text.indexOf("'", index + 1);
      word += text.slice(index + 1, end === -1 ? text.length : end);
      inWord = true;
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\' && index + 1 < text.length) index += 1;
        word += text[index];
        index += 1;
      }
      inWord = true;
      index += 1;
      continue;
    }
    if (char === '\\') {
      if (nextChar !== '\n') {
        word += nextChar;
        inWord = true;
      }
      index += 2;
      continue;
    }
    if (char === '#' && !inWord) {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === ' ' || char === '\t') {
      endWord();
      index += 1;
      continue;
    }
    if (char === '\n' || char === ';') {
      endSegment(false);
      index += 1;
      continue;
    }
    if (char === '|') {
      if (nextChar === '|') {
        endSegment(false);
        index += 2;
      } else {
        endSegment(true);
        index += nextChar === '&' ? 2 : 1;
      }
      continue;
    }
    if (char === '&') {
      if (nextChar === '&') {
        endSegment(false);
        index += 2;
        continue;
      }
      if (nextChar === '>') {
        endWord();
        redirect = 'out';
        index += text[index + 2] === '>' ? 3 : 2;
        continue;
      }
      endSegment(false);
      index += 1;
      continue;
    }
    if (char === '(' || char === ')' || char === '`') {
      if (word.endsWith('$')) word = word.slice(0, -1);
      if (word.length === 0) inWord = false;
      endSegment(false);
      index += 1;
      continue;
    }
    if (char === '>' || char === '<') {
      // A leading fd number (`2>`) belongs to the operator, not to a word.
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      }
      endWord();
      if (char === '<') {
        if (text.startsWith('<<<', index)) {
          index += 3;
        } else if (nextChar === '<') {
          // A heredoc opener: the delimiter word is consumed and dropped.
          index += nextChar === '<' && text[index + 2] === '-' ? 3 : 2;
        } else {
          index += nextChar === '&' ? 2 : 1;
        }
        redirect = 'in';
        continue;
      }
      let length = 1;
      if (nextChar === '>' || nextChar === '|') length = 2;
      if (nextChar === '&') {
        // `>&2`, `2>&1`: a descriptor copy, not a file.
        index += 2;
        while (index < text.length && /[\d-]/.test(text[index] ?? '')) index += 1;
        continue;
      }
      redirect = 'out';
      index += length;
      continue;
    }
    word += char;
    inWord = true;
    index += 1;
  }
  endSegment(false);
  return segments;
}

const PREFIX_WORDS = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  'time',
  'exec',
  'nohup',
  'command',
  'builtin',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/** The simple command behind keywords and leading `NAME=value` assignments. */
export function commandOf(segment: Segment): { env: Record<string, string>; words: string[] } {
  const env: Record<string, string> = {};
  let start = 0;
  while (start < segment.words.length) {
    const current = segment.words[start] ?? '';
    if (PREFIX_WORDS.has(current)) {
      start += 1;
      continue;
    }
    if (ASSIGNMENT.test(current)) {
      const equals = current.indexOf('=');
      env[current.slice(0, equals).replace(/\+$/, '')] = current.slice(equals + 1);
      start += 1;
      continue;
    }
    break;
  }
  return { env, words: segment.words.slice(start) };
}

/** Leading assignment names of a segment (`status=$?` → status). */
export function assignedNames(segment: Segment): string[] {
  const names: string[] = [];
  for (const current of segment.words) {
    if (PREFIX_WORDS.has(current)) continue;
    if (!ASSIGNMENT.test(current)) break;
    names.push(current.slice(0, current.indexOf('=')).replace(/\+$/, ''));
  }
  return names;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
