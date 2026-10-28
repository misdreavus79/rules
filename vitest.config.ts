import { defineConfig } from 'vitest/config';

// The fixtures under test/fixtures hold files named *.test.ts on purpose (an
// ESLint fixture for the test-file exemptions); only test/*.test.ts are suites.
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    testTimeout: 30000,
  },
});
