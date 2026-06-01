/**
 * Devnet test-USDC faucet client.
 *
 * The single backend dependency in the app. Calls `POST /faucet/earn-usdc`,
 * which mints test earn-USDC to a wallet (and auto-drips ~0.05 SOL for fees if
 * the wallet's SOL balance is 0). Devnet/localnet only — on any other cluster
 * the endpoint 404s and we surface a typed "unavailable" error.
 *
 * No secrets, no keypairs: a wallet pubkey string goes in, a confirmed mint
 * signature comes out. See backend `FaucetController.claimEarnUsdc`.
 */

import { FAUCET_API_BASE } from './config';

/** Successful faucet claim — mirrors backend `FaucetClaimResponseDto`. */
export interface FaucetClaimResult {
	/** Confirmed mint transaction signature (base58). */
	signature: string;
	/** Recipient associated token account (base58). */
	ata: string;
	/** Drip amount in whole USDC. */
	amount: number;
}

/** Discriminable faucet error so the UI can branch (cooldown vs. unavailable). */
export type FaucetErrorKind = 'unavailable' | 'rate-limited' | 'invalid' | 'failed';

/**
 * Typed faucet error. `retryAfterSec` is only meaningful when
 * `kind === 'rate-limited'` (the cooldown window, in seconds).
 */
export class FaucetError extends Error {
	readonly kind: FaucetErrorKind;
	readonly retryAfterSec?: number;

	constructor(kind: FaucetErrorKind, message: string, retryAfterSec?: number) {
		super(message);
		this.name = 'FaucetError';
		this.kind = kind;
		this.retryAfterSec = retryAfterSec;
	}
}

/**
 * Request test earn-USDC for `wallet`. `amount` is whole USDC (backend default
 * 100, max 1000). Resolves to the confirmed claim, or throws a `FaucetError`:
 *
 *   - `unavailable`  — faucet base URL unset, or endpoint disabled (404, not devnet)
 *   - `rate-limited` — per-wallet 24h or per-IP 5/min cap hit (carries retryAfterSec)
 *   - `invalid`      — bad wallet/amount (400)
 *   - `failed`       — network error or any other non-2xx
 */
export async function requestEarnUsdc(
	wallet: string,
	amount?: number
): Promise<FaucetClaimResult> {
	if (!FAUCET_API_BASE) {
		throw new FaucetError('unavailable', 'Faucet is not available in this environment.');
	}

	const body: { wallet: string; amount?: number } = { wallet };
	if (typeof amount === 'number') body.amount = amount;

	let res: Response;
	try {
		res = await fetch(`${FAUCET_API_BASE}/faucet/earn-usdc`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		throw new FaucetError('failed', 'Could not reach the faucet. Check your connection.');
	}

	if (res.ok) {
		const data = (await res.json()) as FaucetClaimResult;
		return { signature: data.signature, ata: data.ata, amount: data.amount };
	}

	// Parse the error body once (best-effort — some errors have no JSON body).
	const errBody = await res.json().catch(() => null as unknown);

	if (res.status === 404) {
		throw new FaucetError('unavailable', 'Faucet is not available in this environment.');
	}

	if (res.status === 429) {
		// Per-wallet 24h limit returns `{ retryAfterSec }`; the per-IP throttler
		// may use `Retry-After` header instead. Prefer the body, fall back to header.
		const fromBody =
			errBody && typeof errBody === 'object' && 'retryAfterSec' in errBody
				? Number((errBody as { retryAfterSec: unknown }).retryAfterSec)
				: NaN;
		const fromHeader = Number(res.headers.get('Retry-After'));
		const retryAfterSec = Number.isFinite(fromBody)
			? fromBody
			: Number.isFinite(fromHeader)
				? fromHeader
				: undefined;
		throw new FaucetError('rate-limited', 'Faucet cooldown active.', retryAfterSec);
	}

	if (res.status === 400) {
		throw new FaucetError('invalid', 'Invalid faucet request.');
	}

	throw new FaucetError('failed', 'Faucet request failed. Please try again.');
}

/** Human cooldown label from a `retryAfterSec`, e.g. `23h`, `4 min`, `30s`. */
export function formatRetryAfter(retryAfterSec?: number): string {
	if (!retryAfterSec || !Number.isFinite(retryAfterSec) || retryAfterSec <= 0) {
		return 'a moment';
	}
	if (retryAfterSec >= 3600) return `${Math.ceil(retryAfterSec / 3600)}h`;
	if (retryAfterSec >= 60) return `${Math.ceil(retryAfterSec / 60)} min`;
	return `${Math.ceil(retryAfterSec)}s`;
}
