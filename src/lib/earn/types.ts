/**
 * Shared types for the earn product layer.
 *
 * When the real contracts are wired in (Phase 4), only the *values* produced by
 * `mock.ts` should change — these interfaces stay stable. `mock.ts` is the single
 * swap-out point: every `MOCK_*` constant / `mock*()` helper becomes an on-chain
 * (or backend) read returning the same shape.
 */

/** A single point on the portfolio-value sparkline. */
export interface PortfolioPoint {
	/** ISO timestamp for the data point. */
	t: string;
	/** Total portfolio value (USD) at that moment. */
	value: number;
}

/** Period selector for the portfolio growth toggle. */
export type Period = 'day' | 'week' | 'month';

/** Public, wallet-agnostic protocol stats (shown pre-connect). */
export interface PublicStats {
	/** Book NAV price per RWT (USD). */
	bookNav: number;
	/** Market (DEX) price per RWT (USD). */
	marketPrice: number;
	/** Current stRWT → RWT exchange rate. */
	strwtRate: number;
	/** Historical staking APY (fraction, e.g. 0.142). */
	stakingApy: number;
	/** Total value locked across the basket (USD). */
	tvl: number;
}

/** A pending unstake ticket (21-day cooldown). */
export interface PendingUnstake {
	/** Stable id for keyed rendering. */
	id: string;
	/** RWT fixed at initiation (does not earn during cooldown). */
	amountRwt: number;
	/** Unix ms timestamp when the RWT becomes claimable. */
	unlockTs: number;
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

/** One leg of a Buy quote (mint or DEX). */
export interface BuyPath {
	/** RWT the user receives on this path. */
	rwtOut: number;
	/** Effective price per RWT (USD). */
	price: number;
	/** Cost in USDC paid on this path (body + fee/slippage). */
	totalUsdc: number;
}

/** Buy quote — compares the mint path against the DEX path. */
export interface BuyQuote {
	/** Mint path: Book NAV × (1 + fee). */
	mintPath: BuyPath & { fee: number };
	/** DEX path: market price + slippage. */
	dexPath: BuyPath & { slippage: number };
	/** Which path is cheaper for the user (more RWT out). */
	cheaper: 'mint' | 'dex';
}

/** Sell quote — DEX only (no on-chain redeem). */
export interface SellQuote {
	/** USDC the user receives after slippage + fee. */
	usdcOut: number;
	/** Effective DEX price per RWT (USD). */
	price: number;
	/** Slippage applied (fraction). */
	slippage: number;
	/** True when market price is below Book NAV (selling below book value). */
	belowBookNav: boolean;
}

/** Stake quote — RWT → stRWT at the current rate. */
export interface StakeQuote {
	/** stRWT minted = RWT / rate. */
	strwtOut: number;
	/** Rate used (stRWT → RWT). */
	rateUsed: number;
	/** Projected APY (fraction) — historical, not a guarantee. */
	projectedApy: number;
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
