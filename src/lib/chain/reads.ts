/**
 * On-chain reads for the live `earn` + `staking` devnet deployment.
 *
 * Everything here is REAL devnet state, decoded directly from account buffers
 * (no @areal/sdk dependency — the layouts are hand-decoded against the Rust
 * structs in contracts/{earn,staking}/src/state.rs).
 *
 * Account-layout offsets (all #[account] structs are repr(C, packed) with an
 * 8-byte discriminator prefix — NO padding):
 *
 *   EarnConfig:
 *     [0..8)   discriminator
 *     [8..24)  total_invested_capital  u128 (LE)   ← Book NAV numerator
 *     (… authority, mints, etc. — not needed for reads)
 *
 *   StakingConfig:
 *     [0..8)    discriminator
 *     [8..40)   authority         [32]
 *     [40..72)  pending_authority [32]
 *     [72]      has_pending       bool
 *     [73..105) rwt_mint         [32]
 *     [105..137) strwt_mint       [32]
 *     [137..169) reward_depositor [32]
 *     [169..201) pool_vault       [32]
 *     [201..209) total_rwt_active    u64 (LE)  ← rate numerator
 *     [209..217) total_rwt_reserved  u64 (LE)
 *
 *   UnstakeTicket:
 *     [0..8)   discriminator
 *     [8..40)  owner       [32]
 *     [40..48) amount_rwt  u64 (LE)
 *     [48..56) unlock_ts   i64 (LE)
 *     [56..64) nonce       u64 (LE)
 *     [64]     bump
 *
 *   SPL Mint:  supply u64 (LE) at byte offset 36.
 *   SPL Token: amount u64 (LE) at byte offset 64.
 */

import { PublicKey, type GetProgramAccountsFilter } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
	connection,
	COMMITMENT,
	EARN_CONFIG_PDA,
	STAKING_CONFIG_PDA,
	STAKING_PROGRAM_ID,
	RWT_MINT,
	STRWT_MINT,
	USDC_MINT,
	NAV_SCALE,
	INITIAL_NAV,
	RATE_SCALE,
	VIRTUAL_ASSETS,
	VIRTUAL_SHARES,
	TOKEN_DECIMALS,
	MINT_FEE_BPS
} from './config';
import type { PendingUnstake } from '$lib/earn/types';
import type { MintQuoteInputs } from './mint-quote';

/**
 * EarnConfig byte offset of `mint_fee_bps` (u16). The #[account] struct is
 * repr(C, packed) with an 8-byte discriminator prefix:
 *   disc(8) + total_invested_capital(16) + authority(32) + pending_authority(32)
 *   + has_pending(1) = 89  → mint_fee_bps starts at 89.
 * (Cross-checked against contracts/earn/src/state.rs running offsets.)
 */
const EARN_CONFIG_MINT_FEE_BPS_OFFSET = 89;

// ── Little-endian integer decoders ──────────────────────────────────────────────

function readU64LE(buf: Uint8Array, offset: number): bigint {
	let value = 0n;
	for (let i = 0; i < 8; i += 1) {
		value |= BigInt(buf[offset + i]) << (8n * BigInt(i));
	}
	return value;
}

function readU128LE(buf: Uint8Array, offset: number): bigint {
	let value = 0n;
	for (let i = 0; i < 16; i += 1) {
		value |= BigInt(buf[offset + i]) << (8n * BigInt(i));
	}
	return value;
}

function readU16LE(buf: Uint8Array, offset: number): number {
	return buf[offset] | (buf[offset + 1] << 8);
}

function readI64LE(buf: Uint8Array, offset: number): bigint {
	const u = readU64LE(buf, offset);
	// Two's-complement sign correction for the top bit.
	return u >= 1n << 63n ? u - (1n << 64n) : u;
}

/** Scale a 6-decimal fixed-point bigint into a JS number (dollars / tokens). */
function fromScaled(value: bigint): number {
	return Number(value) / 10 ** TOKEN_DECIMALS;
}

// ── Mint / token-account amount reads ───────────────────────────────────────────

/** Raw SPL mint supply (base units, u64). 0 if the account is missing. */
async function readMintSupply(mint: PublicKey): Promise<bigint> {
	const info = await connection.getAccountInfo(mint, COMMITMENT);
	if (!info) return 0n;
	return readU64LE(info.data, 36);
}

/** Raw SPL token-account amount (base units, u64). 0 if the ATA is missing. */
async function readTokenAccountAmount(ata: PublicKey): Promise<bigint> {
	const info = await connection.getAccountInfo(ata, COMMITMENT);
	if (!info) return 0n;
	return readU64LE(info.data, 64);
}

// ── Book NAV (price per RWT, USD) ────────────────────────────────────────────────

/**
 * Book NAV = total_invested_capital × NAV_SCALE / rwt_supply, with the
 * INITIAL_NAV ($1.00) guard when supply == 0. Returns USD per RWT.
 *
 * On the current empty state (supply 0) this reads $1.00 from EarnConfig.
 */
export async function fetchBookNav(): Promise<number> {
	const [configInfo, supply] = await Promise.all([
		connection.getAccountInfo(EARN_CONFIG_PDA, COMMITMENT),
		readMintSupply(RWT_MINT)
	]);

	if (!configInfo) return fromScaled(INITIAL_NAV);

	const capital = readU128LE(configInfo.data, 8);
	const navScaled = supply === 0n ? INITIAL_NAV : (capital * NAV_SCALE) / supply;
	return fromScaled(navScaled);
}

