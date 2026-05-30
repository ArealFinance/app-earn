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

const g = globalThis as unknown as {
	Buffer?: typeof Buffer;
	process?: { env: Record<string, string | undefined> };
};
if (!g.Buffer) {
	g.Buffer = Buffer;
}

// `@meteora-ag/dlmm` / `@coral-xyz/anchor` read `process.env` at eval time. The
// Vite inject pass covers module-top-level references, but a minimal runtime
// `process` shim guards any lazy `globalThis.process.env` lookup too (the dev
// server's prebundled deps otherwise throw `process is not defined`).
if (!g.process) {
	g.process = { env: {} };
}
