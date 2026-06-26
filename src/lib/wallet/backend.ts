/**
 * Wallet backend seam — picks the right wallet implementation for the current
 * platform WITHOUT changing the public `wallet` store API or any component.
 *
 *   - Web browser  → the existing injected providers (Phantom / Solflare /
 *                    Backpack) from `./providers`.
 *   - Capacitor native shell (Seeker / dApp Store) → Mobile Wallet Adapter
 *                    (`./mwa`).
 *
 * The store calls `getWalletBackend()` once and routes connect / disconnect /
 * send through the returned object. Both backends expose the SAME shape, so the
 * store's logic (state transitions, balance reads, action helpers) is platform-
 * agnostic. This is the ~5–10% platform layer the Seeker plan isolates.
 */

import type { Connection, Transaction } from '@solana/web3.js';
import { isNativePlatform } from '$lib/platform';
import {
	connect as browserConnect,
	disconnect as browserDisconnect,
	type BrowserProviderId,
	type ConnectResult,
	type InjectedWallet,
	type WalletProviderId
} from './providers';

/** Type guard: is this id one of the injected browser providers (not MWA)? */
function isBrowserProviderId(id: WalletProviderId): id is BrowserProviderId {
	return id === 'phantom' || id === 'solflare' || id === 'backpack';
}

/*
 * Lazy MWA module loader.
 *
 * `./mwa` (and its `@solana-mobile/wallet-adapter-mobile` dependency tree —
 * hundreds of KB) is loaded ONLY via `await import()`, ONLY on the native path.
 * A static import would pull the entire MWA + wallet-standard tree into the
 * eager web bundle even though the browser never uses it. Dynamic import makes
 * the bundler emit MWA as a SEPARATE chunk that the web path never requests; the
 * native shell fetches it on first connect. Memoised so repeated
 * connect/disconnect/send calls share one module instance (and one adapter
 * singleton, which lives inside `./mwa`).
 */
type MwaModule = typeof import('./mwa');
let mwaModulePromise: Promise<MwaModule> | null = null;

function loadMwa(): Promise<MwaModule> {
	if (!mwaModulePromise) {
		mwaModulePromise = import('./mwa');
	}
	return mwaModulePromise;
}

export interface WalletBackend {
	/** `'mwa'` on the native shell, `'browser'` otherwise. */
	readonly kind: 'browser' | 'mwa';
	/**
	 * Whether `connect({ onlyIfTrusted: true })`-style silent reconnect is
	 * supported. Browser providers remember per-origin trust; MWA has no
	 * non-interactive re-auth, so the store skips silent reconnect when false.
	 */
	readonly supportsSilentReconnect: boolean;
	/**
	 * Whether on-chain actions should use the wallet's sign-AND-send (true on
	 * native/MWA) instead of the browser path's "sign locally, broadcast via our
	 * own Connection". When true, the store uses `send` below; when false, the
	 * store keeps using the adapter's `signTransaction` + its own broadcast.
	 */
	readonly prefersSignAndSend: boolean;

	/**
	 * Trigger the connect flow. MUST be called from a user-gesture handler on the
	 * native path (the OS Chooser intent is gesture-gated by the WebView).
	 *
	 * `id` selects the browser provider; it is ignored on the native path, where
	 * the OS Chooser picks the concrete wallet.
	 */
	connect(id: WalletProviderId, opts?: { onlyIfTrusted?: boolean }): Promise<ConnectResult>;

	/** Best-effort disconnect — never throws. */
	disconnect(adapter: InjectedWallet | null): Promise<void>;

	/**
	 * Native sign-and-send. Present only when `prefersSignAndSend` is true.
	 * Submits the transaction via MWA and returns its signature. The browser
	 * backend leaves this undefined (the store signs + broadcasts itself).
	 */
	send?(tx: Transaction, connection: Connection): Promise<string>;
}

const browserBackend: WalletBackend = {
	kind: 'browser',
	supportsSilentReconnect: true,
	prefersSignAndSend: false,
	connect: (id, opts) => {
		// The browser backend only handles injected provider ids. `'mwa'` can never
		// reach here at runtime (it's produced only by the native backend), but we
		// narrow defensively so the call into `providers.connect` is type-safe.
		if (!isBrowserProviderId(id)) {
			throw new Error(`Browser backend cannot connect wallet id "${id}"`);
		}
		return browserConnect(id, opts);
	},
	disconnect: (adapter) => browserDisconnect(adapter)
};

const mwaBackend: WalletBackend = {
	kind: 'mwa',
	// MWA has no silent re-auth — every connect needs a fresh user-gesture intent.
	supportsSilentReconnect: false,
	// On device, prefer the wallet's atomic sign_and_send_transaction.
	prefersSignAndSend: true,
	// Each method lazy-loads `./mwa` (see loadMwa) so the MWA tree stays out of the
	// eager web bundle. `id` / `onlyIfTrusted` are irrelevant on native; the OS
	// Chooser decides. The interface is already async, so this is interface-stable.
	connect: async () => {
		const mwa = await loadMwa();
		return mwa.connectMwa();
	},
	disconnect: async () => {
		const mwa = await loadMwa();
		return mwa.disconnectMwa();
	},
	send: async (tx, connection) => {
		const mwa = await loadMwa();
		return mwa.sendViaMwa(tx, connection);
	}
};

/**
 * Returns the wallet backend for the current platform. Evaluated per call so it
 * always reflects the live platform (cheap — `isNativePlatform()` is a sync
 * bridge check). The result is stable within a session.
 */
export function getWalletBackend(): WalletBackend {
	return isNativePlatform() ? mwaBackend : browserBackend;
}
