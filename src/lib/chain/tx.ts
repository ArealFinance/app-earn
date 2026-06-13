/**
 * Transaction builders for the live `earn` + `staking` devnet deployment.
 *
 * Each builder assembles a legacy `Transaction` (instruction data = 8-byte
 * Anchor discriminator + Borsh-encoded args, accounts ordered EXACTLY as the
 * Rust `#[derive(Accounts)]` struct) and hands it to a `SendFn` supplied by
 * the wallet store (which wraps the injected provider's
 * `signAndSendTransaction`).
 *
 * Account orders were cross-checked against:
 *   - contracts/earn/src/instructions/mint_rwt.rs        (MintRwt)
 *   - contracts/staking/src/instructions/stake.rs        (Stake)
 *   - contracts/staking/src/instructions/initiate_unstake.rs (InitiateUnstake)
 *   - contracts/staking/src/instructions/complete_unstake.rs (CompleteUnstake)
 *
 * No on-chain redeem / sell path exists yet (no DEX pool seeded) → there is
 * deliberately NO sell builder here.
 */

import {
	PublicKey,
	Transaction,
	TransactionInstruction,
	type Commitment
} from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	createAssociatedTokenAccountIdempotentInstruction
} from '@solana/spl-token';
import {
	connection,
	COMMITMENT,
	EARN_PROGRAM_ID,
	STAKING_PROGRAM_ID,
	EARN_CONFIG_PDA,
	STAKING_CONFIG_PDA,
	RWT_MINT,
	STRWT_MINT,
	USDC_MINT,
	BASKET_VAULT,
	POOL_VAULT,
	DAO_FEE_DESTINATION,
	TOKEN_PROGRAM_ID,
	UNSTAKE_SEED,
	TOKEN_DECIMALS,
	DEFAULT_SLIPPAGE_BPS
} from './config';
import { instructionDiscriminator } from './discriminator';
import { fetchMintQuoteInputs, fetchStrwtRate } from './reads';
import { quoteMint } from './mint-quote';

const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

/**
 * Sends a built transaction. Provided by the wallet store; wraps the injected
 * provider's `signAndSendTransaction`, returning the tx signature.
 */
export type SendFn = (tx: Transaction) => Promise<string>;

// ── Encoding helpers ────────────────────────────────────────────────────────────

/** UI token amount → base units (u64) as a bigint. */
export function toBaseUnits(uiAmount: number): bigint {
	// Round to avoid float dust beyond 6 decimals.
	return BigInt(Math.round(uiAmount * 10 ** TOKEN_DECIMALS));
}

function encodeU64LE(value: bigint): Uint8Array {
	const out = new Uint8Array(8);
	let v = value;
	for (let i = 0; i < 8; i += 1) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

/** discriminator(name) ++ each u64 arg (LE). */
async function buildIxData(name: string, args: bigint[]): Promise<Buffer> {
	const disc = await instructionDiscriminator(name);
	const parts = [disc, ...args.map(encodeU64LE)];
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return Buffer.from(out);
}

/** Random u64 nonce for unstake ticket PDA seeds. */
export function randomNonce(): bigint {
	const buf = new Uint8Array(8);
	crypto.getRandomValues(buf);
	let v = 0n;
	for (let i = 0; i < 8; i += 1) v |= BigInt(buf[i]) << (8n * BigInt(i));
	return v;
}

function nonceToLeBytes(nonce: bigint): Uint8Array {
	return encodeU64LE(nonce);
}

/** Derive the UnstakeTicket PDA: ["unstake", owner, nonce_le]. */
export function deriveUnstakeTicket(owner: PublicKey, nonce: bigint): PublicKey {
	const [pda] = PublicKey.findProgramAddressSync(
		[UNSTAKE_SEED, owner.toBytes(), nonceToLeBytes(nonce)],
		STAKING_PROGRAM_ID
	);
	return pda;
}

/** Attach a fresh blockhash + fee payer to a transaction. */
async function finalize(tx: Transaction, feePayer: PublicKey): Promise<Transaction> {
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT);
	tx.recentBlockhash = blockhash;
	tx.lastValidBlockHeight = lastValidBlockHeight;
	tx.feePayer = feePayer;
	return tx;
}

