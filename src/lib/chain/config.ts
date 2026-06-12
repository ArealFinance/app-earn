/**
 * Network-driven chain configuration — the single source of truth for the live
 * `earn` + `staking` deployment the UI reads from.
 *
 * The active network is selected at BUILD time via `VITE_NETWORK` (one of
 * `devnet` | `mainnet`). Devnet is the DEFAULT — an unset/unknown value falls
 * back to devnet, so existing devnet builds are unchanged. Mainnet is additive
 * and switchable: set `VITE_NETWORK=mainnet` (and the launch-time pool address,
 * see METEORA_POOL below) to point the app at the mainnet deployment.
 *
 * No backend dependency: reads go straight to the public cluster RPC. The
 * public RPCs are rate-limited but fine for the V1 demo surface; override the
 * RPC URL per network via `VITE_RPC_URL` when a private endpoint is available.
 *
 * Export shape is UNCHANGED across networks: program IDs / mints / vaults are
 * `PublicKey` instances, scaling constants are `bigint`. Consumers
 * (`tx.ts`, `meteora.ts`, `reads.ts`, modals, …) import the same names and need
 * no per-network branching.
 */

import { Connection, PublicKey, type Cluster, type Commitment } from '@solana/web3.js';

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
 *             RWT/USDC pool does NOT exist on mainnet yet (created at launch),
 *             so it is intentionally absent here and sourced from
 *             `VITE_METEORA_POOL` at build time (see METEORA_POOL below, C1).
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
		// poolVault (StakingConfig-PDA-owned RWT ATA) is derived on-chain at init;
		// not yet published for mainnet. Fall back to the StakingConfig PDA as a
		// placeholder so the export shape holds — any consumer that needs the real
		// pool vault reads it from StakingConfig at runtime (reads.ts).
		poolVault: '9tEKvDwkqkveBvmQfEzgPKWSNCDTGSSqYz4ZE6pP5DGY',
		// dao_fee_destination (1% mint commission ATA) — read from EarnConfig on
		// chain; not separately published, placeholder = treasury/authority vault.
		daoFeeDestination: 'ApDQBVjwy47EAffSehF8k18orUbJaLSURVEdx95bV8oA'
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

/** Cluster RPC. Override with a private endpoint via `VITE_RPC_URL`. */
export const RPC_URL: string = (import.meta.env.VITE_RPC_URL as string) || NET.rpcUrl;
export const COMMITMENT: Commitment = 'confirmed';

/**
 * Cluster the deployment lives on. The ONLY value that differs devnet↔mainnet
 * for the Meteora integration — the DLMM program ID is identical on both.
 * Passed to `DLMM.create(connection, pool, { cluster: CLUSTER })`.
 */
export const CLUSTER: Cluster = NET.cluster;

/** Shared read-only connection. Reused across reads so we don't churn sockets. */
export const connection = new Connection(RPC_URL, COMMITMENT);

/**
 * True when the deployment targets devnet. Used to gate devnet-only affordances
 * (e.g. the test-USDC faucet) so they never render on mainnet. Reuses the same
 * NETWORK constant the address profile keys off of.
 */
export const IS_DEVNET = NETWORK === 'devnet';

// ── Faucet (devnet-only, backend-served) ─────────────────────────────────────
//
// The faucet is the ONLY backend dependency in the app. Its base URL is injected
// at build time via `VITE_FAUCET_API_BASE` (see .env.example). When unset the
// faucet is treated as unavailable and the affordance stays hidden — the rest of
// the app reads straight from RPC and is unaffected. (FaucetButton additionally
// gates on IS_DEVNET, so it never renders on mainnet regardless.)

/**
 * Base URL for the faucet API (e.g. `https://api.areal.finance`). Empty string
 * when unset → callers treat the faucet as unavailable. Never hardcode the base
 * in components; always source it from here.
 */
export const FAUCET_API_BASE: string = import.meta.env.VITE_FAUCET_API_BASE ?? '';

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
//   tokenX = USDC (6 dec)  → the quote leg
//   tokenY = RWT  (6 dec)  → the base leg
//
// A RWT→USDC sell is therefore a Y→X swap (swapForY = false). The active bin's
// price (X-per-Y) is USDC per RWT — the market price we surface.
//
// C1 (LAUNCH): the mainnet RWT/USDC pool DOES NOT EXIST yet — it is created at
// launch. There is NO hardcoded mainnet pool address; it is sourced from
// `VITE_METEORA_POOL` (a base58 LB-pair address) at build time. On devnet it
// defaults to the live devnet pool. `HAS_METEORA_POOL` is false when no pool is
// configured (e.g. mainnet pre-launch) so the swap surface can degrade
// gracefully instead of constructing an invalid PublicKey.

/** DLMM on-chain program (devnet == mainnet). */
export const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

/** Live devnet RWT/USDC DLMM pool — the default when `VITE_METEORA_POOL` is unset. */
const DEVNET_METEORA_POOL = '5i3ipA3AaXCJ7C2U7ZUoxUWQiZDUEU42ihwUGTMHvvkF';

/**
 * Configured Meteora pool address (base58), or `null` when none is set.
 *   - mainnet: ENTIRELY from `VITE_METEORA_POOL` — null until launch sets it.
 *   - devnet : `VITE_METEORA_POOL` if set, else the live devnet pool.
 */
const METEORA_POOL_RAW: string | null =
	(import.meta.env.VITE_METEORA_POOL as string | undefined)?.trim() ||
	(IS_DEVNET ? DEVNET_METEORA_POOL : null) ||
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
/** Pool tokenX — USDC, the quote leg. (Same as USDC_MINT; pinned for clarity.) */
export const METEORA_TOKEN_X = USDC_MINT;
/** Pool tokenY — earn-RWT, the base leg. (Same as RWT_MINT; pinned for clarity.) */
export const METEORA_TOKEN_Y = RWT_MINT;
/** Pool bin step (25 bps) and base fee (30 bps) — for reference / display. */
export const METEORA_BIN_STEP_BPS = 25;
export const METEORA_BASE_FEE_BPS = 30;

/** Default sell slippage tolerance (bps) when the caller doesn't specify. */
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
