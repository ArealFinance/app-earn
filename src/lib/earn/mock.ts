/**
 * Placeholder data layer — ONLY for figures not yet available on-chain.
 *
 * Phase 4.2d wired the earn + staking contracts to live devnet. Everything
 * backed by a chain read now lives in `$lib/chain/` (NAV, stRWT rate, balances,
 * tickets, TVL) and every action submits a real transaction. What remains here
 * is the genuinely-unavailable stuff:
 *
 *   - Staking APY      — no rate history on-chain yet → static "historical (demo)".
 *   - Portfolio history— no time-series source → a synthetic sparkline series.
 *
 * Market price is now REAL: read from the live Meteora DLMM pool's active bin
 * in `$lib/chain/meteora`. It no longer lives here.
 *
 * The quote helpers below are pure preview math used by the modals; they now
 * take the REAL on-chain NAV / rate as inputs rather than mocked constants.
 */

import type { PortfolioPoint, StakeQuote, UnstakeQuote } from './types';

// ── Placeholder constants (NOT on-chain) ─────────────────────────────────────

/**
 * Historical staking APY (fraction). There is no rate history on-chain yet, so
 * this is a static placeholder — surfaced to the user as "historical (demo)".
 */
export const PLACEHOLDER_STAKING_APY = 0.142;

/** Mint protocol commission — 1% on top of the basket body (matches on-chain). */
export const MINT_FEE_RATE = 0.01;

/** Unstake cooldown — 21 days, in milliseconds (matches on-chain COOLDOWN_SECONDS). */
export const COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000;

// ── Portfolio history (sparkline) — synthetic, no on-chain source ────────────

/**
 * Generates a gentle upward-sloping portfolio-value series for the sparkline.
 * Ends at `endValue` (the user's current total) and trends up to it. There is
 * no on-chain history source, so this is clearly a synthetic/demo curve.
 *
 * @param days     number of points (default 30)
 * @param endValue final/current total portfolio value (USD)
 * @param growth   fractional gain across the window (default 0.083 = +8.3%)
 */
export function generatePortfolioHistory(
	days = 30,
	endValue = 12_480.5,
	growth = 0.083
): PortfolioPoint[] {
	const points: PortfolioPoint[] = [];
	if (endValue <= 0 || days < 2) {
		// Flat series for empty/edge cases so the sparkline still renders a line.
		const now = Date.now();
		const dayMs = 24 * 60 * 60 * 1000;
		for (let i = 0; i < Math.max(2, days); i += 1) {
			points.push({
				t: new Date(now - (days - 1 - i) * dayMs).toISOString(),
				value: endValue
			});
		}
		return points;
	}

	const start = endValue / (1 + growth);
	const now = Date.now();
	const dayMs = 24 * 60 * 60 * 1000;
	const span = endValue - start;

	for (let i = 0; i < days; i += 1) {
		const t = new Date(now - (days - 1 - i) * dayMs);
		const progress = i / (days - 1);
		// Deterministic wobble (~±0.4% of span) so the curve isn't a ruler.
		const wobble = (Math.sin(i * 1.7) * 0.4 + Math.cos(i * 0.7) * 0.2) * (span * 0.05);
		points.push({ t: t.toISOString(), value: start + span * progress + wobble });
	}

	// Pin the final point exactly to the current value.
	points[points.length - 1] = {
		t: new Date(now).toISOString(),
		value: endValue
	};

	return points;
}

// ── Quote preview helpers (pure math over REAL on-chain inputs) ───────────────

/**
 * Mint preview — Book NAV × (1 + 1% fee). `bookNav` is the REAL on-chain NAV.
 * Returns the RWT received and the fee charged (USDC).
 */
export function mintPreview(usdc: number, bookNav: number): {
	rwtOut: number;
	price: number;
	fee: number;
} {
	const spend = Math.max(0, Number.isFinite(usdc) ? usdc : 0);
	const price = bookNav * (1 + MINT_FEE_RATE);
	const rwtOut = price > 0 ? spend / price : 0;
	const body = rwtOut * bookNav;
	const fee = body * MINT_FEE_RATE;
	return { rwtOut, price, fee };
}

/**
 * Stake preview — RWT → stRWT at the REAL on-chain rate (stRWT_out = RWT / rate).
 * `apy` is the historical placeholder.
 */
export function stakePreview(rwt: number, rate: number, apy = PLACEHOLDER_STAKING_APY): StakeQuote {
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