// ── mint_rwt(usdc_amount, min_rwt_out) ───────────────────────────────────────────
//
// MintRwt account order (mint_rwt.rs):
//   0 user                signer
//   1 earn_config         mut (EarnConfig PDA)
//   2 rwt_mint            mut
//   3 user_usdc           mut
//   4 user_rwt            mut
//   5 basket_vault        mut
//   6 dao_fee_destination mut
//   7 token_program
//
// IMPORTANT — input model: `usdcAmount` is the TOTAL the user spends (`T`), NOT
// the deposit body. The contract charges the 1% fee ON TOP of the body it
// receives as `usdc_amount`, so we solve for a body such that body + fee <= T
// and send THAT body (not T). The body/fee/rwt_out/min_rwt_out math lives in the
// shared `quoteMint` helper so the modal preview and this transaction floor
// identically and the displayed numbers equal the on-chain outcome.

export async function buildMintRwt(
	owner: PublicKey,
	usdcAmount: number,
	send: SendFn
): Promise<string> {
	const totalBase = toBaseUnits(usdcAmount);

	// Live integer inputs (scaled NAV + on-chain fee bps) from the SAME config
	// read Book NAV uses. The fee is read live — never hardcoded. The shared
	// helper converts the total into the body and floors min_rwt_out (contract
	// rejects min_rwt_out == 0; the slippage buffer tolerates a NAV/fee tick).
	const inputs = await fetchMintQuoteInputs();
	const { body, minRwtOut } = quoteMint(totalBase, inputs, BigInt(DEFAULT_SLIPPAGE_BPS));
	const minRwtOutSafe = minRwtOut > 0n ? minRwtOut : 1n;

	const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, owner);
	const userRwt = getAssociatedTokenAddressSync(RWT_MINT, owner);

	const tx = new Transaction();

	// Idempotently create the user's RWT ATA (no-op if it exists).
	tx.add(
		createAssociatedTokenAccountIdempotentInstruction(owner, userRwt, owner, RWT_MINT)
	);

	// Send the BODY (not the typed total) as the contract's `usdc_amount`.
	const data = await buildIxData('mint_rwt', [body, minRwtOutSafe]);
	tx.add(
		new TransactionInstruction({
			programId: EARN_PROGRAM_ID,
			keys: [
				{ pubkey: owner, isSigner: true, isWritable: true },
				{ pubkey: EARN_CONFIG_PDA, isSigner: false, isWritable: true },
				{ pubkey: RWT_MINT, isSigner: false, isWritable: true },
				{ pubkey: userUsdc, isSigner: false, isWritable: true },
				{ pubkey: userRwt, isSigner: false, isWritable: true },
				{ pubkey: BASKET_VAULT, isSigner: false, isWritable: true },
				{ pubkey: DAO_FEE_DESTINATION, isSigner: false, isWritable: true },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
			],
			data
		})
	);

	await finalize(tx, owner);
	return send(tx);
}

// ── stake(rwt_amount, min_strwt_out) ─────────────────────────────────────────────
//
// Stake account order (stake.rs):
//   0 user            signer
//   1 staking_config  mut (StakingConfig PDA)
//   2 strwt_mint      mut
//   3 user_rwt_ata    mut
//   4 user_strwt_ata  mut
//   5 pool_vault      mut
//   6 token_program

export async function buildStake(
	owner: PublicKey,
	rwtAmount: number,
	send: SendFn
): Promise<string> {
	const rwtBase = toBaseUnits(rwtAmount);

	// min_strwt_out from the live rate, with a 0.5% floor (contract rejects
	// strwt_out == 0 / slippage). strwt_out = rwt × (supply+VS) / (active+VA);
	// at the empty pool the rate is 10 RWT/stRWT so strwt_out ≈ rwt / 10.
	const rate = await fetchStrwtRate(); // RWT per stRWT
	const strwtOut = rate > 0 ? rwtBase * 1000n / BigInt(Math.round(rate * 1000)) : 0n;
	const minStrwtOut = (strwtOut * 995n) / 1000n;
	const minStrwtOutSafe = minStrwtOut > 0n ? minStrwtOut : 1n;

	const userRwt = getAssociatedTokenAddressSync(RWT_MINT, owner);
	const userStrwt = getAssociatedTokenAddressSync(STRWT_MINT, owner);

	const tx = new Transaction();

	// The contract requires user_strwt_ata to already exist → idempotent-create.
	tx.add(
		createAssociatedTokenAccountIdempotentInstruction(owner, userStrwt, owner, STRWT_MINT)
	);

	const data = await buildIxData('stake', [rwtBase, minStrwtOutSafe]);
	tx.add(
		new TransactionInstruction({
			programId: STAKING_PROGRAM_ID,
			keys: [
				{ pubkey: owner, isSigner: true, isWritable: true },
				{ pubkey: STAKING_CONFIG_PDA, isSigner: false, isWritable: true },
				{ pubkey: STRWT_MINT, isSigner: false, isWritable: true },
				{ pubkey: userRwt, isSigner: false, isWritable: true },
				{ pubkey: userStrwt, isSigner: false, isWritable: true },
				{ pubkey: POOL_VAULT, isSigner: false, isWritable: true },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
			],
			data
		})
	);

	await finalize(tx, owner);
	return send(tx);
}

