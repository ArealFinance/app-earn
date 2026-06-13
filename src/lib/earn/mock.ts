/**
 * Quote-preview math for the modals — pure functions over REAL inputs.
 *
 * Phase 4.2d wired the earn + staking contracts to live devnet; the later
 * stats pass wired APY / earned / portfolio-history to the real `GET /earn/stats`
 * time-series (`$lib/chain/stats` + `$lib/earn/derive`). Nothing in here is a
 * placeholder number any more:
 *
 *   - NAV, stRWT rate, balances, tickets, TVL → `$lib/chain/reads`
 *   - Market price                            → `$lib/chain/meteora` (Meteora DLMM)
 *   - APY / earned / portfolio history        → `$lib/chain/stats` + `$lib/earn/derive`
 *
 * What's left here is the small bit of pure preview arithmetic the buy/stake/
 * unstake sheets run over those REAL on-chain inputs.
 */

import type { StakeQuote, UnstakeQuote } from './types';

// ── On-chain-matching constants (NOT placeholders) ───────────────────────────

/** Unstake cooldown — 21 days, in milliseconds (matches on-chain COOLDOWN_SECONDS). */
export const COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000;

// ── Quote preview helpers (pure math over REAL on-chain inputs) ───────────────
//
// NOTE: the mint preview is NOT here. The mint path needs the SAME integer
// flooring as the contract (`mul_div_u64` / u128 truncation), so its quote lives
// in `$lib/chain/mint-quote` (`quoteMint`) over live integer inputs, shared with
// the transaction builder so the preview equals the on-chain outcome exactly.

/**
 * Stake preview — RWT → stRWT at the REAL on-chain rate (stRWT_out = RWT / rate).
 * `apy` is the REAL window APY from `GET /earn/stats`, or `null` when history is
 * still accumulating (then there's no honest projection to show).
 */
export function stakePreview(rwt: number, rate: number, apy: number | null): StakeQuote {
	const amount = Math.max(0, Number.isFinite(rwt) ? rwt : 0);
	const strwtOut = rate > 0 ? amount / rate : 0;
	return { strwtOut, rateUsed: rate, projectedApy: apy };
}

/**
 * Unstake preview — stRWT → RWT at the REAL on-chain rate, with a 21-day
 * cooldown. RWT is fixed at the rate; unlock is now + 21 days.
 */
export function unstakePreview(strwt: number, rate: number): UnstakeQuote {
	const amount = Math.max(0, Number.isFinite(strwt) ? strwt : 0);
	const rwtOut = amount * rate;
	return { rwtOut, rateUsed: rate, unlockTs: Date.now() + COOLDOWN_MS };
}
