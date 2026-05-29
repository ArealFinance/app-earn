/**
 * Devnet chain configuration — the single source of truth for the live
 * `earn` + `staking` deployment the UI reads from.
 *
 * Everything here is REAL devnet state (Phase 4.2d). The values were taken
 * from the deploy + initialize step; if the programs are re-deployed these
 * pins must be updated.
 *
 * No backend dependency: reads go straight to the public devnet RPC. The
 * RPC is rate-limited but fine for the V1 demo surface.
 */

import { Connection, PublicKey, type Commitment } from '@solana/web3.js';

// ── RPC ──────────────────────────────────────────────────────────────────────

/** Public devnet RPC. Rate-limited; acceptable for the demo. */
export const RPC_URL = 'https://api.devnet.solana.com';
export const COMMITMENT: Commitment = 'confirmed';

/** Shared read-only connection. Reused across reads so we don't churn sockets. */
export const connection = new Connection(RPC_URL, COMMITMENT);

// ── Program IDs ────────────────────────────────────────────────────────────────

export const EARN_PROGRAM_ID = new PublicKey('HMBZu87F9zTt4JGbQwaL5V6tFXdLBUyLtgeYTsVh1Rzu');
export const STAKING_PROGRAM_ID = new PublicKey('3WFdgqHFUnqtZoKQLpj8pQPd3ecitBGG9M2eBmaup8JL');

// ── Mints (all 6 decimals) ─────────────────────────────────────────────────────

export const RWT_MINT = new PublicKey('F6Zjyo3Huk6jrpM41SWBoh3Sj7px1tnt9D8jRKYo96YH');
export const STRWT_MINT = new PublicKey('J1ZsZD6r8YHTRoAWKrw6LjnWNyPZAAcoXXZL3sL1EhPE');
export const USDC_MINT = new PublicKey('E4HJu85ZmTrfBuy9kXQpehYnJdaHKY9oaEZNRCZcW35a');

export const TOKEN_DECIMALS = 6;

// ── Config PDAs (precomputed; seeds documented for reference) ───────────────────

/** EarnConfig PDA — seed ["earn_config"]. */
export const EARN_CONFIG_PDA = new PublicKey('7Wq8XC39SRVP8caZDV4WJA6EL88UZScKqwPur6D8PHvi');
/** StakingConfig PDA — seed ["staking_config"]. */
export const STAKING_CONFIG_PDA = new PublicKey('9EvdaRGSYQTRNNuQkEPsUhvx2idfqAKHTqrrHkqH6s6t');

// ── Vaults / fee destinations ───────────────────────────────────────────────────

/** USDC basket vault (EarnConfig-PDA-owned) — receives the mint body. */
export const BASKET_VAULT = new PublicKey('E4qxSTcV5fVpdiH6UvwaexZgEpbMDkXEiWeoD7rcgbSy');
/** RWT pool vault (StakingConfig-PDA-owned) — active + reserved RWT. */
export const POOL_VAULT = new PublicKey('DG6Fr1e23FKZcYpuqKCdJ78dU6ChgzxerPjERgrKBYy3');
/** USDC ATA receiving the 1% mint commission. */
export const DAO_FEE_DESTINATION = new PublicKey('1cJvdDiNNSfy4HMpH79peLRz6Jn6cBYP4asW3AhXBXR');

// ── PDA seeds (for client-side derivation, e.g. UnstakeTicket) ──────────────────

export const UNSTAKE_SEED = new TextEncoder().encode('unstake');

// ── On-chain constants (mirror contracts/*/src/constants.rs) ────────────────────

/** 6-decimal fixed-point scale for NAV. */
export const NAV_SCALE = 1_000_000n;
/** $1.00 NAV guard when RWT supply == 0. */
export const INITIAL_NAV = 1_000_000n;
/** 6-decimal fixed-point scale for the stRWT rate. */
export const RATE_SCALE = 1_000_000n;
/** ERC4626-style virtual offsets (inflation-attack defense). */
export const VIRTUAL_SHARES = 1_000_000n;
export const VIRTUAL_ASSETS = 10_000_000n;

/** Mint commission in basis points (1%). Charged on top of the body. */
export const MINT_FEE_BPS = 100n;
export const BPS_DENOMINATOR = 10_000n;

/** Unstake cooldown — 21 days, in seconds (matches COOLDOWN_SECONDS on-chain). */
export const COOLDOWN_SECONDS = 1_814_400;

/** Anti-dust floor — $1.00 minimum mint deposit (MIN_MINT_AMOUNT on-chain). */
export const MIN_MINT_AMOUNT_UI = 1; // in USDC

/** Anti-dust floor — 1 RWT minimum per stake (MIN_STAKE_AMOUNT on-chain). */
export const MIN_STAKE_AMOUNT_UI = 1; // in RWT

// ── SPL Token program (classic) ────────────────────────────────────────────────

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
