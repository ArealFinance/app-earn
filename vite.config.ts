import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vite';

// `@solana/web3.js` and `@solana/spl-token` reach for Node's `Buffer`
// global in browser code. We make the `buffer` module resolvable here and
// set `globalThis.Buffer` explicitly via the runtime shim
// (`src/lib/runtime/browser-globals.ts`, imported first in +layout.svelte).
export default defineConfig({
	plugins: [
		nodePolyfills({
			// `@meteora-ag/dlmm` + `@coral-xyz/anchor` reach for Node's `process`
			// and `Buffer` at module-eval time. The production (Rolldown) build
			// happens to tree-shake `process` away, but the dev server (esbuild
			// prebundle) does NOT — it throws `process is not defined` on eval.
			// Polyfilling `process` (and Buffer) keeps BOTH paths working.
			include: ['buffer', 'process'],
			// Buffer: true — inject the Buffer global into every module that
			// references it. @solana/spl-token uses `Buffer` at module top-level
			// WITHOUT importing it, so the inject pass (not a runtime shim) is
			// what guarantees it's defined before the dep evaluates.
			// process: true — same story for anchor's `process.env` lookups.
			globals: { Buffer: true, global: true, process: true }
		}),
		sveltekit()
	],
	build: {
		rollupOptions: {
			output: {
				/*
				 * Pin the Solana stack into a dedicated `vendor-solana` chunk.
				 *
				 * Root cause this isolates: `uuid` (transitive via
				 * @solana/web3.js → jayson / rpc-websockets) has
				 * `export var URL = '6ba7b811-…'` (its v3/v5 namespace constant).
				 * When uuid is scope-hoisted into the SAME chunk as a route that
				 * does an asset `import x from '*.png'`, Vite's asset codegen emits
				 * `new URL(rel, import.meta.url)` referencing the GLOBAL `URL`
				 * constructor — but Rollup's flat hoisted scope binds that bare
				 * `URL` to uuid's string constant instead. Result at runtime:
				 * `new '6ba7b811-…'(…)` → `TypeError: … is not a constructor`,
				 * 500-ing any route that imports an asset.
				 *
				 * Splitting the Solana/uuid stack into its own chunk keeps it out
				 * of the route chunks' scope, so route-level asset imports resolve
				 * `URL` to the native global. Mirrors the main app's approach.
				 */
				manualChunks(id: string) {
					const norm = id.replace(/\\/g, '/');
					if (
						norm.includes('/node_modules/@solana/') ||
						norm.includes('/node_modules/@meteora-ag/') ||
						norm.includes('/node_modules/@coral-xyz/') ||
						norm.includes('/node_modules/uuid/') ||
						norm.includes('/node_modules/jayson/') ||
						norm.includes('/node_modules/rpc-websockets/') ||
						norm.includes('/node_modules/bn.js/') ||
						norm.includes('/node_modules/bs58/') ||
						norm.includes('/node_modules/tweetnacl/') ||
						norm.includes('/node_modules/buffer/')
					) {
						return 'vendor-solana';
					}
					return undefined;
				}
			}
		}
	},
	server: {
		port: 5173,
		strictPort: false
	}
});
