/**
 * Mock data layer for the earn product — the SINGLE swap-out point.
 *
 * Every number the UI shows originates here. The "Demo data" badge on the page
 * makes that explicit. When the real earn + staking programs ship (Phase 4),
 * replace each `MOCK_*` constant / `mock*()` helper with an on-chain (or backend)
 * read; the return shapes in `./types.ts` stay identical so components don't change.
 *
 * Determinism: no `Math.random()` at module scope or in per-pubkey helpers — SSR
 * is off in this app, but deterministic mocks keep demos stable across reloads.
 */

import type { PublicKey } from '@solana/web3.js';
import type {
	BuyQuote,
	PendingUnstake,
	PortfolioPoint,
	PublicStats,
	SellQuote,
	StakeQuote,
	UnstakeQuote
} from './types';

// ── Core economic constants ─────────────────────────────────────────────────

/** Book NAV price per RWT (USD). Grows over time from basket income. */
export const MOCK_BOOK_NAV = 9.98;

/**
 * Market (DEX) price per RWT (USD). Sits slightly above Book NAV in the default
 * demo so the Buy modal highlights the DEX-vs-mint decision realistically.
 * Flip `MOCK_MARKET_PRICE` below/above Book NAV to demo the other branch.
 */
export const MOCK_MARKET_PRICE = 10.02;

/** Current stRWT → RWT exchange rate (rises as rewards accrue, never falls). */
export const MOCK_STRWT_RATE = 12.5;

/** Historical staking APY (fraction). Derived from rate growth on-chain; mocked here. */
export const MOCK_STAKING_APY = 0.142;

/** Total value locked across the basket (USD). */
export const MOCK_TVL = 10_042_150.45;

/** Mint protocol commission — 1% on top of the basket body (Book NAV). */
export const MINT_FEE_RATE = 0.01;

/** DEX slippage applied to swaps (buy + sell), flat for the demo. */
export const DEX_SLIPPAGE_RATE = 0.005;

/** DEX swap fee (LP fee), flat for the demo. */
export const DEX_FEE_RATE = 0.003;

/** Unstake cooldown — 21 days, in milliseconds. */
export const COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000;

// ── Public stats (pre-connect) ───────────────────────────────────────────────

/** Wallet-agnostic protocol snapshot shown before the user connects. */
export function mockPublicStats(): PublicStats {
	return {
		bookNav: MOCK_BOOK_NAV,
		marketPrice: MOCK_MARKET_PRICE,
		strwtRate: MOCK_STRWT_RATE,
		stakingApy: MOCK_STAKING_APY,
		tvl: MOCK_TVL
	};
}

// ── Portfolio history (sparkline) ────────────────────────────────────────────

/**
 * Generates a gentle upward-sloping portfolio-value series for the sparkline.
 * Ends at `endValue` (the user's current total) and trends up to it from
 * roughly (1 - growth) of that value, with small deterministic wobble.
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

// ── Per-wallet positions (deterministic, some users zero) ────────────────────

/**
 * Deterministic mock RWT balance keyed off the pubkey's last byte.
 * ~30% of pubkeys map to 0 so State A→B (empty positions) is demoable.
 */
export function mockRwtBalance(pubkey: PublicKey): number {
	const last = pubkey.toBytes()[31];
	if (last < 80) return 0;
	const base = last * 4;
	const wobble = Math.sin(last) * 40;
	return Number((base + wobble).toFixed(6));
}

/**
 * Deterministic mock stRWT balance keyed off the pubkey's second-to-last byte.
 * ~40% of pubkeys map to 0 (staking is opt-in, so more users hold none).
 */
export function mockStrwtBalance(pubkey: PublicKey): number {
	const b = pubkey.toBytes()[30];
	if (b < 100) return 0;
	const base = b / 2;
	const wobble = Math.cos(b) * 8;
	return Number(Math.max(0, base + wobble).toFixed(6));
}

/**
 * Deterministic 0..2 pending unstake tickets keyed off the pubkey's third-to-last
 * byte. Some tickets are already matured (unlock in the past) so the "Claim RWT"
 * path is demoable.
 */
