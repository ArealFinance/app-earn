/**
 * Meteora DLMM pool helpers — the live earn-RWT / USDC market.
 *
 * The pool is a Meteora Dynamic Liquidity Market Maker (DLMM) "LB pair". The
 * on-chain DLMM program ID is identical on devnet and mainnet, so the SAME code
 * ships to both — only `CLUSTER` (in `./config`) differs.
 *
 * Token orientation (see config):
 *   tokenX = USDC (6 dec)  — quote leg
 *   tokenY = RWT  (6 dec)  — base leg
 *
 * A RWT → USDC **sell** is a Y → X swap, i.e. `swapForY = false`. The active
 * bin's price is X-per-Y = USDC per RWT, which is the market price we surface.
 *
 * Reads (price + quote) need no wallet — `DLMM.create` builds a read-only
 * anchor program from just the connection. The sell transaction returned by
 * `buildSellRwtTx` is unsigned; the wallet store's `send` fn signs + submits it.
 */

import { PublicKey, Transaction } from '@solana/web3.js';
// The client bundle resolves `@coral-xyz/anchor` to its browser ESM build
// (dist/browser/index.js), which exposes ONLY named exports (no default) — so
// the named `{ BN }` import is the correct (and only working) form here. This
// app is SPA-only (`ssr = false`), so the stricter Node/SSR CJS-interop path
// that would prefer a default import is never exercised.
import { BN } from '@coral-xyz/anchor';
import DLMM from '@meteora-ag/dlmm';
import {
	connection,
	COMMITMENT,
	CLUSTER,
	METEORA_POOL,
	METEORA_TOKEN_X,
	METEORA_TOKEN_Y,
	TOKEN_DECIMALS,
	DEFAULT_SLIPPAGE_BPS
} from './config';
import type { SendFn } from './tx';

// ── Pool handle (cached) ──────────────────────────────────────────────────────

/**
 * `DLMM.create` fetches pool + bin-array state and is non-trivial, so we cache
 * the handle. The handle exposes a `refetchStates()` for fresh reads; we call
 * it before quoting/swapping so a price read isn't stale.
 */
let poolPromise: Promise<DLMM> | null = null;

async function getPool(): Promise<DLMM> {
	if (!poolPromise) {
		poolPromise = DLMM.create(connection, METEORA_POOL, { cluster: CLUSTER }).catch((err) => {
			// Reset on failure so the next call retries instead of caching a reject.
			poolPromise = null;
			throw err;
		});
	}
	return poolPromise;
}

// ── Scaling helpers ────────────────────────────────────────────────────────────

/** UI token amount → base units (u64) as a BN. Rounds away float dust. */
function toBaseUnitsBN(uiAmount: number): BN {
	return new BN(Math.round(uiAmount * 10 ** TOKEN_DECIMALS));
}

/** Base units (BN) → UI token amount (number). */
function fromBaseUnits(base: BN): number {
	return Number(base.toString()) / 10 ** TOKEN_DECIMALS;
}

// ── Market price (USDC per RWT) ─────────────────────────────────────────────────

/**
 * Current market price of RWT in USDC, read from the pool's active bin.
 *
 * IMPORTANT orientation note (verified against live execution):
 * `getActiveBin().pricePerToken` for THIS pool is the decimal price of tokenX
 * (USDC) expressed in tokenY (RWT) — i.e. RWT-per-USDC (~1.0356), the INVERSE
 * of what we want. Cross-checked both ways: selling 100 RWT yields ~96 USDC and
 * buying RWT with 100 USDC yields ~103 RWT, both implying ~$0.9657 per RWT =
 * 1 / pricePerToken. So the USDC-per-RWT market price is `1 / pricePerToken`.
 *
 * Returns `null` if the pool can't be read (keeps the UI's "—" placeholder
 * honest rather than crashing).
 */
