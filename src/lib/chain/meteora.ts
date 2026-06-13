/**
 * Meteora DLMM pool helpers — the live earn-RWT / USDC market.
 *
 * The pool is a Meteora Dynamic Liquidity Market Maker (DLMM) "LB pair". The
 * on-chain DLMM program ID is identical on devnet and mainnet, so the SAME code
 * ships to both — only `CLUSTER` (in `./config`) differs.
 *
 * TOKEN ORIENTATION IS DERIVED AT RUNTIME, NOT HARDCODED. The two live pools
 * have OPPOSITE token orders:
 *   devnet  pool: tokenX = USDC, tokenY = RWT
 *   mainnet pool: tokenX = RWT,  tokenY = USDC
 * so a fixed `tokenX = USDC` assumption is wrong on mainnet. Instead, after
 * `DLMM.create` we read the pool's ACTUAL mints (`dlmmPool.tokenX.publicKey` /
 * `dlmmPool.tokenY.publicKey`) and compute one boolean `rwtIsX = (tokenX is the
 * RWT mint)`. Everything orientation-sensitive keys off `rwtIsX`:
 *   - Swap direction: in DLMM `swapForY = true` means input X, output Y. A
 *     RWT→USDC **sell** sends the RWT leg in, so `swapForY = rwtIsX`. A
 *     USDC→RWT **buy** is the inverse, `swapForY = !rwtIsX`.
 *   - Price: `getActiveBin().pricePerToken` is Y-per-X (price of tokenX in
 *     tokenY), decimal-adjusted. If `rwtIsX` it is already USDC-per-RWT (no
 *     inversion); if `!rwtIsX` it is RWT-per-USDC and must be inverted (1/p).
 *   - In/out mints for `pool.swap`: chosen from the pool's real tokenX/tokenY.
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
	HAS_METEORA_POOL,
	RWT_MINT,
	TOKEN_DECIMALS,
	DEFAULT_SLIPPAGE_BPS
} from './config';
import type { SendFn } from './tx';

// ── Typed Meteora error ─────────────────────────────────────────────────────────

/**
 * Discriminable Meteora error so the swap UI can branch on a *known* condition
 * instead of stringifying a raw SDK throw. Mirrors the `FaucetError` pattern
 * (a `kind` discriminant the component checks via `instanceof`).
 *
 *   - `insufficient-liquidity` — the SDK's `SWAP_QUOTE_INSUFFICIENT_LIQUIDITY`:
 *     the out side of the swap has nothing to pay out (e.g. the mainnet pool
 *     launches one-sided, 5000 RWT / 0 USDC, so a RWT→USDC sell can't be
 *     filled). This is a LIQUIDITY STATE, not a bug — once USDC liquidity is
 *     added the same quote succeeds with NO code change. The UI surfaces it as a
 *     calm "selling temporarily unavailable" notice, not a hard error.
 *   - `unavailable` — the pool itself can't be reached/used (reserved; e.g. an
 *     unconfigured pool). Surfaced the same calm way.
 */
export type MeteoraErrorKind = 'insufficient-liquidity' | 'unavailable';

export class MeteoraError extends Error {
	readonly kind: MeteoraErrorKind;

	constructor(kind: MeteoraErrorKind, message: string) {
		super(message);
		this.name = 'MeteoraError';
		this.kind = kind;
	}
}

/**
 * Recognizes the DLMM SDK's "nothing to give out" signal. The SDK throws a
 * plain `Error` whose message is the literal string `SWAP_QUOTE_INSUFFICIENT_LIQUIDITY`
 * (it is not a typed/coded error object), so we match on the message text
 * case-insensitively and tolerate any wrapping (`includes`, not `===`). This is
 * the precise condition that fires on the one-sided mainnet pool today.
 */
function isInsufficientLiquidity(err: unknown): boolean {
	const msg =
		err instanceof Error
			? err.message
			: typeof err === 'string'
				? err
				: (() => {
						// Some SDK paths reject with `{ message }`-shaped objects rather
						// than an Error instance — read a `message`/`code` field if present.
						if (err && typeof err === 'object') {
							const o = err as { message?: unknown; code?: unknown };
							if (typeof o.message === 'string') return o.message;
							if (typeof o.code === 'string') return o.code;
						}
						return '';
					})();
	return msg.toUpperCase().includes('SWAP_QUOTE_INSUFFICIENT_LIQUIDITY');
}

// ── Pool handle (cached) ──────────────────────────────────────────────────────