/**
 * Integer mint-quote inputs read LIVE from the same EarnConfig (+ RWT supply)
 * that Book NAV is derived from: the scaled NAV and the on-chain
 * `mint_fee_bps`. These feed `quoteMint` so the preview and the transaction use
 * the identical flooring as the contract. Never hardcodes the fee — it is read
 * from the live config (falling back to MINT_FEE_BPS only if the account is
 * unreadable, mirroring fetchBookNav's INITIAL_NAV fallback).
 */
export async function fetchMintQuoteInputs(): Promise<MintQuoteInputs> {
	const [configInfo, supply] = await Promise.all([
		connection.getAccountInfo(EARN_CONFIG_PDA, COMMITMENT),
		readMintSupply(RWT_MINT)
	]);

	if (!configInfo) {
		return { navScaled: INITIAL_NAV, feeBps: MINT_FEE_BPS };
	}

	const capital = readU128LE(configInfo.data, 8);
	const navScaled = supply === 0n ? INITIAL_NAV : (capital * NAV_SCALE) / supply;
	const feeBps = BigInt(readU16LE(configInfo.data, EARN_CONFIG_MINT_FEE_BPS_OFFSET));

	return { navScaled, feeBps };
}

// ── stRWT → RWT rate ─────────────────────────────────────────────────────────────

/**
 * rate = (total_rwt_active + VIRTUAL_ASSETS) × RATE_SCALE
 *        / (strwt_supply + VIRTUAL_SHARES)
 * Returns RWT per stRWT. On the empty pool this is exactly 10.0.
 */
export async function fetchStrwtRate(): Promise<number> {
	const [configInfo, strwtSupply] = await Promise.all([
		connection.getAccountInfo(STAKING_CONFIG_PDA, COMMITMENT),
		readMintSupply(STRWT_MINT)
	]);

	if (!configInfo) return Number(VIRTUAL_ASSETS / VIRTUAL_SHARES);

	const active = readU64LE(configInfo.data, 201);
	const rateScaled =
		((active + VIRTUAL_ASSETS) * RATE_SCALE) / (strwtSupply + VIRTUAL_SHARES);
	return fromScaled(rateScaled);
}

// ── TVL = AUM (total_invested_capital, USD) ──────────────────────────────────────

/**
 * TVL = AUM = total_invested_capital, the on-chain RWA backing value behind the
 * RWT supply. This is the SAME u128 (6-decimal USD) field Book NAV is derived
 * from — read at byte offset 8 of EarnConfig (right after the discriminator).
 *
 * The genesis backing is off-chain (RWT representing a real-world asset), so the
 * basket vault's on-chain USDC balance is only leftover dust and is NOT a valid
 * TVL. total_invested_capital is the protocol's authoritative AUM and grows as
 * users deposit.
 */
export async function fetchTvl(): Promise<number> {
	const configInfo = await connection.getAccountInfo(EARN_CONFIG_PDA, COMMITMENT);
	if (!configInfo) return 0;
	const capital = readU128LE(configInfo.data, 8); // total_invested_capital (6-dec USD)
	return fromScaled(capital);
}

// ── Per-wallet balances ──────────────────────────────────────────────────────────

/** Liquid RWT held by the wallet (earn-RWT ATA). 0 if no ATA. */
export async function fetchRwtBalance(owner: PublicKey): Promise<number> {
	const ata = getAssociatedTokenAddressSync(RWT_MINT, owner);
	return fromScaled(await readTokenAccountAmount(ata));
}

/** stRWT staking-share balance held by the wallet. 0 if no ATA. */
export async function fetchStrwtBalance(owner: PublicKey): Promise<number> {
	const ata = getAssociatedTokenAddressSync(STRWT_MINT, owner);
	return fromScaled(await readTokenAccountAmount(ata));
}

/** USDC balance held by the wallet (devnet USDC ATA). 0 if no ATA. */
export async function fetchUsdcBalance(owner: PublicKey): Promise<number> {
	const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
	return fromScaled(await readTokenAccountAmount(ata));
}

// ── Pending unstake tickets ──────────────────────────────────────────────────────

/**
 * Scans the staking program for UnstakeTicket accounts owned by `owner`.
 *
 * Filter: dataSize == 65 (8 disc + 57 body) AND memcmp at offset 8 (the
 * `owner` field) == the wallet pubkey. Returns the decoded tickets, sorted by
 * unlock time ascending.
 *
 * getProgramAccounts is heavier than a single read but the public devnet RPC
 * tolerates it for the small ticket set of a demo wallet.
 */
export async function fetchPendingUnstakes(owner: PublicKey): Promise<PendingUnstake[]> {
	const filters: GetProgramAccountsFilter[] = [
		{ dataSize: 65 },
		{ memcmp: { offset: 8, bytes: owner.toBase58() } }
	];

	let accounts;
	try {
		accounts = await connection.getProgramAccounts(STAKING_PROGRAM_ID, {
			commitment: COMMITMENT,
			filters
		});
	} catch {
		// If the RPC rejects getProgramAccounts (rate limit / disabled), degrade
		// to an empty list rather than crashing the dashboard.
		return [];
	}

	const tickets: PendingUnstake[] = accounts.map(({ pubkey, account }) => {
		const data = account.data;
		const amountRwt = fromScaled(readU64LE(data, 40));
		const unlockTsSec = readI64LE(data, 48);
		const nonce = readU64LE(data, 56);
		return {
			id: pubkey.toBase58(),
			amountRwt,
			unlockTs: Number(unlockTsSec) * 1000,
			// nonce is needed to build complete_unstake; carried as a string-safe field.
			nonce: nonce.toString()
		};
	});

	tickets.sort((a, b) => a.unlockTs - b.unlockTs);
	return tickets;
}
