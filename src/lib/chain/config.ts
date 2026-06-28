/**
 * Network-driven chain configuration — the single source of truth for the live
 * `earn` + `staking` deployment the UI reads from.
 *
 * The active network is selected at BUILD time via `VITE_NETWORK` (one of
 * `devnet` | `mainnet`). Devnet is the DEFAULT — an unset/unknown value falls
 * back to devnet, so existing devnet builds are unchanged. Mainnet is additive
 * and switchable: set `VITE_NETWORK=mainnet` to point the app at the mainnet
 * deployment (the Meteora pool is built in per network; see METEORA_POOL below).
 *
 * RPC transport: the shared `connection` uses a RESILIENT fetch (see rpc.ts).
 * It prefers a PRIMARY endpoint and transparently falls back to the public
 * cluster RPC on transport failure. Precedence (see the RPC section below):
 *   1. `VITE_RPC_URL` set        → that URL is PRIMARY (operator override).
 *   2. else `VITE_FAUCET_API_BASE` set → `${base}/rpc` backend proxy is PRIMARY.
 *   3. else                      → public cluster RPC is PRIMARY (no fallback).
 * In cases 1 and 2 the FALLBACK is always the public `NET.rpcUrl`. This keeps
 * the Seeker APK + web app working with no client-side Helius key (the key lives
 * server-side behind the proxy) while staying available if the proxy is down.
 *
 * Export shape is UNCHANGED across networks: program IDs / mints / vaults are
 * `PublicKey` instances, scaling constants are `bigint`. Consumers
 * (`tx.ts`, `meteora.ts`, `reads.ts`, modals, …) import the same names and need
 * no per-network branching.
 */

import { Connection, PublicKey, type Cluster, type Commitment } from '@solana/web3.js';
import { makeResilientFetch } from './rpc';

// ── Network selection ──────────────────────────────────────────────────────────

export type AppNetwork = 'devnet' | 'mainnet';

/**
 * Active network, build-time. `VITE_NETWORK=mainnet` switches the whole config
 * to the mainnet address set; anything else (unset, `devnet`, a typo) resolves
 * to `devnet` — the fail-safe default that preserves existing behavior.
 */
export const NETWORK: AppNetwork =
	(import.meta.env.VITE_NETWORK as string) === 'mainnet' ? 'mainnet' : 'devnet';

/**
 * Per-network address + RPC profile. Everything that differs devnet↔mainnet
 * lives here; the rest of the file just reads from `NET`. Adding a new network
 * is a single entry. Addresses are kept as base58 strings in the table and
 * wrapped into `PublicKey` instances below (the exported shape).
 *
 * Source of truth:
 *   devnet  — the 2026-05-31 re-bootstrap deploy + initialize step.
 *   mainnet — the earn/staking mainnet deployment (2026-06-12). The Meteora
 *             RWT/USDC pool lives in the Meteora section below (not in this
 *             profile struct) as MAINNET_METEORA_POOL, overridable via
 *             `VITE_METEORA_POOL`.
 */
interface NetworkProfile {
	cluster: Cluster;
	rpcUrl: string;
	earnProgramId: string;
	stakingProgramId: string;
	rwtMint: string;
	strwtMint: string;
	usdcMint: string;
	earnConfigPda: string;
	stakingConfigPda: string;
	basketVault: string;
	poolVault: string;
	daoFeeDestination: string;
}