/**
 * `DLMM.create` fetches pool + bin-array state and is non-trivial, so we cache
 * the handle. The handle exposes a `refetchStates()` for fresh reads; we call
 * it before quoting/swapping so a price read isn't stale.
 */
let poolPromise: Promise<DLMM> | null = null;

async function getPool(): Promise<DLMM> {
	// C1: on mainnet pre-launch no RWT/USDC pool exists yet (`VITE_METEORA_POOL`
	// unset → METEORA_POOL is the zero placeholder). Fail fast with a clear
	// reason instead of asking DLMM.create to fetch the all-zero account. Every
	// caller already treats a getPool() rejection as "market unavailable"
	// (fetchMarketPrice → null, quote/sell surfaces the error), so the swap UI
	// degrades gracefully until the pool is configured at launch.
	if (!HAS_METEORA_POOL) {
		throw new Error('Meteora RWT/USDC pool is not configured for this network (VITE_METEORA_POOL unset)');
	}
	if (!poolPromise) {
		poolPromise = DLMM.create(connection, METEORA_POOL, { cluster: CLUSTER }).catch((err) => {
			// Reset on failure so the next call retries instead of caching a reject.
			poolPromise = null;
			throw err;
		});
	}
	return poolPromise;
}

// ── Orientation (RWT = tokenX?) — derived from the live pool ────────────────────

/**
 * Whether the RWT mint is the pool's tokenX (vs tokenY). This is the single
 * source of truth for swap direction and price orientation, read from the LIVE
 * pool rather than hardcoded — devnet has tokenX = USDC (rwtIsX = false), mainnet
 * has tokenX = RWT (rwtIsX = true).
 *
 * `dlmmPool.tokenX.publicKey` is the on-chain `lbPair.tokenXMint` (the SDK
 * populates it directly from the LB-pair account; `dlmmPool.lbPair.tokenXMint`
 * is equivalent). We compare against `RWT_MINT` from config.
 */
function rwtIsTokenX(pool: DLMM): boolean {
	return pool.tokenX.publicKey.equals(RWT_MINT);
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
 * ORIENTATION (derived from the live pool, not hardcoded):
 * `getActiveBin().pricePerToken` is the decimal price of tokenX expressed in
 * tokenY (Y-per-X), already decimal-adjusted by the SDK.
 *   - If RWT is tokenX (mainnet, `rwtIsX`): pricePerToken is USDC-per-RWT
 *     directly → use it as-is, NO inversion.
 *   - If USDC is tokenX (devnet, `!rwtIsX`): pricePerToken is RWT-per-USDC →
 *     invert (`1 / p`) to get USDC-per-RWT.
 * This conditional replaces the old unconditional `1 / pricePerToken`, which was
 * correct ONLY for the devnet (USDC = tokenX) order and inverted on mainnet.
 *
 * Returns `null` if the pool can't be read (keeps the UI's "—" placeholder
 * honest rather than crashing).
 */
