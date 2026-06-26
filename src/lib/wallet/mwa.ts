/**
 * Mobile Wallet Adapter (MWA) backend — the native-Android signing path for the
 * Solana Seeker / dApp Store build.
 *
 * On a device, there are no injected `window.solana` providers; instead the OS
 * brokers signing via the Mobile Wallet Adapter protocol. Tapping "Connect"
 * dispatches a `solana-wallet://` association intent and the OS shows a wallet
 * Chooser (Seed Vault Wallet / Phantom / Solflare). The selected wallet performs
 * authorization + signing and returns over the MWA session.
 *
 * This module adapts `@solana-mobile/wallet-adapter-mobile` to the SAME shapes
 * the browser path uses (`InjectedWallet` + `ConnectResult` from `./providers`),
 * so the wallet store and all components stay byte-for-byte identical across
 * web and native — the only divergence is which backend `getWalletBackend()`
 * returns (see `./backend`).
 *
 * TODO(seeker): every connect/sign path here REQUIRES on-device validation with
 * an MWA-capable wallet installed (emulator + fakewallet, or a Seeker). It cannot
 * be exercised in the web build or in CI without the Android runtime + a wallet.
 */

import type { PublicKey, Transaction } from '@solana/web3.js';
import {
	SolanaMobileWalletAdapter,
	createDefaultAddressSelector,
	createDefaultAuthorizationResultCache,
	createDefaultWalletNotFoundHandler
} from '@solana-mobile/wallet-adapter-mobile';
import type { InjectedWallet, ConnectResult } from './providers';
import { IS_DEVNET, NETWORK } from '$lib/chain/config';

/**
 * MWA chain — DERIVED from the app's active cluster, never hardcoded.
 *
 * The MWA authorization chain MUST match the cluster the rest of the app reads
 * and writes against (`$lib/chain/config`, selected by `VITE_NETWORK`). If they
 * diverge, the wallet authorizes/submits on one cluster while our `Connection`
 * confirms on another — txs silently vanish, or worse, a devnet-intended action
 * gets signed against mainnet. So we map our `NETWORK` directly onto the MWA 2.0
 * chain identifier.
 *
 * For the dApp-Store binary the build is forced to mainnet via the
 * `VITE_NETWORK=mainnet` prefix on the `cap:sync`/`cap:copy` scripts, so the
 * shipped APK can never resolve to devnet here.
 */
const MWA_CHAIN: `solana:${'devnet' | 'mainnet'}` = IS_DEVNET
	? 'solana:devnet'
	: 'solana:mainnet';

/**
 * Fail-closed guard: the MWA chain we authorize against MUST agree with the
 * app's active cluster. This can only ever fire if someone edits the mapping
 * above out of sync with `$lib/chain/config`; it converts that latent
 * cross-cluster bug into a loud, immediate throw instead of a silent
 * wrong-cluster submission. Invoked when the adapter is constructed.
 */
function assertChainMatchesCluster(): void {
	// NETWORK is 'devnet' | 'mainnet'; MWA_CHAIN is 'solana:<that>'.
	const expected = `solana:${NETWORK === 'mainnet' ? 'mainnet' : 'devnet'}`;
	if (MWA_CHAIN !== expected) {
		throw new Error(
			`MWA chain/cluster mismatch: MWA chain is "${MWA_CHAIN}" but app cluster is ` +
				`"${NETWORK}" (expected "${expected}"). Refusing to connect to avoid ` +
				`signing on the wrong cluster.`
		);
	}
}

/**
 * App identity shown in the wallet's authorization prompt. `uri` is the app's
 * production web origin (the app-earn deploy at earn.areal.finance — also the
 * dApp-Store listing origin); `name` is the display name in the Chooser/approval
 * UI; `icon` is root-absolute so the wallet resolves it under `uri`.
 */
const APP_IDENTITY = {
	name: 'Areal',
	uri: 'https://earn.areal.finance',
	icon: '/favicon-dark.svg'
} as const;

/**
 * Lazily-constructed singleton adapter. Built on first connect (inside a user
 * gesture — see the gesture note in `./backend`), reused thereafter so the
 * authorization cache + active session survive across actions.
 */
let mwaAdapter: SolanaMobileWalletAdapter | null = null;

function getMwaAdapter(): SolanaMobileWalletAdapter {
	if (mwaAdapter) return mwaAdapter;
	// Fail closed before we ever associate with a wallet: the MWA chain must
	// match the app's active cluster (see assertChainMatchesCluster).
	assertChainMatchesCluster();
	mwaAdapter = new SolanaMobileWalletAdapter({
		addressSelector: createDefaultAddressSelector(),
		appIdentity: APP_IDENTITY,
		authorizationResultCache: createDefaultAuthorizationResultCache(),
		chain: MWA_CHAIN,
		onWalletNotFound: createDefaultWalletNotFoundHandler()
	});
	return mwaAdapter;
}

