import { configDefaults, defineConfig } from 'vitest/config';

// Scoped to video/'s own subtrees so vitest never walks up and picks up the
// root config, and the default `npm test` here never launches Chromium
// (browser.smoke.test.mjs is excluded; run it via `npm run test:smoke`).
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'lib/**/*.test.mjs',
      'record/**/*.test.{ts,mjs}',
      'scripts/**/*.test.{ts,mjs}',
      'set/**/*.test.mjs',
    ],
    exclude: [...configDefaults.exclude, '**/*.smoke.test.mjs'],
  },
});
