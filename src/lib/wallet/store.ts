/**
 * Wallet store — pure Svelte writable (not a rune) so it can be consumed
 * from `.ts` files and `.svelte` components alike via `$wallet`.
 *
 * Phase 4.2d: balances + positions are now REAL on-chain reads against the
 * live devnet `earn` + `staking` programs (see `$lib/chain/reads`). The action
 * helpers build + submit REAL transactions via the connected provider
 * (`$lib/chain/tx`). Only the genuinely-unavailable bits (APY history, market
 * price, portfolio history) remain mocked in `$lib/earn/mock`.
 */

import { writable, get } from 'svelte/store';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
	connect as providerConnect,
	disconnect as providerDisconnect,
	type ConnectResult,
	type InjectedWallet,
	type WalletProviderId
} from './providers';
import {
	fetchRwtBalance,
	fetchStrwtBalance,
	fetchUsdcBalance,
	fetchPendingUnstakes
} from '$lib/chain/reads';
import {
	buildMintRwt,
	buildStake,
	buildInitiateUnstake,
	buildCompleteUnstake,
	type SendFn
} from '$lib/chain/tx';
import { buildSellRwtTx, buildBuyRwtTx } from '$lib/chain/meteora';
import { connection, COMMITMENT } from '$lib/chain/config';
import type { PendingUnstake } from '$lib/earn/types';

export interface WalletState {
	connected: boolean;
	connecting: boolean;
	providerId: WalletProviderId | null;
	publicKey: PublicKey | null;
	address: string | null;
	usdc: number;
	/** Liquid RWT (on-chain earn-RWT ATA). */
	rwt: number;
	/** stRWT staking share token (on-chain ATA). */
	strwt: number;
	/** Pending unstake tickets in cooldown (on-chain UnstakeTicket PDAs). */
	pendingUnstakes: PendingUnstake[];
	/** True while balances are being (re)fetched from chain. */
	loading: boolean;
	error: string | null;
}

const INITIAL: WalletState = {
	connected: false,
	connecting: false,
	providerId: null,
	publicKey: null,
	address: null,
	usdc: 0,
	rwt: 0,
	strwt: 0,
	pendingUnstakes: [],
	loading: false,
	error: null
};

/*
 * Persist the provider hint across page reloads so we can do a silent
 * `connect({ onlyIfTrusted: true })` on next boot — without it, reloading the
 * page drops the wallet connection and forces the user to click "Connect" again.
 *
 * NOTE: this is a HINT, not a credential. It only stores the provider id
 * (`'phantom'` / `'solflare'` / `'backpack'`) so we know which wallet API to
 * silently probe; the wallet itself decides whether to grant the connection
 * (via its own per-origin trust list). No keys, addresses, or secrets here.
 */
const PROVIDER_STORAGE_KEY = 'earn:wallet:provider:v1';
const KNOWN_PROVIDERS: WalletProviderId[] = ['phantom', 'solflare', 'backpack'];

function persistProvider(id: WalletProviderId | null): void {
	if (typeof localStorage === 'undefined') return;
	if (id === null) localStorage.removeItem(PROVIDER_STORAGE_KEY);
	else localStorage.setItem(PROVIDER_STORAGE_KEY, id);
}

function readPersistedProvider(): WalletProviderId | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(PROVIDER_STORAGE_KEY);
	return KNOWN_PROVIDERS.includes(raw as WalletProviderId)
		? (raw as WalletProviderId)
		: null;
}

