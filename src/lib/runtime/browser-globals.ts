/*
 * Browser-globals shim — runs before any route component on the client.
 *
 * `@solana/spl-token` (and parts of `@solana/web3.js`) reference a global
 * `Buffer` without importing it — the bundles assume a Node runtime or a
 * bundler that auto-injects the global. Our Vite config keeps
 * `globals.Buffer: false` (Vite 8 / Rolldown can't resolve the inject-pass
 * shim from inside transitively-installed node_modules), so we set the
 * global explicitly here.
 *
 * Imported FIRST in `+layout.svelte` (evaluated for every route) so the
 * assignment runs before any wallet / SPL-token code touches `Buffer`.
 */
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) {
	g.Buffer = Buffer;
}
