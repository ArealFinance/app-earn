import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vite';

// `@solana/web3.js` and `@solana/spl-token` reach for Node's `Buffer`
// global in browser code. We make the `buffer` module resolvable here and
// set `globalThis.Buffer` explicitly via the runtime shim
// (`src/lib/runtime/browser-globals.ts`, imported first in +layout.svelte).
//
// `globals.Buffer: false` — disable the inject pass (Vite 8 / Rolldown can't
// resolve the inject shim from inside transitively-installed node_modules);
// the manual shim covers the global. Mirrors the main app's approach.
export default defineConfig({
	plugins: [
		nodePolyfills({
			include: ['buffer'],
			// Buffer: true — inject the Buffer global into every module that
			// references it. @solana/spl-token uses `Buffer` at module top-level
			// WITHOUT importing it, so the inject pass (not a runtime shim) is
			// what guarantees it's defined before the dep evaluates.
			globals: { Buffer: true, global: true, process: false }
		}),
		sveltekit()
	],
	server: {
		port: 5173,
		strictPort: false
	}
});
