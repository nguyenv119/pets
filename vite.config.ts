import { configDefaults, defineConfig } from 'vitest/config';

// Vite is used for testing (vitest) only. Production build uses build.mjs (esbuild).
// video/ is a separate npm project with its own vitest config and deps.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'video/**'] } });