const PROFILES: Record<AppNetwork, NetworkProfile> = {
	devnet: {
		cluster: 'devnet',
		rpcUrl: 'https://api.devnet.solana.com',
		earnProgramId: 'HGh7TcuqUbTRrFTYBUtsTctAEEmsANWnDxeWcbgqMg8b',
		stakingProgramId: 'CmKXHk3u6pDUC6Q11Le6gmhCgENQSFvduisXb7guUGoL',
		rwtMint: '8hJPUC4UNsiyBh5cosTA8RqY9TbBSmnxqkBb2sHJ5qzM',
		strwtMint: 'EnvY1tsk4SLMPi4uThXCk4dbagtRJ1WdaTFYPKDroNwy',
		usdcMint: '5rrpFYYVkwGMeTTCox3EE4VBNvkYMCQmxkYJhS9TA4Wx',
		earnConfigPda: 'H4DBeFKwZsVrhMmMFG7HSMEQckeCYdewuri28kQ3wT4p',
		stakingConfigPda: 'BWb75dNXbJbteLsmKy58sfHj8nYVa6CqaDzJrWo1mP1R',
		basketVault: 'B34MHTDgcgraY7zS8ezmDLoVJTA8y3CXUfzpfJ98mEFt',
		poolVault: 'C4VTQqr2f9wUDbXsfF7zawMvxoUvRVDgU3pMZuBYbhFN',
		daoFeeDestination: '7eU9YeiDsN7Riz1HzRRp9cenjRNbJZDZFdDMnPsLBKvd'
	},
	mainnet: {
		cluster: 'mainnet-beta',
		// Public mainnet RPC is heavily rate-limited; override with a private
		// endpoint via `VITE_RPC_URL` for production.
		rpcUrl: 'https://api.mainnet-beta.solana.com',
		earnProgramId: 'GTASb5UcQEkcRWuMwfoNABBBNJitdxWByobMLZZ2UCw8',
		stakingProgramId: '9tEKvDwkqkveBvmQfEzgPKWSNCDTGSSqYz4ZE6pP5DGY',
		rwtMint: 'RWTeFt9M635Tf6w6yveAoXQR2ZwfXs7MfA7W3grDuGT',
		strwtMint: 'sRWTy1bkqvRegb31RETanhbAtJ7eXN6XsTvaqBRh6kA',
		usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
		// EarnConfig / StakingConfig PDAs (seeds ["earn_config"] / ["staking_config"])
		// derived from the mainnet program IDs above.
		earnConfigPda: deriveConfigPda('earn_config', 'GTASb5UcQEkcRWuMwfoNABBBNJitdxWByobMLZZ2UCw8'),
		stakingConfigPda: deriveConfigPda(
			'staking_config',
			'9tEKvDwkqkveBvmQfEzgPKWSNCDTGSSqYz4ZE6pP5DGY'
		),
		basketVault: 'Ew8GFA29zsUXzf8dmDmesbHVCSfXVAVnPWYtr9nF3sqo',
		// poolVault — the on-chain StakingConfig.pool_vault RWT token account
		// (StakingConfig-PDA-owned, mint = RWTeFt9…), holding active + reserved RWT.
		// Sourced from StakingConfig at byte offset 169. The stake instruction marks
		// pool_vault writable, so this MUST be the real token account (not the
		// StakingConfig PDA) or Arlex rejects it ("'pool_vault' must be writable").
		poolVault: 'WtXa3NyQaiYdD6hJrDGkHcYyMKv722LqmPXij8hh2BT',
		// dao_fee_destination — the on-chain EarnConfig.dao_fee_destination USDC
		// token account (owned by the SPL Token program), the recipient of the 1%
		// mint fee. Must match the live EarnConfig or the earn program's owner-check
		// on dao_fee_destination rejects the mint.
		daoFeeDestination: '68AHfVCW4CJGCKxfUdLgj3WKe8qF8eSztmEd7VnPFYkg'
	}
};

/** Derive a config PDA (base58) from a seed + program ID. Used for mainnet PDAs. */
function deriveConfigPda(seed: string, programId: string): string {
	return PublicKey.findProgramAddressSync(
		[new TextEncoder().encode(seed)],
		new PublicKey(programId)
	)[0].toBase58();
}

const NET = PROFILES[NETWORK];

// ── RPC ──────────────────────────────────────────────────────────────────────

export const COMMITMENT: Commitment = 'confirmed';

/**
 * Base URL for the backend API / RPC proxy (e.g. `https://api.areal.finance`).
 * Empty string when unset. Defined here (above the faucet section that also
 * exports it) because the RPC precedence below needs it. The proxy exposes a
 * standard Solana JSON-RPC endpoint at `${FAUCET_API_BASE}/rpc`; the same base
 * also serves the devnet faucet (see the Faucet section).
 */
export const FAUCET_API_BASE: string =
	((import.meta.env.VITE_FAUCET_API_BASE as string | undefined) ?? '').trim() ||
	// Default to the live backend RPC proxy (api.areal.network, /api prefix →
	// JSON-RPC at /api/rpc). Hardcoded (like the Meteora pool) because the CF Pages
	// dashboard env var for this didn't reach the Vite build; the URL is public (no
	// secret). `VITE_FAUCET_API_BASE` overrides — local dev sets it via `.env`, so
	// this default only takes effect on the prod (CF, no `.env`) build.
	'https://api.areal.network/api';

/** Operator RPC override (private endpoint). Empty/undefined when unset. */
const RPC_URL_OVERRIDE: string = ((import.meta.env.VITE_RPC_URL as string) || '').trim();

/** The backend JSON-RPC proxy URL, or '' when no backend base is configured. */
const RPC_PROXY_URL: string = FAUCET_API_BASE ? `${FAUCET_API_BASE}/rpc` : '';