// ── initiate_unstake(strwt_amount, nonce) ────────────────────────────────────────
//
// InitiateUnstake account order (initiate_unstake.rs):
//   0 user            mut, signer
//   1 staking_config  mut
//   2 strwt_mint      mut
//   3 user_strwt_ata  mut
//   4 ticket          mut (UnstakeTicket PDA — created here)
//   5 token_program
//   6 system_program

export interface InitiateUnstakeResult {
	signature: string;
	nonce: string;
	ticket: string;
}

export async function buildInitiateUnstake(
	owner: PublicKey,
	strwtAmount: number,
	send: SendFn
): Promise<InitiateUnstakeResult> {
	const strwtBase = toBaseUnits(strwtAmount);
	const nonce = randomNonce();
	const ticket = deriveUnstakeTicket(owner, nonce);
	const userStrwt = getAssociatedTokenAddressSync(STRWT_MINT, owner);

	const data = await buildIxData('initiate_unstake', [strwtBase, nonce]);
	const tx = new Transaction();
	tx.add(
		new TransactionInstruction({
			programId: STAKING_PROGRAM_ID,
			keys: [
				{ pubkey: owner, isSigner: true, isWritable: true },
				{ pubkey: STAKING_CONFIG_PDA, isSigner: false, isWritable: true },
				{ pubkey: STRWT_MINT, isSigner: false, isWritable: true },
				{ pubkey: userStrwt, isSigner: false, isWritable: true },
				{ pubkey: ticket, isSigner: false, isWritable: true },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
				{ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }
			],
			data
		})
	);

	await finalize(tx, owner);
	const signature = await send(tx);
	return { signature, nonce: nonce.toString(), ticket: ticket.toBase58() };
}

// ── complete_unstake(nonce) ──────────────────────────────────────────────────────
//
// CompleteUnstake account order (complete_unstake.rs):
//   0 user            mut, signer
//   1 staking_config  mut
//   2 ticket          mut (closed; rent → user)
//   3 pool_vault      mut
//   4 user_rwt_ata    mut
//   5 token_program

export async function buildCompleteUnstake(
	owner: PublicKey,
	nonceStr: string,
	send: SendFn
): Promise<string> {
	const nonce = BigInt(nonceStr);
	const ticket = deriveUnstakeTicket(owner, nonce);
	const userRwt = getAssociatedTokenAddressSync(RWT_MINT, owner);

	const tx = new Transaction();
	// Ensure the RWT ATA exists to receive the payout (idempotent).
	tx.add(
		createAssociatedTokenAccountIdempotentInstruction(owner, userRwt, owner, RWT_MINT)
	);

	const data = await buildIxData('complete_unstake', [nonce]);
	tx.add(
		new TransactionInstruction({
			programId: STAKING_PROGRAM_ID,
			keys: [
				{ pubkey: owner, isSigner: true, isWritable: true },
				{ pubkey: STAKING_CONFIG_PDA, isSigner: false, isWritable: true },
				{ pubkey: ticket, isSigner: false, isWritable: true },
				{ pubkey: POOL_VAULT, isSigner: false, isWritable: true },
				{ pubkey: userRwt, isSigner: false, isWritable: true },
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
			],
			data
		})
	);

	await finalize(tx, owner);
	return send(tx);
}

export { COMMITMENT as TX_COMMITMENT, type Commitment };