function createWalletStore() {
	const { subscribe, set, update } = writable<WalletState>(INITIAL);

	// Adapter held outside reactive state — a non-plain object reference.
	let adapter: InjectedWallet | null = null;

	/**
	 * Bound send function for the connected adapter. Throws if not connected.
	 *
	 * The wallet is used as a PURE SIGNER (`signTransaction`); we broadcast the
	 * raw bytes via OUR own devnet `Connection`. This mirrors the main app.
	 *
	 * Why not `signAndSendTransaction`? That path uses the extension's OWN RPC,
	 * which Phantom/Solflare pin to mainnet. On devnet it (a) simulates against
	 * mainnet -- a misleading "insufficient SOL" warning -- and (b) broadcasts to
	 * the wrong cluster, so the tx silently disappears. Signing locally then
	 * sending through our cluster-correct connection lands the tx on devnet.
	 * (Phantom may still show its mainnet-simulation warning in the approval
	 * popup -- the user approves anyway; the tx still lands on devnet.)
	 *
	 * The tx builders ($lib/chain/tx, $lib/chain/meteora) set a fresh
	 * `recentBlockhash` + `lastValidBlockHeight` + `feePayer` before calling
	 * this, so `serialize()` and the confirmation below have what they need.
	 */
	const send: SendFn = async (tx: Transaction) => {
		if (!adapter) throw new Error('Wallet not connected');
		const signed = await adapter.signTransaction(tx); // wallet = pure signer
		const signature = await connection.sendRawTransaction(signed.serialize(), {
			skipPreflight: false,
			maxRetries: 3
		});
		// Wait for confirmation so a subsequent balance refresh reflects the tx.
		await connection.confirmTransaction(
			{
				signature,
				blockhash: tx.recentBlockhash!,
				lastValidBlockHeight: tx.lastValidBlockHeight!
			},
			COMMITMENT
		);
		return signature;
	};

	/** Pulls all on-chain balances + tickets for a wallet into the store. */
	async function loadChainState(pubkey: PublicKey): Promise<void> {
		update((s) => ({ ...s, loading: true }));
		try {
			const [usdc, rwt, strwt, pendingUnstakes] = await Promise.all([
				fetchUsdcBalance(pubkey),
				fetchRwtBalance(pubkey),
				fetchStrwtBalance(pubkey),
				fetchPendingUnstakes(pubkey)
			]);
			update((s) =>
				s.connected && s.publicKey?.equals(pubkey)
					? { ...s, usdc, rwt, strwt, pendingUnstakes, loading: false }
					: s
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load balances';
			update((s) => ({ ...s, loading: false, error: message }));
		}
	}

	async function connectWallet(id: WalletProviderId): Promise<void> {
		update((s) => ({ ...s, connecting: true, error: null }));
		try {
			const result: ConnectResult = await providerConnect(id);
			adapter = result.adapter;

			update((s) => ({
				...s,
				connecting: false,
				connected: true,
				providerId: result.id,
				publicKey: result.publicKey,
				address: result.publicKey.toBase58(),
				loading: true,
				error: null
			}));

			// Persist the provider hint so a page reload can silently reconnect
			// via `onlyIfTrusted: true` (see `silentReconnect`). Cleared on
			// explicit disconnect.
			persistProvider(result.id);

			// Chain reads happen after the UI flips to connected — keeps the
			// transition snappy; balances arrive a moment later.
			await loadChainState(result.publicKey);
		} catch (err) {
			adapter = null;
			const message = err instanceof Error ? err.message : 'Connection failed';
			update((s) => ({ ...s, connecting: false, error: message }));
			throw err;
		}
	}

	async function disconnectWallet(): Promise<void> {
		await providerDisconnect(adapter);
		adapter = null;
		set(INITIAL);
		// Drop the silent-reconnect hint so a future page load lands on a clean
		// "Connect" CTA instead of re-trusting the provider the user walked away from.
		persistProvider(null);
	}

	/*
	 * Silent auto-reconnect on boot.
	 *
	 * Wallet extensions remember per-origin trust — if the user already approved
	 * this origin in a previous session, `connect({ onlyIfTrusted: true })`
	 * resolves WITHOUT prompting. Without this, every page reload resets the
	 * store to INITIAL and the header drops back to "Connect".
	 *
	 * Strictly best-effort: any failure (extension uninstalled, user revoked
	 * trust, racing with an explicit connect) silently falls back to the
	 * disconnected state — no error toast — and clears the stale hint so we
	 * don't keep re-attempting on every reload.
	 */
	async function silentReconnect(): Promise<void> {
		const persisted = readPersistedProvider();
		if (!persisted) return;

		// Race guard: don't fire if the user already kicked off an explicit
		// connect (or we're somehow already connected).
		const current = get({ subscribe });
		if (current.connected || current.connecting) return;

		try {
			const result: ConnectResult = await providerConnect(persisted, { onlyIfTrusted: true });

			// Re-check the race guard before committing — an explicit user-initiated
			// connect may have won while we awaited the provider. If so, it owns the
			// adapter + state; back off without clobbering it.
			const after = get({ subscribe });
			if (after.connected || after.connecting) return;

			// Re-establish the module-level adapter reference so subsequent tx
			// signing (`send`) works after a reload — same as the explicit path.
			adapter = result.adapter;

			update((s) => ({
				...s,
				connecting: false,
				connected: true,
				providerId: result.id,
				publicKey: result.publicKey,
				address: result.publicKey.toBase58(),
				loading: true,
				error: null
			}));

			// Populate balances just like the explicit connect path.
			await loadChainState(result.publicKey);
		} catch {
			// Not trusted, extension gone, or a silent race — drop the stale hint
			// so we stop re-attempting on every reload.
			adapter = null;
			persistProvider(null);
		}
	}

	/** Refresh all on-chain balances + tickets for the connected wallet. */
	async function refreshBalances(): Promise<void> {
		const current = get({ subscribe });
		if (!current.publicKey) return;
		await loadChainState(current.publicKey);
	}

	function requirePubkey(): PublicKey {
		const current = get({ subscribe });
		if (!current.publicKey) throw new Error('Wallet not connected');
		return current.publicKey;
	}

	// ── Real on-chain action helpers ─────────────────────────────────────────
	// Each builds + submits a transaction, then refreshes balances from chain.

	/** Mint RWT by depositing USDC at Book NAV (+1% fee). Returns the signature. */
	async function mintRwt(usdcAmount: number): Promise<string> {
		const sig = await buildMintRwt(requirePubkey(), usdcAmount, send);
		await refreshBalances();
		return sig;
	}

	/**
	 * Sell RWT to USDC against the live Meteora DLMM pool. `slippageBps` floors
	 * the on-chain min-out. Returns the signature, then refreshes balances.
	 */
	async function sellRwt(rwtAmount: number, slippageBps?: number): Promise<string> {
		const sig = await buildSellRwtTx(requirePubkey(), rwtAmount, send, slippageBps);
		await refreshBalances();
		return sig;
	}

	/**
	 * Buy RWT with USDC against the live Meteora DLMM pool. `slippageBps` floors
	 * the on-chain min-out. Returns the signature, then refreshes balances.
	 */
	async function buyRwt(usdcAmount: number, slippageBps?: number): Promise<string> {
		const sig = await buildBuyRwtTx(requirePubkey(), usdcAmount, send, slippageBps);
		await refreshBalances();
		return sig;
	}

	/** Stake RWT → stRWT at the current rate. Returns the signature. */
	async function stakeRwt(rwtAmount: number): Promise<string> {
		const sig = await buildStake(requirePubkey(), rwtAmount, send);
		await refreshBalances();
		return sig;
	}

	/** Initiate unstake (burn stRWT, start 21-day cooldown). Returns the signature. */
	async function initiateUnstake(strwtAmount: number): Promise<string> {
		const { signature } = await buildInitiateUnstake(requirePubkey(), strwtAmount, send);
		await refreshBalances();
		return signature;
	}

	/** Complete a matured unstake ticket. `nonce` is the ticket's u64 (string). */
	async function completeUnstake(nonce: string): Promise<string> {
		const sig = await buildCompleteUnstake(requirePubkey(), nonce, send);
		await refreshBalances();
		return sig;
	}

	return {
		subscribe,
		connect: connectWallet,
		disconnect: disconnectWallet,
		silentReconnect,
		refreshBalances,
		mintRwt,
		stakeRwt,
		sellRwt,
		buyRwt,
		initiateUnstake,
		completeUnstake
	};
}

export const wallet = createWalletStore();

// Attempt a silent reconnect once on boot (best-effort; never prompts).
if (typeof window !== 'undefined') {
	void wallet.silentReconnect();
}
