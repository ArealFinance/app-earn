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

import { Connection, PublicKey, type Cluster, type Commitment } from '@solana/web3.js';

// ── RPC ──────────────────────────────────────────────────────────────────────

/** Public devnet RPC. Rate-limited; acceptable for the demo. */
export const RPC_URL = 'https://api.devnet.solana.com';
export const COMMITMENT: Commitment = 'confirmed';

/**
 * Cluster the deployment lives on. The ONLY value that differs devnet↔mainnet
 * for the Meteora integration — the DLMM program ID is identical on both.
 * Passed to `DLMM.create(connection, pool, { cluster: CLUSTER })`.
 */
export const CLUSTER: Cluster = 'devnet';

/** Shared read-only connection. Reused across reads so we don't churn sockets. */
export const connection = new Connection(RPC_URL, COMMITMENT);

/**
 * True when the deployment targets devnet. Used to gate devnet-only affordances
 * (e.g. the test-USDC faucet) so they never render on mainnet. Reuses the same
 * CLUSTER constant the Meteora reads key off of.
 */
export const IS_DEVNET = CLUSTER === 'devnet';

// ── Faucet (devnet-only, backend-served) ─────────────────────────────────────
//
// The faucet is the ONLY backend dependency in the app. Its base URL is injected
// at build time via `VITE_FAUCET_API_BASE` (see .env.example). When unset the
// faucet is treated as unavailable and the affordance stays hidden — the rest of
// the app reads straight from RPC and is unaffected.

/**
 * Base URL for the faucet API (e.g. `https://api.areal.finance`). Empty string
 * when unset → callers treat the faucet as unavailable. Never hardcode the base
 * in components; always source it from here.
 */
export const FAUCET_API_BASE: string = import.meta.env.VITE_FAUCET_API_BASE ?? '';

// ── Program IDs ────────────────────────────────────────────────────────────────

export const EARN_PROGRAM_ID = new PublicKey('HGh7TcuqUbTRrFTYBUtsTctAEEmsANWnDxeWcbgqMg8b');
export const STAKING_PROGRAM_ID = new PublicKey('CmKXHk3u6pDUC6Q11Le6gmhCgENQSFvduisXb7guUGoL');

// ── Mints (all 6 decimals) ─────────────────────────────────────────────────────

export const RWT_MINT = new PublicKey('8hJPUC4UNsiyBh5cosTA8RqY9TbBSmnxqkBb2sHJ5qzM');
export const STRWT_MINT = new PublicKey('EnvY1tsk4SLMPi4uThXCk4dbagtRJ1WdaTFYPKDroNwy');
export const USDC_MINT = new PublicKey('5rrpFYYVkwGMeTTCox3EE4VBNvkYMCQmxkYJhS9TA4Wx');

export const TOKEN_DECIMALS = 6;

// ── Config PDAs (precomputed; seeds documented for reference) ───────────────────

/** EarnConfig PDA — seed ["earn_config"]. */
export const EARN_CONFIG_PDA = new PublicKey('H4DBeFKwZsVrhMmMFG7HSMEQckeCYdewuri28kQ3wT4p');
/** StakingConfig PDA — seed ["staking_config"]. */
export const STAKING_CONFIG_PDA = new PublicKey('BWb75dNXbJbteLsmKy58sfHj8nYVa6CqaDzJrWo1mP1R');

// ── Vaults / fee destinations ───────────────────────────────────────────────────

/** USDC basket vault (EarnConfig-PDA-owned) — receives the mint body. */
export const BASKET_VAULT = new PublicKey('B34MHTDgcgraY7zS8ezmDLoVJTA8y3CXUfzpfJ98mEFt');
/** RWT pool vault (StakingConfig-PDA-owned) — active + reserved RWT. */
export const POOL_VAULT = new PublicKey('C4VTQqr2f9wUDbXsfF7zawMvxoUvRVDgU3pMZuBYbhFN');
/** USDC ATA receiving the 1% mint commission. */
export const DAO_FEE_DESTINATION = new PublicKey('7eU9YeiDsN7Riz1HzRRp9cenjRNbJZDZFdDMnPsLBKvd');

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

// ── Meteora DLMM pool (RWT/USDC) ─────────────────────────────────────────────
//
// The earn-RWT / USDC market is a live Meteora DLMM pool. The DLMM program ID
// is IDENTICAL on devnet and mainnet, so only CLUSTER above changes between
// environments. Pool data is mirrored in repo data/devnet-addresses.json →
// .earn.meteora_pool.
//
//   tokenX = USDC (6 dec)  → the quote leg
//   tokenY = RWT  (6 dec)  → the base leg
//
// A RWT→USDC sell is therefore a Y→X swap (swapForY = false). The active bin's
// price (X-per-Y) is USDC per RWT — the market price we surface.

/** DLMM on-chain program (devnet == mainnet). */
export const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
/** The live RWT/USDC DLMM pool (LB pair). */
export const METEORA_POOL = new PublicKey('5i3ipA3AaXCJ7C2U7ZUoxUWQiZDUEU42ihwUGTMHvvkF');
/** Pool tokenX — USDC, the quote leg. (Same as USDC_MINT; pinned for clarity.) */
export const METEORA_TOKEN_X = USDC_MINT;
/** Pool tokenY — earn-RWT, the base leg. (Same as RWT_MINT; pinned for clarity.) */
export const METEORA_TOKEN_Y = RWT_MINT;
/** Pool bin step (25 bps) and base fee (30 bps) — for reference / display. */
export const METEORA_BIN_STEP_BPS = 25;
export const METEORA_BASE_FEE_BPS = 30;

/** Default sell slippage tolerance (bps) when the caller doesn't specify. */
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