export async function fetchMarketPrice(): Promise<number | null> {
	try {
		const pool = await getPool();
		await pool.refetchStates();
		const rwtIsX = rwtIsTokenX(pool);
		const activeBin = await pool.getActiveBin();
		const priceYperX = Number(activeBin.pricePerToken); // tokenY per tokenX
		if (!Number.isFinite(priceYperX) || priceYperX <= 0) return null;
		// rwtIsX → priceYperX is already USDC-per-RWT; else invert RWT-per-USDC.
		const usdcPerRwt = rwtIsX ? priceYperX : 1 / priceYperX;
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
 * Quotes a RWT → USDC sell against the live pool.
 *
 * Direction: a sell sends the RWT leg in. In DLMM `swapForY = true` means input
 * tokenX → output tokenY, so `swapForY = rwtIsX` (true when RWT is tokenX, i.e.
 * mainnet; false on devnet where RWT is tokenY). This is the orientation-aware
 * replacement for the old fixed `swapForY = false`.
 *
 * `pool.swapQuote(inAmount, swapForY, allowedSlippage, binArrays)` returns the
 * out amount (USDC), fee, price impact (a `Decimal`), and the slippage-adjusted
 * minimum. The DLMM fee is charged on the IN leg (RWT) regardless of X/Y order,
 * so we re-value it in USDC at the effective price for display.
 *
 * NOTE on liquidity: the mainnet pool launches one-sided (RWT only, 0 USDC).
 * With no USDC on the out side, `swapQuote` throws
 * `SWAP_QUOTE_INSUFFICIENT_LIQUIDITY` (the SDK's "nothing to give out" signal,
 * verified live) — that is a liquidity state, not an orientation bug. We catch
 * exactly that signal and re-throw it as a typed `MeteoraError`
 * (`kind: 'insufficient-liquidity'`) so the UI can show a calm "selling
 * temporarily unavailable" notice instead of leaking the raw SDK string. Any
 * other/unknown error flows through unchanged. Once USDC liquidity is added,
 * the same code quotes a real USDC-out with NO change here.
 */
export async function quoteSellRwt(
	rwtAmount: number,
	slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<SellQuote> {
	const pool = await getPool();
	await pool.refetchStates();

	const inAmount = toBaseUnitsBN(rwtAmount);
	const swapForY = rwtIsTokenX(pool); // sell: RWT-leg in → swapForY when RWT is X
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	// `swapQuote` throws SWAP_QUOTE_INSUFFICIENT_LIQUIDITY when the out (USDC) side
	// is empty. Convert ONLY that signal into a typed MeteoraError; rethrow the
	// rest verbatim so genuine failures keep their original message/stack.
	let quote: ReturnType<typeof pool.swapQuote>;
	try {
		quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);
	} catch (err) {
		if (isInsufficientLiquidity(err)) {
			throw new MeteoraError(
				'insufficient-liquidity',
				'The RWT/USDC pool has no USDC liquidity yet, so RWT cannot be sold right now.'
			);
		}
		throw err;
	}

	const usdcOut = fromBaseUnits(quote.outAmount);
	const minOut = fromBaseUnits(quote.minOutAmount);
	// priceImpact is a Decimal fraction (e.g. 0.0021 = 0.21%).
	const priceImpactBps = Math.round(Number(quote.priceImpact.toString()) * 10_000);
	const effectivePrice = rwtAmount > 0 ? usdcOut / rwtAmount : 0;
	// Fee is denominated in the IN token (RWT) on a sell → value it in USDC.
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
	const rwtIsX = rwtIsTokenX(pool);
	const swapForY = rwtIsX; // sell: RWT-leg in → swapForY when RWT is X
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	const quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);

	// In/out mints come from the LIVE pool. Sell = RWT in, USDC out: the RWT leg
	// is tokenX when rwtIsX, else tokenY (and USDC is the other leg).
	const rwtMint = rwtIsX ? pool.tokenX.publicKey : pool.tokenY.publicKey;
	const usdcMint = rwtIsX ? pool.tokenY.publicKey : pool.tokenX.publicKey;
	const swapTx: Transaction = await pool.swap({
		inToken: rwtMint, // RWT in
		outToken: usdcMint, // USDC out
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
 * Quotes a USDC → RWT buy against the live pool.
 *
 * Mirror of `quoteSellRwt` with the swap direction flipped: a buy sends the USDC
 * leg in. It is the inverse of the sell, so `swapForY = !rwtIsX` (false on
 * mainnet where RWT is tokenX, true on devnet where USDC is tokenX). This is the
 * orientation-aware replacement for the old fixed `swapForY = true`.
 *
 * The DLMM fee is charged on the IN leg (USDC) on a buy regardless of X/Y order,
 * so `feeUsdc = fromBaseUnits(quote.fee)` directly — NO multiply by price (the
 * fee is already denominated in USDC). This DIFFERS from the sell quote, where
 * the IN token is RWT and the fee is re-valued in USDC.
 */
export async function quoteBuyRwt(
	usdcAmount: number,
	slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<BuyQuote> {
	const pool = await getPool();
	await pool.refetchStates();

	const inAmount = toBaseUnitsBN(usdcAmount);
	const swapForY = !rwtIsTokenX(pool); // buy: USDC-leg in → inverse of sell
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
	const rwtIsX = rwtIsTokenX(pool);
	const swapForY = !rwtIsX; // buy: USDC-leg in → inverse of sell
	const binArrays = await pool.getBinArrayForSwap(swapForY);
	const quote = pool.swapQuote(inAmount, swapForY, new BN(slippageBps), binArrays);

	// In/out mints come from the LIVE pool. Buy = USDC in, RWT out: the USDC leg
	// is tokenY when rwtIsX (RWT is X), else tokenX (and RWT is the other leg).
	const usdcMint = rwtIsX ? pool.tokenY.publicKey : pool.tokenX.publicKey;
	const rwtMint = rwtIsX ? pool.tokenX.publicKey : pool.tokenY.publicKey;
	const swapTx: Transaction = await pool.swap({
		inToken: usdcMint, // USDC in
		outToken: rwtMint, // RWT out
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
