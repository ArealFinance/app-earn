/**
 * Pure derivations over the REAL earn time-series (`EarnStats.history`).
 *
 * These replace the synthetic mock figures: every output here is computed from
 * actual on-chain-derived snapshots × the user's CURRENT holdings. No side
 * effects, no DOM — easy to reason about and to unit-test.
 *
 * The honesty contract: whenever the available history is shorter than the
 * requested window (so we can't anchor a "start" point), the windowed helpers
 * return `null`. Callers render "—" + "accumulating data…", never a fabricated
 * value.
 */

import type { EarnHistoryPoint, EarnStats, StatsPeriod } from '$lib/chain/stats';

/** Window length in days, keyed by period. */
export const PERIOD_DAYS: Record<StatsPeriod, number> = { day: 1, week: 7, month: 30 };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Human hint for a window whose metric isn't ready yet — e.g.
 * `"available in ~6 days"`. Estimated from how much snapshot history exists
 * (`historyStartMs` = epoch-ms of the OLDEST snapshot) versus the window length:
 * a window becomes computable once history spans its full length.
 *
 * Falls back to `"building history…"` when we can't estimate — no history yet,
 * the stats endpoint is unreachable, or the window should already be ready.
 */
export function accumulatingHint(
	historyStartMs: number | null,
	period: StatsPeriod,
	nowMs: number
): string {
	if (historyStartMs === null || !Number.isFinite(historyStartMs)) {
		return 'building history…';
	}
	const elapsedDays = (nowMs - historyStartMs) / DAY_MS;
	const remaining = Math.ceil(PERIOD_DAYS[period] - elapsedDays);
	if (remaining <= 0) return 'building history…';
	return `available in ~${remaining} day${remaining === 1 ? '' : 's'}`;
}

/** Current user holdings used to value the series. */
export interface Holdings {
	/** Liquid RWT. */
	rwt: number;
	/** stRWT (staking shares). */
	strwt: number;
}

/**
 * Value the user's CURRENT holdings against a single history point's rate/NAV:
 *
 *   value = strwt × point.strwtRate × point.bookNav + rwt × point.bookNav
 *
 * i.e. "what would my holdings be worth if the rate and NAV were those of this
 * point". This is honest: it needs no per-user history, only the protocol
 * series and the holdings we already read on-chain.
 */
export function valueAtPoint(holdings: Holdings, point: EarnHistoryPoint): number {
	return holdings.strwt * point.strwtRate * point.bookNav + holdings.rwt * point.bookNav;
}

/** Value holdings against an explicit (rate, nav) pair — e.g. the live reads. */
export function valueAt(holdings: Holdings, strwtRate: number, bookNav: number): number {
	return holdings.strwt * strwtRate * bookNav + holdings.rwt * bookNav;
}

/**
 * The history point at/just-before `now − windowDays`, used as the window's
 * "start" anchor. Returns `null` when no point is old enough (history shorter
 * than the window) — the honesty guard.
 *
 * `history` is oldest→newest. We walk from the newest backwards and take the
 * first point whose ts is ≤ the window-start cutoff (the point at-or-before it).
 */
export function windowStartPoint(
	history: EarnHistoryPoint[],
	windowDays: number,
	nowMs: number = Date.now()
): EarnHistoryPoint | null {
	if (history.length < 2) return null;
	const cutoff = nowMs - windowDays * DAY_MS;
	for (let i = history.length - 1; i >= 0; i -= 1) {
		if (Date.parse(history[i].ts) <= cutoff) return history[i];
	}
	// No point is older than the cutoff → history doesn't span the window.
	return null;
}

/** The most-recent history point, or `null` for an empty series. */
export function latestPoint(history: EarnHistoryPoint[]): EarnHistoryPoint | null {
	return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * EARNED ($) over the window on the user's CURRENT holdings:
 *
 *   earned = strwt × (rate_now − rate_start) × bookNav_now
 *          + rwt   × (bookNav_now − bookNav_start)
 *
 * `*_now` come from the LIVE reads (passed in) so the figure matches the
 * headline total; `*_start` from the window-start history anchor. Returns
 * `null` when the history is shorter than the window (no anchor) — render "—".
 */
export function earnedOverWindow(
	holdings: Holdings,
	history: EarnHistoryPoint[],
	period: StatsPeriod,
	rateNow: number,
	bookNavNow: number,
	nowMs: number = Date.now()
): number | null {
	const start = windowStartPoint(history, PERIOD_DAYS[period], nowMs);
	if (!start) return null;

	const earned =
		holdings.strwt * (rateNow - start.strwtRate) * bookNavNow +
		holdings.rwt * (bookNavNow - start.bookNav);

	return Number.isFinite(earned) ? earned : null;
}

/**
 * Fractional change of portfolio value over the window:
 *   (value_now / value_start − 1)
 *
 * Valued on CURRENT holdings at each end (start NAV/rate vs. live NAV/rate).
 * Returns `null` when there's no window anchor or the start value is 0 (e.g. the
 * user holds nothing) — caller neutralises the delta.
 */
export function changePctOverWindow(
	holdings: Holdings,
	history: EarnHistoryPoint[],
	period: StatsPeriod,
	rateNow: number,
	bookNavNow: number,
	nowMs: number = Date.now()
): number | null {
	const start = windowStartPoint(history, PERIOD_DAYS[period], nowMs);
	if (!start) return null;

	const valueStart = valueAtPoint(holdings, start);
	const valueNow = valueAt(holdings, rateNow, bookNavNow);
	if (!(valueStart > 0)) return null;

	const pct = valueNow / valueStart - 1;
	return Number.isFinite(pct) ? pct : null;
}

/**
 * Build the sparkline series (numbers) for the selected window, valuing each
 * history point's rate/NAV against the given holdings.
 *
 * `hasHoldings` decides what we plot:
 *   - holdings present → the user's portfolio-value series (real, personal)
 *   - no holdings / not connected → the protocol NAV series, so the chart still
 *     shows the vault's real trajectory instead of a flat/empty line
 *
 * The window is applied by including every point newer than `now − windowDays`,
 * plus the one anchor point at-or-before the cutoff (so the line starts at the
 * window edge rather than mid-window). Returns the numeric series oldest→newest.
 */
export function buildSeries(
	holdings: Holdings,
	history: EarnHistoryPoint[],
	period: StatsPeriod,
	nowMs: number = Date.now()
): number[] {
	if (history.length === 0) return [];

	const cutoff = nowMs - PERIOD_DAYS[period] * DAY_MS;

	// Find the index of the anchor (last point at-or-before the cutoff); include
	// it so the series spans the full window edge. If none is old enough, start
	// from the oldest point we have.
	let anchorIdx = 0;
	for (let i = history.length - 1; i >= 0; i -= 1) {
		if (Date.parse(history[i].ts) <= cutoff) {
			anchorIdx = i;
			break;
		}
	}

	const windowed = history.slice(anchorIdx);
	const hasHoldings = holdings.rwt > 0 || holdings.strwt > 0;

	return windowed.map((p) => (hasHoldings ? valueAtPoint(holdings, p) : p.bookNav));
}

/**
 * Pick the headline APY: prefer `month`, fall back to `week`, then `day`.
 * Returns `null` when every window is still accumulating data.
 */
export function headlineApy(apy: EarnStats['apy']): number | null {
	return apy.month ?? apy.week ?? apy.day ?? null;
}