export async function fetchMarketPrice(): Promise<number | null> {
	try {
		const pool = await getPool();
		await pool.refetchStates();
		const activeBin = await pool.getActiveBin();
		const rwtPerUsdc = Number(activeBin.pricePerToken);
		if (!Number.isFinite(rwtPerUsdc) || rwtPerUsdc <= 0) return null;
		const usdcPerRwt = 1 / rwtPerUsdc; // invert to USDC-per-RWT
		return Number.isFinite(usdcPerRwt) && usdcPerRwt > 0 ? usdcPerRwt : null;
	} catch {
		return null;
	}
}

// ── Sell quote (RWT → USDC) ─────────────────────────────────────────────────────

export interface SellQuote {
	/** USDC received (UI units). */
	usdcOut: number;
	/** Price impact in basis points. */
	priceImpactBps: number;
	/** Swap fee charged, in USDC (UI units). */
	feeUsdc: number;
	/** Minimum USDC out after slippage (UI units) — the floor sent on-chain. */
	minOut: number;
	/** Effective price (USDC per RWT) implied by the quote. */
	effectivePrice: number;
}

/**
 * Quotes a RWT → USDC sell against the live pool (Y → X, `swapForY = false`).
 *
 * `pool.swapQuote(inAmount, swapForY, allowedSlippage, binArrays)` returns the
 * out amount, fee, price impact (a `Decimal`), and the slippage-adjusted
 * minimum. The DLMM fee is charged on the IN leg (RWT) for a Y→X swap; we
 * convert it to USDC at the effective price for display.
 */
export async function quoteSellRwt(
	rwtAmount: number,
	slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<SellQuote> {
	const pool = await getPool();
	await pool.refetchStates();

	const inAmount = toBaseUnitsBN(rwtAmount);
	const swapForY = false; // RWT(Y) → USDC(X)
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	const quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);

	const usdcOut = fromBaseUnits(quote.outAmount);
	const minOut = fromBaseUnits(quote.minOutAmount);
	// priceImpact is a Decimal fraction (e.g. 0.0021 = 0.21%).
	const priceImpactBps = Math.round(Number(quote.priceImpact.toString()) * 10_000);
	const effectivePrice = rwtAmount > 0 ? usdcOut / rwtAmount : 0;
	// Fee is denominated in the IN token (RWT) for a Y→X swap → value it in USDC.
	const feeRwt = fromBaseUnits(quote.fee);
	const feeUsdc = feeRwt * effectivePrice;

	return { usdcOut, priceImpactBps, feeUsdc, minOut, effectivePrice };
}

// ── Sell transaction (RWT → USDC) ────────────────────────────────────────────────

/**
 * Builds the RWT → USDC sell transaction. The amounts and `minOutAmount` are
 * derived from a fresh quote at `slippageBps`, so the on-chain floor matches
 * what the UI previewed. The returned tx is unsigned — `send` (from the wallet
 * store) finalizes the blockhash, signs, and submits it.
 */
export async function buildSellRwtTx(
	user: PublicKey,
	rwtAmount: number,
	send: SendFn,
	slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<string> {
	const pool = await getPool();
	await pool.refetchStates();

	const inAmount = toBaseUnitsBN(rwtAmount);
	const swapForY = false; // RWT(Y) → USDC(X)
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	const quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);

	const swapTx: Transaction = await pool.swap({
		inToken: METEORA_TOKEN_Y, // RWT in
		outToken: METEORA_TOKEN_X, // USDC out
		inAmount,
		minOutAmount: quote.minOutAmount,
		lbPair: pool.pubkey,
		user,
		binArraysPubkey: quote.binArraysPubkey
	});

	// The SDK builds the instructions but may not pin a fresh blockhash/fee
	// payer. The wallet store's `send` reads `recentBlockhash` +
	// `lastValidBlockHeight` to confirm, so guarantee they're set here.
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT);
	swapTx.recentBlockhash = blockhash;
	swapTx.lastValidBlockHeight = lastValidBlockHeight;
	swapTx.feePayer = user;

	return send(swapTx);
}

// ── Buy quote (USDC → RWT) ──────────────────────────────────────────────────────

