import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

/**
 * Tests run with vite-plugin-svelte (no SvelteKit runtime needed for pure-fn tests).
 * Pure-function tests (derive.ts, etc.) need minimal setup — just vitest + TS.
 */
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			$lib: path.resolve(dirname, './src/lib'),
			// SvelteKit virtual env modules — vitest doesn't load the sveltekit
			// plugin so we point the aliases at empty stubs that tests can
			// override via `vi.mock(...)` at the spec level.
			'$env/static/public': path.resolve(dirname, './src/test-stubs/env-static-public.ts'),
			'$env/static/private': path.resolve(dirname, './src/test-stubs/env-static-private.ts'),
			'$env/dynamic/public': path.resolve(dirname, './src/test-stubs/env-dynamic-public.ts'),
			'$env/dynamic/private': path.resolve(dirname, './src/test-stubs/env-dynamic-private.ts')
		},
		conditions: ['browser']
	},
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.{test,spec}.{ts,js}']
	}
});
