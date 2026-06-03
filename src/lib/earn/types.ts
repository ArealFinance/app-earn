/**
 * Shared types for the earn product layer.
 *
 * Real values now flow from `$lib/chain/` (on-chain reads + `GET /earn/stats`);
 * `mock.ts` keeps only the pure preview math the modals run over those inputs.
 * The portfolio sparkline is built as a plain `number[]` from the real stats
 * time-series (see `$lib/earn/derive`).
 */

/** Period selector for the portfolio growth toggle. */
export type Period = 'day' | 'week' | 'month';

/** Public, wallet-agnostic protocol stats (shown pre-connect). */
export interface PublicStats {
	/** Book NAV price per RWT (USD) — real on-chain read. */
	bookNav: number;
	/** Market (DEX) price per RWT (USD), or null when no DEX pool exists. */
	marketPrice: number | null;
	/** Current stRWT → RWT exchange rate — real on-chain read. */
	strwtRate: number;
	/**
	 * Real staking APY (fraction) from `GET /earn/stats`, or `null` while the
	 * rate history is still shorter than the window ("accumulating data…").
	 */
	stakingApy: number | null;
	/** Total value locked across the basket (USD) — real on-chain read. */
	tvl: number;
}

/** A pending unstake ticket (21-day cooldown). */
export interface PendingUnstake {
	/** Stable id for keyed rendering (the on-chain ticket PDA, base58). */
	id: string;
	/** RWT fixed at initiation (does not earn during cooldown). */
	amountRwt: number;
	/** Unix ms timestamp when the RWT becomes claimable. */
	unlockTs: number;
	/**
	 * Client-supplied nonce the ticket was created with (decimal string, u64).
	 * Required to build `complete_unstake`. Present for on-chain tickets; may be
	 * absent for an optimistic local ticket inserted right after initiate.
	 */
	nonce?: string;
}

/** The full per-wallet position snapshot. */
export interface Positions {
	/** Liquid RWT held in the wallet. */
	rwt: number;
	/** stRWT (staking share token) held. */
	strwt: number;
	/** Pending unstake tickets in cooldown. */
	pendingUnstakes: PendingUnstake[];
}

/** Stake quote — RWT → stRWT at the current rate. */
export interface StakeQuote {
	/** stRWT minted = RWT / rate. */
	strwtOut: number;
	/** Rate used (stRWT → RWT). */
	rateUsed: number;
	/**
	 * Real window APY (fraction) from `GET /earn/stats`, or `null` while history
	 * is still accumulating — in which case no projection is shown.
	 */
	projectedApy: number | null;
}

/** Unstake quote — stRWT → RWT with a 21-day cooldown. */
export interface UnstakeQuote {
	/** RWT fixed at the current rate. */
	rwtOut: number;
	/** Rate used (stRWT → RWT). */
	rateUsed: number;
	/** Unix ms timestamp when the RWT unlocks (now + 21d). */
	unlockTs: number;
}
