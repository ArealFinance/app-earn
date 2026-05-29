/**
 * Wallet store — pure Svelte writable (not a rune) so it can be consumed
 * from `.ts` files (mock data layer, util fns) just as easily as `.svelte`
 * components via `$wallet`.
 *
 * Holds:
 *   - connected pubkey + adapter (so we can disconnect cleanly)
 *   - USDC balance (real, fetched from RPC after connect)
 *   - RWT balance (mocked — would be a real RPC read post-launch)
 */

import { writable, get } from 'svelte/store';
import {
	Connection,
	PublicKey,
	type Commitment
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
	connect as providerConnect,
	disconnect as providerDisconnect,
	type ConnectResult,
	type InjectedWallet,
	type WalletProviderId
} from './providers';
import {
	mockRwtBalance,
	mockStrwtBalance,
	mockPendingUnstakes
} from '$lib/earn/mock';
import type { PendingUnstake } from '$lib/earn/types';

export const RPC_URL = 'https://rpc.areal.finance';
export const COMMITMENT: Commitment = 'confirmed';

// Mainnet USDC mint — matches the value used by the main app.
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export interface WalletState {
	connected: boolean;
	connecting: boolean;
	providerId: WalletProviderId | null;
	publicKey: PublicKey | null;
	address: string | null;
	usdc: number;
	/** Liquid RWT (mocked — would be an on-chain ATA read post-launch). */
	rwt: number;
	/** stRWT staking share token (mocked). */
	strwt: number;
	/** Pending unstake tickets in cooldown (mocked). */
	pendingUnstakes: PendingUnstake[];
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
	error: null
};

function createWalletStore() {
	const { subscribe, set, update } = writable<WalletState>(INITIAL);

	// We hold the adapter outside reactive state — it's an object reference with
	// no serializable identity. Keeping it in the store would force Svelte to
	// diff a non-plain object on every update.
	let adapter: InjectedWallet | null = null;
	const connection = new Connection(RPC_URL, COMMITMENT);

	async function fetchUsdcBalance(pubkey: PublicKey): Promise<number> {
		try {
			const ata = getAssociatedTokenAddressSync(USDC_MINT, pubkey);
			const res = await connection.getTokenAccountBalance(ata, COMMITMENT);
			return res.value.uiAmount ?? 0;
		} catch {
			// No ATA == zero balance. Any RPC error == surface zero, not crash.
			return 0;
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
				rwt: mockRwtBalance(result.publicKey),
				strwt: mockStrwtBalance(result.publicKey),
				pendingUnstakes: mockPendingUnstakes(result.publicKey),
				error: null
			}));

			// Balance fetch happens asynchronously after the UI has flipped to
			// connected — keeps the connect transition snappy.
			const usdc = await fetchUsdcBalance(result.publicKey);
			update((s) => (s.connected ? { ...s, usdc } : s));
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
	}

	async function refreshBalances(): Promise<void> {
		const current = get({ subscribe });
		if (!current.publicKey) return;
		const usdc = await fetchUsdcBalance(current.publicKey);
		update((s) => (s.connected ? { ...s, usdc } : s));
	}

	// ── Mock action helpers ─────────────────────────────────────────────────
	// Local-only simulations for the demo flows. No tx is ever submitted.
	// Post-launch these are replaced by real instruction builders + a
	// balance refresh; the component-facing signatures stay the same.

	/** Buy: spend USDC, receive RWT (mint or DEX — both land as liquid RWT). */
	function mockBuy(usdcSpent: number, rwtReceived: number): void {
		update((s) => ({
			...s,
			usdc: Math.max(0, s.usdc - usdcSpent),
			rwt: s.rwt + rwtReceived
		}));
	}

	/** Sell: burn RWT on the DEX, receive USDC. */
	function mockSell(rwtSold: number, usdcReceived: number): void {
		update((s) => ({
			...s,
			rwt: Math.max(0, s.rwt - rwtSold),
			usdc: s.usdc + usdcReceived
		}));
	}

	/** Stake: lock RWT, receive stRWT. */
	function mockStake(rwtStaked: number, strwtReceived: number): void {
		update((s) => ({
			...s,
			rwt: Math.max(0, s.rwt - rwtStaked),
			strwt: s.strwt + strwtReceived
		}));
	}

	/** Unstake: burn stRWT now, create a cooldown ticket fixed at the rate. */
	function mockUnstake(strwtBurned: number, rwtOut: number, unlockTs: number): void {
		update((s) => ({
			...s,
			strwt: Math.max(0, s.strwt - strwtBurned),
			pendingUnstakes: [
				...s.pendingUnstakes,
				{
					id: `local-${Date.now()}`,
					amountRwt: rwtOut,
					unlockTs
				}
			]
		}));
	}

	/** Claim: a matured ticket releases its reserved RWT back to the wallet. */
	function mockClaimUnstake(ticketId: string): void {
		update((s) => {
			const ticket = s.pendingUnstakes.find((t) => t.id === ticketId);
			if (!ticket) return s;
			return {
				...s,
				rwt: s.rwt + ticket.amountRwt,
				pendingUnstakes: s.pendingUnstakes.filter((t) => t.id !== ticketId)
			};
		});
	}

	return {
		subscribe,
		connect: connectWallet,
		disconnect: disconnectWallet,
		refreshBalances,
		mockBuy,
		mockSell,
		mockStake,
		mockUnstake,
		mockClaimUnstake
	};
}

export const wallet = createWalletStore();
