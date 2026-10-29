# CLAUDE.md — @eumdesigns/rules

How the machine works in this repository.

- Tests first. Write the tests for the behaviour, run them, see them fail for the
  expected reason, commit them, then write the code. A test changes only when the
  behaviour it describes changes, and that needs Eli's approval.
- Rulings live in the template's `DECISIONS.md`
  (`~/Work/strapi-mantine-template/DECISIONS.md`). This repository has no
  DECISIONS or ARCHITECTURE file, and the template's five-files rule does not
  apply here: `README.md` says how to use the package, this file says how to work
  on it, `PROMPT_HISTORY.md` (gitignored) says what happened.
- This file carries no shared block. The template's shared block is the prose the
  package's rows retire; a row moves here only from the Phase 0 table.
- The Claude Code hook is additive. The live guard in `~/.claude/hooks` stays
  where it is, and no row here repeats what it blocks.
- Never `main`, never a tag, never a merge: work lands on a branch and a pull
  request; tags are Eli's.
- Node 24 (`.nvmrc`), Yarn 4 through Corepack. Gates read exit codes:
  `yarn test`, `yarn lint`, `yarn build`, `yarn format:check`, `yarn pack --dry-run`.
- Fixture files under `test/fixtures/` break rules on purpose; ESLint and Prettier
  skip that directory. A fixture named `DECISIONS.md` or `ARCHITECTURE.md` is
  written with the Write tool: the guard refuses a `>` onto those names.