/**
 * PRIMARY RPC endpoint the `connection` talks to first. Precedence:
 *   1. `VITE_RPC_URL`       — explicit operator override wins.
 *   2. backend proxy        — `${FAUCET_API_BASE}/rpc` when a base is set.
 *   3. public cluster RPC   — the default when neither is configured.
 */
export const RPC_URL: string = RPC_URL_OVERRIDE || RPC_PROXY_URL || NET.rpcUrl;

/**
 * FALLBACK RPC endpoint — used only when the PRIMARY fails at the transport
 * level (network error / timeout, or 5xx/429 for idempotent reads). Always the
 * public cluster RPC, EXCEPT when the public RPC is already the primary (cases
 * where neither override nor proxy is set), in which case there is no distinct
 * fallback and this is `null` (preserving the original single-endpoint
 * behavior). See rpc.ts for the fallback gating (writes are never double-sent).
 */
export const RPC_URL_FALLBACK: string | null = RPC_URL === NET.rpcUrl ? null : NET.rpcUrl;

/**
 * Cluster the deployment lives on. The ONLY value that differs devnet↔mainnet
 * for the Meteora integration — the DLMM program ID is identical on both.
 * Passed to `DLMM.create(connection, pool, { cluster: CLUSTER })`.
 */
export const CLUSTER: Cluster = NET.cluster;

/**
 * Shared connection. Reused across reads so we don't churn sockets. Built with a
 * RESILIENT fetch: every JSON-RPC call hits `RPC_URL` first and transparently
 * fails over to `RPC_URL_FALLBACK` on transport failure (never on a valid
 * JSON-RPC error, and never double-sending a `sendTransaction`). The export
 * shape is unchanged — all callers import the same `connection`.
 */
export const connection = new Connection(RPC_URL, {
	commitment: COMMITMENT,
	fetch: makeResilientFetch(RPC_URL_FALLBACK)
});

/**
 * True when the deployment targets devnet. Used to gate devnet-only affordances
 * (e.g. the test-USDC faucet) so they never render on mainnet. Reuses the same
 * NETWORK constant the address profile keys off of.
 */
export const IS_DEVNET = NETWORK === 'devnet';

// ── Faucet (devnet-only, backend-served) ─────────────────────────────────────
//
// The faucet shares the backend base URL (`VITE_FAUCET_API_BASE`) injected at
// build time (see .env.example). When the base is unset the faucet is treated as
// unavailable and the affordance stays hidden — the rest of the app reads via
// the resilient RPC transport and is unaffected. (FaucetButton additionally
// gates on IS_DEVNET, so it never renders on mainnet regardless.)
//
// NOTE: `FAUCET_API_BASE` itself is exported up in the RPC section, because the
// RPC primary-precedence (proxy = `${FAUCET_API_BASE}/rpc`) depends on it. It is
// the single backend base for both the RPC proxy and the faucet endpoint.

// ── Program IDs ────────────────────────────────────────────────────────────────

export const EARN_PROGRAM_ID = new PublicKey(NET.earnProgramId);
export const STAKING_PROGRAM_ID = new PublicKey(NET.stakingProgramId);

// ── Mints (all 6 decimals) ─────────────────────────────────────────────────────

export const RWT_MINT = new PublicKey(NET.rwtMint);
export const STRWT_MINT = new PublicKey(NET.strwtMint);
export const USDC_MINT = new PublicKey(NET.usdcMint);

export const TOKEN_DECIMALS = 6;

// ── Config PDAs (precomputed; seeds documented for reference) ───────────────────

/** EarnConfig PDA — seed ["earn_config"]. */
export const EARN_CONFIG_PDA = new PublicKey(NET.earnConfigPda);
/** StakingConfig PDA — seed ["staking_config"]. */
export const STAKING_CONFIG_PDA = new PublicKey(NET.stakingConfigPda);

// ── Vaults / fee destinations ───────────────────────────────────────────────────

