import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
// The package lints itself with its own base preset, read from the SOURCE
// (Node 24 strips the types), so `yarn lint` needs no build first.
import base from './src/eslint/base.ts';

export default defineConfig([
  globalIgnores(['dist/**', 'test/fixtures/**']),
  ...tseslint.configs.recommended,
  ...base,
]);
