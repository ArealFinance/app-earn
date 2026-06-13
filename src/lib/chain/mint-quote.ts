/**
 * Mint-quote math — the SINGLE integer source of truth for the "Buy RWT → Mint"
 * path. Mirrors `contracts/earn/src/instructions/mint_rwt.rs` EXACTLY, in BigInt
 * (base units, 6 decimals), so the preview the user sees equals the on-chain
 * outcome to the lamport — no float drift between modal and transaction.
 *
 * Product model (chosen by the PO): the AMOUNT the user types is the TOTAL USDC
 * they spend (`T`), not the deposit body. The contract still charges the 1% fee
 * ON TOP of the body it receives as `usdc_amount`. So we must solve for a body
 * such that `body + fee(body) <= T`, then send that body to the contract.
 *
 * Contract semantics (ground truth):
 *   - fee     = floor(body * mint_fee_bps / 10_000)             (mul_div_u64, floor)
 *   - rwt_out = floor(body * NAV_SCALE / nav)                   (u128 mul, floor)
 *   - USDC moved from user = body (→ basket_vault) + fee (→ dao_fee_destination)
 *   - nav     = supply == 0 ? INITIAL_NAV : floor(capital * NAV_SCALE / supply)
 *
 * Body solve (input = total):
 *   body = floor(T * 10_000 / (10_000 + feeBps))
 * This floor GUARANTEES `body + floor(body * feeBps / 10_000) <= T` — never
 * exceeds the typed amount, which is what the Max button relies on. Proof:
 *   body * (10_000 + feeBps) <= T * 10_000        (from the floor division)
 *   => body * feeBps <= 10_000 * (T - body)
 *   => floor(body * feeBps / 10_000) <= T - body  (floor only shrinks the LHS)
 *   => body + floor(body * feeBps / 10_000) <= T  ∎
 */

import { NAV_SCALE, BPS_DENOMINATOR } from './config';

/** Inputs read live from the on-chain EarnConfig (+ RWT supply), as BigInts. */
export interface MintQuoteInputs {
	/** Scaled NAV (6-dec): supply==0 ? INITIAL_NAV : floor(capital*NAV_SCALE/supply). */
	navScaled: bigint;
	/** EarnConfig.mint_fee_bps (u16) — live, never hardcoded. */
	feeBps: bigint;
}

/** Fully-resolved integer quote for a mint, all values in base units (u64-domain). */
export interface MintQuote {
	/** Deposit body sent to the contract as `usdc_amount` (← what we actually send). */
	body: bigint;
	/** Fee charged on top of the body (→ dao_fee_destination). */
	fee: bigint;
	/** RWT minted to the user. */
	rwtOut: bigint;
	/** Total USDC leaving the wallet = body + fee. Always <= the typed total. */
	totalSpent: bigint;
	/** Slippage-floored min RWT out passed to the instruction (>= 1 when rwtOut > 0). */
	minRwtOut: bigint;
}

/**
 * Compute the mint quote from a TOTAL the user spends (`totalBaseUnits`), the
 * live scaled NAV, and the live fee bps. `slippageBps` floors `minRwtOut`
 * (default 50 = 0.5%). Pure integer math — identical to the contract's flooring.
 */
export function quoteMint(
	totalBaseUnits: bigint,
	{ navScaled, feeBps }: MintQuoteInputs,
	slippageBps = 50n
): MintQuote {
	const total = totalBaseUnits > 0n ? totalBaseUnits : 0n;
	const nav = navScaled > 0n ? navScaled : 1n;

	// body = floor(T * 10_000 / (10_000 + feeBps)) — guarantees body + fee <= T.
	const body = (total * BPS_DENOMINATOR) / (BPS_DENOMINATOR + feeBps);

	// fee = floor(body * feeBps / 10_000) — matches mul_div_u64 (floor).
	const fee = (body * feeBps) / BPS_DENOMINATOR;

	// rwt_out = floor(body * NAV_SCALE / nav) — u128 path; BigInt is arbitrary-precision.
	const rwtOut = (body * NAV_SCALE) / nav;

	const totalSpent = body + fee;

	// min_rwt_out = floor(rwtOut * (10_000 - slippageBps) / 10_000); contract rejects 0.
	const minRwtOut = (rwtOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR;

	return { body, fee, rwtOut, totalSpent, minRwtOut };
}