/** USDC basket vault (EarnConfig-PDA-owned) — receives the mint body. */
export const BASKET_VAULT = new PublicKey(NET.basketVault);
/** RWT pool vault (StakingConfig-PDA-owned) — active + reserved RWT. */
export const POOL_VAULT = new PublicKey(NET.poolVault);
/** USDC ATA receiving the 1% mint commission. */
export const DAO_FEE_DESTINATION = new PublicKey(NET.daoFeeDestination);

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
// The earn-RWT / USDC market is a Meteora DLMM pool. The DLMM program ID is
// IDENTICAL on devnet and mainnet, so only CLUSTER above changes between
// environments.
//
// TOKEN ORIENTATION IS NETWORK-DEPENDENT — do NOT hardcode it here. The two
// live pools have OPPOSITE token orders:
//   devnet  pool (5i3ipA3…): tokenX = USDC, tokenY = RWT
//   mainnet pool (Ca57q4Dh…): tokenX = RWT,  tokenY = USDC
// Because the order flips per network, the correct swap direction and price
// orientation can only be known by reading the pool's actual tokenX/tokenY
// mints at runtime. `meteora.ts` does exactly that (see `rwtIsX` there): it
// derives a single `rwtIsX` boolean from the live pool after `DLMM.create`,
// and keys swap direction (`swapForY`), price inversion, and leg selection off
// it. The `METEORA_TOKEN_X/Y` exports below are NOT a source of truth for
// orientation — they are only the candidate mint pair (in no fixed X/Y order);
// the runtime pool is authoritative.
//
// Both networks now have a LIVE RWT/USDC pool, hardcoded below as the per-network
// default. `VITE_METEORA_POOL` still overrides at build time (e.g. to point a
// build at a different pool). `HAS_METEORA_POOL` stays a guard — true whenever a
// pool is configured (always, now that both defaults exist) — and the swap
// surface checks it before constructing a real PublicKey.

/** DLMM on-chain program (devnet == mainnet). */
export const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

/** Live devnet RWT/USDC DLMM pool (tokenX = USDC, tokenY = RWT). */
const DEVNET_METEORA_POOL = '5i3ipA3AaXCJ7C2U7ZUoxUWQiZDUEU42ihwUGTMHvvkF';

/**
 * Live mainnet RWT/USDC DLMM pool (tokenX = RWT, tokenY = USDC). Discovered
 * on-chain via the DLMM program (getProgramAccounts by mint) and verified to
 * pair RWTeFt9…/EPjFW… (USDC), 2026-06-26 — matches the orientation note above.
 */
const MAINNET_METEORA_POOL = 'Ca57q4DhyQmX7ihBKyWuUtZts8sESRSNpFjjL9dtRKgd';

/**
 * Configured Meteora pool address (base58). `VITE_METEORA_POOL` overrides; else
 * the live per-network pool above. Not null now that both networks have a
 * deployed pool (kept as `| null` so `HAS_METEORA_POOL` stays a meaningful guard
 * and an explicit empty `VITE_METEORA_POOL` can still disable the swap surface).
 */
const METEORA_POOL_RAW: string | null =
	(import.meta.env.VITE_METEORA_POOL as string | undefined)?.trim() ||
	(IS_DEVNET ? DEVNET_METEORA_POOL : MAINNET_METEORA_POOL) ||
	null;

/**
 * Whether a Meteora pool is configured for the active network. Consumers MUST
 * check this before using `METEORA_POOL` on mainnet (pre-launch it is the
 * SystemProgram zero key, a sentinel that is never a real LB pair).
 */
export const HAS_METEORA_POOL = METEORA_POOL_RAW !== null;

/**
 * The RWT/USDC DLMM pool (LB pair). On mainnet pre-launch (no `VITE_METEORA_POOL`)
 * this is the all-zero SystemProgram key as a placeholder — guard with
 * `HAS_METEORA_POOL` before passing it to `DLMM.create`.
 */
export const METEORA_POOL = new PublicKey(METEORA_POOL_RAW ?? PublicKey.default.toBase58());
//
// NOTE: the names below are LEGACY and DO NOT imply a fixed X/Y orientation —
// the live pool's real order is network-dependent and read at runtime in
// `meteora.ts` (see the orientation note above). They are kept only because
// other modules import these symbols; each is just an alias of the underlying
// mint. `meteora.ts` no longer relies on them for swap-direction or pricing —
// it picks the in/out mints from the pool's actual `tokenX/tokenY`.
/** USDC mint (alias of USDC_MINT). NOT necessarily the pool's tokenX. */
export const METEORA_TOKEN_X = USDC_MINT;
/** earn-RWT mint (alias of RWT_MINT). NOT necessarily the pool's tokenY. */
export const METEORA_TOKEN_Y = RWT_MINT;
/** Pool bin step (25 bps) and base fee (30 bps) — for reference / display. */
export const METEORA_BIN_STEP_BPS = 25;
export const METEORA_BASE_FEE_BPS = 30;

/** Default sell slippage tolerance (bps) when the caller doesn't specify. */
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