export function mockPendingUnstakes(pubkey: PublicKey): PendingUnstake[] {
	const b = pubkey.toBytes()[29];
	const count = b % 3; // 0, 1, or 2
	const tickets: PendingUnstake[] = [];
	const now = Date.now();
	const dayMs = 24 * 60 * 60 * 1000;

	for (let i = 0; i < count; i += 1) {
		const seed = (b + i * 37) % 100;
		// Ticket 0 leans matured/near-unlock; ticket 1 leans fresh.
		const daysLeft = i === 0 ? (seed % 24) - 3 : 4 + (seed % 18);
		const amountRwt = Number((50 + (seed % 200)).toFixed(6));
		tickets.push({
			id: `${pubkey.toBase58().slice(0, 6)}-${i}`,
			amountRwt,
			unlockTs: now + daysLeft * dayMs
		});
	}

	return tickets;
}

// ── Quotes ───────────────────────────────────────────────────────────────────

/**
 * Buy quote — compares the two acquisition paths and flags the cheaper one.
 *
 *   - Mint: Book NAV × (1 + 1% fee). Cheaper when market ≥ Book NAV.
 *   - DEX:  market price + slippage + LP fee. Cheaper when market < Book NAV.
 *
 * "Cheaper" = more RWT out for the same USDC spend.
 */
export function mockBuyQuote(usdc: number, bookNav: number, market: number): BuyQuote {
	const spend = Math.max(0, Number.isFinite(usdc) ? usdc : 0);

	// Mint: effective price per RWT includes the 1% commission on top of body.
	const mintPrice = bookNav * (1 + MINT_FEE_RATE);
	const mintRwtOut = mintPrice > 0 ? spend / mintPrice : 0;
	const mintBody = mintRwtOut * bookNav;
	const mintFee = mintBody * MINT_FEE_RATE;

	// DEX: effective price includes slippage + LP fee.
	const dexPrice = market * (1 + DEX_SLIPPAGE_RATE + DEX_FEE_RATE);
	const dexRwtOut = dexPrice > 0 ? spend / dexPrice : 0;
	const dexSlippage = spend * DEX_SLIPPAGE_RATE;

	return {
		mintPath: {
			rwtOut: mintRwtOut,
			price: mintPrice,
			totalUsdc: spend,
			fee: mintFee
		},
		dexPath: {
			rwtOut: dexRwtOut,
			price: dexPrice,
			totalUsdc: spend,
			slippage: dexSlippage
		},
		cheaper: mintRwtOut >= dexRwtOut ? 'mint' : 'dex'
	};
}

/**
 * Sell quote — DEX only. Applies slippage + LP fee and flags selling below
 * Book NAV (the deliberate cap-no-floor asymmetry of the earn design).
 */
export function mockSellQuote(rwt: number, market: number, bookNav: number): SellQuote {
	const amount = Math.max(0, Number.isFinite(rwt) ? rwt : 0);
	const effectivePrice = market * (1 - DEX_SLIPPAGE_RATE - DEX_FEE_RATE);
	const usdcOut = amount * effectivePrice;
	const slippage = amount * market * DEX_SLIPPAGE_RATE;

	return {
		usdcOut,
		price: effectivePrice,
		slippage,
		belowBookNav: market < bookNav
	};
}

/** Stake quote — RWT → stRWT at the current rate (stRWT_out = RWT / rate). */
export function mockStakeQuote(rwt: number, rate: number): StakeQuote {
	const amount = Math.max(0, Number.isFinite(rwt) ? rwt : 0);
	const strwtOut = rate > 0 ? amount / rate : 0;
	return {
		strwtOut,
		rateUsed: rate,
		projectedApy: MOCK_STAKING_APY
	};
}

/**
 * Unstake quote — stRWT → RWT at the current rate, with a 21-day cooldown.
 * RWT is fixed at the rate; unlock is now + 21 days.
 */
export function mockUnstakeQuote(strwt: number, rate: number): UnstakeQuote {
	const amount = Math.max(0, Number.isFinite(strwt) ? strwt : 0);
	const rwtOut = amount * rate;
	return {
		rwtOut,
		rateUsed: rate,
		unlockTs: Date.now() + COOLDOWN_MS
	};
}
