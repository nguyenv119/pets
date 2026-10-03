import { defineConfig } from 'vitest/config';

// The Chromium harness smoke test: really launches the extension, so it
// needs a long timeout (the machine-wide recording lock alone can wait up
// to 90 min for another holder) and must never run inside the default
// `npm test`, which every other bead in this epic runs as a gate.
export default defineConfig({
  test: {
    include: ['lib/**/*.smoke.test.mjs'],
    testTimeout: 6_000_000, // 100 min: step 9's 90 min lock wait plus a root build
  },
});