/**
 * Wraps the live MWA adapter as an `InjectedWallet`, so the wallet store's
 * `send`/disconnect logic treats it exactly like a browser provider.
 *
 * Signing semantics:
 *   - `signTransaction` — sign ONLY (no broadcast). Kept for parity with the
 *     browser path; the store may still broadcast via its own `Connection`.
 *   - `signAndSendTransaction` — PREFERRED on native. MWA's `sendTransaction`
 *     does an atomic `sign_and_send_transaction` request through the wallet,
 *     which submits to the wallet's RPC for the authorized chain (mainnet). On a
 *     real device this is the canonical on-chain path; the store branches to it
 *     for the native backend (see `./backend` → `prefersSignAndSend`).
 */
function asInjected(adapter: SolanaMobileWalletAdapter): InjectedWallet {
	return {
		get publicKey(): PublicKey | null {
			return adapter.publicKey;
		},
		connect: async () => {
			// MWA's `connect()` performs association + authorization and resolves
			// once `publicKey` is populated. The OS Chooser is shown here, which is
			// why this MUST be reached from within a user-gesture handler.
			//
			// NOTE: `onlyIfTrusted` (silent reconnect) has no MWA analogue — there
			// is no non-interactive re-auth without a fresh intent. The store's
			// silent-reconnect path is therefore skipped on native (see `./backend`).
			await adapter.connect();
			if (!adapter.publicKey) {
				throw new Error('Mobile Wallet Adapter returned no public key');
			}
			return { publicKey: adapter.publicKey };
		},
		disconnect: () => adapter.disconnect(),
		signTransaction: (tx: Transaction) => adapter.signTransaction(tx),
		signAndSendTransaction: async (_tx: Transaction): Promise<string> => {
			// Intentionally not implemented here as a bare signer — MWA's
			// sign-and-send needs the app's `Connection` (it submits via the wallet
			// for the authorized chain). The store passes the connection through its
			// `send` seam, so the native send path lives in `./backend`
			// (`sendViaMwa`) where the `Connection` is available. This method exists
			// only to satisfy the `InjectedWallet` contract; the store does not call
			// it on the native path.
			throw new Error(
				'signAndSendTransaction is routed through the backend send seam on native'
			);
		}
	};
}

/**
 * Native connect — mirrors `providers.connect()` but over MWA. Returns a
 * `ConnectResult` so the store consumes it identically to the browser path.
 *
 * `id` is the honest `'mwa'` identity (not a fake browser provider): the
 * concrete wallet behind MWA is chosen by the OS Chooser, so there is one opaque
 * id for the whole native path. The store skips persistence for the `'mwa'`
 * backend (no silent reconnect on native), so this id is never written to
 * localStorage as a reconnect hint.
 */
export async function connectMwa(): Promise<ConnectResult> {
	const adapter = getMwaAdapter();
	const injected = asInjected(adapter);
	const { publicKey } = await injected.connect();
	return { id: 'mwa', publicKey, adapter: injected };
}

/** Best-effort native disconnect — never throws. */
export async function disconnectMwa(): Promise<void> {
	if (!mwaAdapter) return;
	try {
		await mwaAdapter.disconnect();
	} catch {
		// Session may already be gone; ignore.
	}
}

/**
 * Native send: sign + submit via MWA in a single `sign_and_send_transaction`
 * request. Returns the transaction signature.
 *
 * This is the PREFERRED on-chain path on device (vs. the browser path's
 * "sign locally, broadcast via our Connection"): the wallet submits to its own
 * RPC for the authorized chain, so there is no separate broadcast step and the
 * approval UI shows the real, final transaction.
 *
 * TODO(seeker): validate on device that `sendTransaction` lands the tx on
 * mainnet and that confirmation can be polled via the app's `Connection`
 * (the wallet returns the signature; confirmation is the app's responsibility).
 */
export async function sendViaMwa(
	tx: Transaction,
	connection: import('@solana/web3.js').Connection
): Promise<string> {
	const adapter = getMwaAdapter();
	if (!adapter.connected) {
		throw new Error('Mobile Wallet Adapter not connected');
	}
	// MWA `sendTransaction` = atomic sign_and_send_transaction through the wallet.
	return adapter.sendTransaction(tx, connection);
}