export interface BuyQuote {
	/** RWT received (UI units). */
	rwtOut: number;
	/** Price impact in basis points. */
	priceImpactBps: number;
	/** Swap fee charged, in USDC (UI units). */
	feeUsdc: number;
	/** Minimum RWT out after slippage (UI units) — the floor sent on-chain. */
	minOut: number;
	/** Effective price (USDC per RWT) implied by the quote. */
	effectivePrice: number;
}

/**
 * Quotes a USDC → RWT buy against the live pool (X → Y, `swapForY = true`).
 *
 * Mirror of `quoteSellRwt` with the swap direction flipped: USDC (tokenX) is the
 * IN leg, RWT (tokenY) is the OUT leg.
 *
 * Unlike the sell quote, the DLMM fee is charged on the IN leg (USDC) for an
 * X→Y swap, so `feeUsdc = fromBaseUnits(quote.fee)` directly — NO multiply by
 * price (the fee is already denominated in USDC).
 */
export async function quoteBuyRwt(
	usdcAmount: number,
	slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<BuyQuote> {
	const pool = await getPool();
	await pool.refetchStates();

	const inAmount = toBaseUnitsBN(usdcAmount);
	const swapForY = true; // USDC(X) → RWT(Y)
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	const quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);

	const rwtOut = fromBaseUnits(quote.outAmount);
	const minOut = fromBaseUnits(quote.minOutAmount);
	// priceImpact is a Decimal fraction (e.g. 0.0021 = 0.21%).
	const priceImpactBps = Math.round(Number(quote.priceImpact.toString()) * 10_000);
	// Effective price is USDC per RWT (usdcIn / rwtOut) — same orientation as sell.
	const effectivePrice = rwtOut > 0 ? usdcAmount / rwtOut : 0;
	// Fee is denominated in the IN token (USDC) for an X→Y swap → use it directly
	// (this DIFFERS from the sell quote, where the IN token is RWT and the fee is
	// re-valued in USDC at the effective price).
	const feeUsdc = fromBaseUnits(quote.fee);

	return { rwtOut, priceImpactBps, feeUsdc, minOut, effectivePrice };
}

// ── Buy transaction (USDC → RWT) ───────────────────────────────────────────────

/**
 * Builds the USDC → RWT buy transaction. A FRESH quote is fetched here (not the
 * UI's display quote) so the on-chain `minOutAmount` floor matches the pool's
 * current state at submit time. The returned tx is unsigned — `send` (from the
 * wallet store) finalizes the blockhash, signs, and submits it.
 *
 * Out-token ATA: `pool.swap()` calls `getOrCreateATAInstruction` for BOTH the
 * in (USDC) and out (RWT) tokens and prepends idempotent create-ATA
 * instructions when missing, so a faucet-only wallet with no RWT ATA is handled
 * by the SDK — no manual prepend is needed (verified in the installed
 * @meteora-ag/dlmm v1.9.10 `swap()` source).
 */
export async function buildBuyRwtTx(
	user: PublicKey,
	usdcAmount: number,
	send: SendFn,
	slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<string> {
	const pool = await getPool();
	await pool.refetchStates();

	const inAmount = toBaseUnitsBN(usdcAmount);
	const swapForY = true; // USDC(X) → RWT(Y)
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	const quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);

	const swapTx: Transaction = await pool.swap({
		inToken: METEORA_TOKEN_X, // USDC in
		outToken: METEORA_TOKEN_Y, // RWT out
		inAmount,
		minOutAmount: quote.minOutAmount,
		lbPair: pool.pubkey,
		user,
		binArraysPubkey: quote.binArraysPubkey
	});

	// The SDK builds the instructions but may not pin a fresh blockhash/fee
	// payer. The wallet store's `send` reads `recentBlockhash` +
	// `lastValidBlockHeight` to confirm, so guarantee they're set here.
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT);
	swapTx.recentBlockhash = blockhash;
	swapTx.lastValidBlockHeight = lastValidBlockHeight;
	swapTx.feePayer = user;

	return send(swapTx);
}

export { COMMITMENT as METEORA_COMMITMENT };
