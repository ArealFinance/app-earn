/**
 * Direct wallet-provider integration — Phantom / Solflare / Backpack.
 *
 * We intentionally do NOT use `@solana/wallet-adapter-*` here. The earn
 * surface only needs three providers and a single `connect()` call; a full
 * adapter brings React and a multi-MB dependency tree.
 *
 * The injected providers expose almost-identical shapes:
 *   - `connect()` returns `{ publicKey: PublicKey }` (or an object exposing it)
 *   - `disconnect()` returns void
 *   - `publicKey` is available after a successful connect
 *
 * We narrow each shape just enough to compile.
 */

import type { PublicKey, Transaction } from '@solana/web3.js';

export type WalletProviderId = 'phantom' | 'solflare' | 'backpack';

export interface WalletProviderInfo {
	id: WalletProviderId;
	name: string;
	installUrl: string;
}

export interface InjectedWallet {
	publicKey?: PublicKey | null;
	connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
	disconnect: () => Promise<void>;
	/**
	 * Sign ONLY — returns the signed transaction without broadcasting. This keeps
	 * the wallet a pure signer; the store then broadcasts the raw bytes via OUR
	 * devnet `Connection`. Critical on devnet: the wallet's own
	 * `signAndSendTransaction` uses the extension's RPC (pinned to mainnet),
	 * which simulates against mainnet (misleading "insufficient SOL") and
	 * broadcasts to the wrong cluster. All three target providers expose
	 * `signTransaction(tx): Promise<Transaction>`.
	 */
	signTransaction: (tx: Transaction) => Promise<Transaction>;
	/**
	 * Sign + submit a transaction, returning its signature. All three target
	 * providers expose `signAndSendTransaction`; we normalise the return to the
	 * base58 signature string. Kept for completeness; the store uses
	 * `signTransaction` instead so broadcasting goes through our own
	 * cluster-correct connection.
	 */
	signAndSendTransaction: (tx: Transaction) => Promise<string>;
}

export interface ConnectResult {
	id: WalletProviderId;
	publicKey: PublicKey;
	adapter: InjectedWallet;
}

/** Common shape of the provider's signAndSendTransaction return. */
type SignAndSendResult = string | { signature: string };

interface PhantomLike {
	isPhantom?: boolean;
	publicKey?: PublicKey | null;
	connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
	disconnect: () => Promise<void>;
	signTransaction: (tx: Transaction) => Promise<Transaction>;
	signAndSendTransaction: (tx: Transaction) => Promise<SignAndSendResult>;
}

interface SolflareLike {
	isSolflare?: boolean;
	publicKey?: PublicKey | null;
	connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<boolean | { publicKey: PublicKey }>;
	disconnect: () => Promise<void>;
	signTransaction: (tx: Transaction) => Promise<Transaction>;
	signAndSendTransaction: (tx: Transaction) => Promise<SignAndSendResult>;
}

interface BackpackLike {
	isBackpack?: boolean;
	publicKey?: PublicKey | null;
	connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
	disconnect: () => Promise<void>;
	signTransaction: (tx: Transaction) => Promise<Transaction>;
	signAndSendTransaction: (tx: Transaction) => Promise<SignAndSendResult>;
}

/** Normalise the various signAndSendTransaction return shapes to a signature. */
function normaliseSignature(result: SignAndSendResult): string {
	return typeof result === 'string' ? result : result.signature;
}

declare global {
	interface Window {
		solana?: PhantomLike;
		solflare?: SolflareLike;
		backpack?: BackpackLike;
	}
}

export const ALL_PROVIDERS: WalletProviderInfo[] = [
	{ id: 'phantom', name: 'Phantom', installUrl: 'https://phantom.app/download' },
	{ id: 'solflare', name: 'Solflare', installUrl: 'https://solflare.com/download' },
	{ id: 'backpack', name: 'Backpack', installUrl: 'https://backpack.app/download' }
];

