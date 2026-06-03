/**
 * Earn-stats client — the second (read-only) backend dependency.
 *
 * Calls `GET {FAUCET_API_BASE}/earn/stats`, which returns real, on-chain-derived
 * vault stats: latest Book NAV / stRWT rate / TVL, an honest per-window APY
 * (annualised from actual rate-growth, or `null` when history is shorter than
 * the window), and a downsampled time-series for the portfolio sparkline.
 *
 * No secrets, no wallet: a GET goes out, a typed snapshot comes back. The
 * endpoint is public (every byte is already visible to anyone indexing chain
 * state). Mirrors the faucet client's defensive posture: ANY failure (base URL
 * unset, 404 = no snapshots yet, transport error, malformed body) resolves to
 * `null` so the UI degrades to a neutral "accumulating data…" state instead of
 * fabricating a number or crashing.
 *
 * `ts` arrives as an ISO-8601 string; callers parse to epoch-ms via `Date.parse`.
 */

import { FAUCET_API_BASE } from './config';

/** APY (ratio) per window; `null` when history is shorter than that window. */
export interface EarnApy {
	day: number | null;
	week: number | null;
	month: number | null;
}

/** One point on the earn time-series (oldest→newest in `history`). */
export interface EarnHistoryPoint {
	/** Snapshot timestamp, ISO-8601 (parse with `Date.parse`). */
	ts: string;
	/** Book NAV at this point (USD per RWT). */
	bookNav: number;
	/** stRWT→RWT rate at this point. */
	strwtRate: number;
}

/** Full earn-stats response — mirrors backend `EarnStatsResponseDto`. */
export interface EarnStats {
	bookNav: number;
	strwtRate: number;
	tvl: number;
	apy: EarnApy;
	history: EarnHistoryPoint[];
}

/** Window keys for the APY/period toggle (match `EarnApy` keys). */
export type StatsPeriod = 'day' | 'week' | 'month';

/** Narrows an unknown value to a finite number, else returns the fallback. */
function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** APY field: a finite number stays, anything else (incl. null) → null. */
function asApyField(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Best-effort, defensive parse of the raw JSON body into `EarnStats`. Untrusted
 * input: every field is coerced/validated rather than trusted. Returns `null`
 * if the shape is unusable (no object / no history array).
 */
function parseStats(raw: unknown): EarnStats | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;

	const rawHistory = Array.isArray(o.history) ? o.history : [];
	const history: EarnHistoryPoint[] = rawHistory
		.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
		.map((p) => ({
			ts: typeof p.ts === 'string' ? p.ts : '',
			bookNav: asNumber(p.bookNav),
			strwtRate: asNumber(p.strwtRate)
		}))
		// Drop points we couldn't timestamp — they can't be windowed.
		.filter((p) => p.ts !== '' && Number.isFinite(Date.parse(p.ts)));

	const apyRaw = (o.apy && typeof o.apy === 'object' ? o.apy : {}) as Record<string, unknown>;
	const apy: EarnApy = {
		day: asApyField(apyRaw.day),
		week: asApyField(apyRaw.week),
		month: asApyField(apyRaw.month)
	};

	return {
		bookNav: asNumber(o.bookNav),
		strwtRate: asNumber(o.strwtRate),
		tvl: asNumber(o.tvl),
		apy,
		history
	};
}

/**
 * Fetch the earn vault stats.
 *
 * Resolves to the parsed `EarnStats`, or `null` for EVERY non-success path:
 *   - base URL unset (stats backend unavailable in this environment)
 *   - 404 (endpoint up but no snapshots produced yet → "accumulating data…")
 *   - transport error (network/CORS/DNS)
 *   - any other non-2xx, or a malformed/unparseable body
 *
 * The caller never has to branch on the failure mode: a `null` always means
 * "fall back to the neutral accumulating-data state".
 */
export async function fetchEarnStats(): Promise<EarnStats | null> {
	if (!FAUCET_API_BASE) return null;

	let res: Response;
	try {
		res = await fetch(`${FAUCET_API_BASE}/earn/stats`, {
			method: 'GET',
			headers: { Accept: 'application/json' }
		});
	} catch {
		// Network / CORS / DNS — degrade silently to the neutral state.
		return null;
	}

	// 404 = no snapshots yet (distinct from transport error on the backend's
	// side, but the UI treats both identically: a neutral fallback).
	if (!res.ok) return null;

	let body: unknown;
	try {
		body = await res.json();
	} catch {
		return null;
	}

	return parseStats(body);
}