/** Returns the providers that appear to be installed in this browser. */
export function getAvailableProviders(): WalletProviderInfo[] {
	if (typeof window === 'undefined') return [];
	return ALL_PROVIDERS.filter((p) => isInstalled(p.id));
}

/** Returns ALL providers, with a flag for whether each is installed. */
export function listProviders(): Array<WalletProviderInfo & { installed: boolean }> {
	if (typeof window === 'undefined') {
		return ALL_PROVIDERS.map((p) => ({ ...p, installed: false }));
	}
	return ALL_PROVIDERS.map((p) => ({ ...p, installed: isInstalled(p.id) }));
}

function isInstalled(id: WalletProviderId): boolean {
	if (typeof window === 'undefined') return false;
	switch (id) {
		case 'phantom':
			return Boolean(window.solana?.isPhantom);
		case 'solflare':
			return Boolean(window.solflare?.isSolflare);
		case 'backpack':
			return Boolean(window.backpack?.isBackpack);
	}
}

function getInjected(id: WalletProviderId): InjectedWallet | null {
	if (typeof window === 'undefined') return null;
	switch (id) {
		case 'phantom':
			return window.solana
				? {
						publicKey: window.solana.publicKey ?? null,
						connect: (opts) => window.solana!.connect(opts),
						disconnect: () => window.solana!.disconnect(),
						signTransaction: (tx) => window.solana!.signTransaction(tx),
						signAndSendTransaction: async (tx) =>
							normaliseSignature(await window.solana!.signAndSendTransaction(tx))
					}
				: null;
		case 'solflare':
			return window.solflare
				? {
						publicKey: window.solflare.publicKey ?? null,
						connect: async (opts) => {
							const r = await window.solflare!.connect(opts);
							// Solflare may return `true` on success rather than the publicKey;
							// fall back to reading `publicKey` off the injected provider.
							if (r && typeof r === 'object' && 'publicKey' in r) {
								return { publicKey: (r as { publicKey: PublicKey }).publicKey };
							}
							if (!window.solflare!.publicKey) {
								throw new Error('Solflare did not return a publicKey');
							}
							return { publicKey: window.solflare!.publicKey };
						},
						disconnect: () => window.solflare!.disconnect(),
						signTransaction: (tx) => window.solflare!.signTransaction(tx),
						signAndSendTransaction: async (tx) =>
							normaliseSignature(await window.solflare!.signAndSendTransaction(tx))
					}
				: null;
		case 'backpack':
			return window.backpack
				? {
						publicKey: window.backpack.publicKey ?? null,
						connect: (opts) => window.backpack!.connect(opts),
						disconnect: () => window.backpack!.disconnect(),
						signTransaction: (tx) => window.backpack!.signTransaction(tx),
						signAndSendTransaction: async (tx) =>
							normaliseSignature(await window.backpack!.signAndSendTransaction(tx))
					}
				: null;
	}
}

/**
 * Triggers the provider's connect prompt. Throws if not installed or rejected.
 *
 * Pass `{ onlyIfTrusted: true }` for a silent reconnect — the wallet extension
 * resolves WITHOUT a prompt if the origin is already in its per-origin trust
 * list, and rejects otherwise. Used by the store's `silentReconnect` on boot.
 */
export async function connect(
	id: WalletProviderId,
	opts?: { onlyIfTrusted?: boolean }
): Promise<ConnectResult> {
	const adapter = getInjected(id);
	if (!adapter) {
		throw new Error(`${id} wallet is not installed`);
	}
	const { publicKey } = await adapter.connect(opts);
	return { id, publicKey, adapter };
}

/** Best-effort disconnect — never throws. */
export async function disconnect(adapter: InjectedWallet | null): Promise<void> {
	if (!adapter) return;
	try {
		await adapter.disconnect();
	} catch {
		// Some providers throw if already disconnected; ignore.
	}
}
