/**
 * Unit tests for earn derivation math (derive.ts).
 *
 * Tests cover pure-function computations over EarnStats time-series:
 * - Window-anchored metrics (earnedOverWindow, changePctOverWindow, buildSeries)
 * - Point-based valuations (valueAt, valueAtPoint)
 * - Edge cases: empty history, single point, out-of-window, flat rate/NAV, zero holdings
 * - Boundary conditions: float tolerance, null guards, NaN/Infinity filtering
 *
 * These are characterization tests — they capture CURRENT behavior.
 * Any behavioral regression will surface as a test failure.
 */

import { describe, it, expect } from 'vitest';
import type { EarnHistoryPoint } from '$lib/chain/stats';
import type { Holdings } from './derive';
import {
	valueAtPoint,
	valueAt,
	windowStartPoint,
	latestPoint,
	earnedOverWindow,
	changePctOverWindow,
	buildSeries,
	headlineApy,
	PERIOD_DAYS
} from './derive';

// ─────────────────────────────────────────────────────────────────────
// Test data & helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Create an EarnHistoryPoint with sensible defaults.
 * `offsetDaysAgo` is used to derive the ISO timestamp (relative to `now`).
 */
function point(
	offsetDaysAgo: number,
	bookNav: number,
	strwtRate: number,
	now: number = Date.now()
): EarnHistoryPoint {
	const tsMs = now - offsetDaysAgo * 24 * 60 * 60 * 1000;
	return {
		ts: new Date(tsMs).toISOString(),
		bookNav,
		strwtRate
	};
}

/** Holdings with only RWT. */
function rwtOnly(amount: number): Holdings {
	return { rwt: amount, strwt: 0 };
}

/** Holdings with only stRWT. */
function strwtOnly(amount: number): Holdings {
	return { rwt: 0, strwt: amount };
}

/** Holdings with both. */
function both(rwt: number, strwt: number): Holdings {
	return { rwt, strwt };
}

// ─────────────────────────────────────────────────────────────────────
// valueAt / valueAtPoint
// ─────────────────────────────────────────────────────────────────────

describe('valueAt & valueAtPoint', () => {
	it('valueAtPoint: RWT only', () => {
		const holdings = rwtOnly(100);
		const p = point(0, 1.5, 1.0);
		// value = 0 * 1.0 * 1.5 + 100 * 1.5 = 150
		expect(valueAtPoint(holdings, p)).toBe(150);
	});

	it('valueAtPoint: stRWT only', () => {
		const holdings = strwtOnly(50);
		const p = point(0, 2.0, 0.8);
		// value = 50 * 0.8 * 2.0 + 0 * 2.0 = 80
		expect(valueAtPoint(holdings, p)).toBe(80);
	});

	it('valueAtPoint: mixed holdings', () => {
		const holdings = both(100, 50);
		const p = point(0, 2.0, 0.8);
		// value = 50 * 0.8 * 2.0 + 100 * 2.0 = 80 + 200 = 280
		expect(valueAtPoint(holdings, p)).toBe(280);
	});

	it('valueAt: explicit rate and nav', () => {
		const holdings = both(100, 50);
		// value = 50 * 0.8 * 2.0 + 100 * 2.0 = 80 + 200 = 280
		expect(valueAt(holdings, 0.8, 2.0)).toBe(280);
	});

	it('valueAt: zero holdings', () => {
		const holdings = both(0, 0);
		expect(valueAt(holdings, 0.8, 2.0)).toBe(0);
	});

	it('valueAt: high precision nav', () => {
		const holdings = rwtOnly(1000);
		const nav = 1.123456789;
		// Exact multiplication — no rounding
		expect(valueAt(holdings, 1.0, nav)).toBe(1000 * nav);
	});
});

// ─────────────────────────────────────────────────────────────────────
// windowStartPoint
// ─────────────────────────────────────────────────────────────────────

describe('windowStartPoint', () => {
	it('returns the point at-or-before the cutoff', () => {
		const now = 1000 * 24 * 60 * 60 * 1000; // 1000 days from epoch
		const history = [
			point(100, 1.0, 1.0, now), // 900 days ago (very old)
			point(50, 1.1, 1.0, now),  // 950 days ago (very old)
			point(10, 1.2, 1.0, now),  // 990 days ago (very old)
			point(0, 1.3, 1.0, now)    // now
		];

		// Window: 7 days. Cutoff = now - 7 days.
		// Walking backwards: point(0) is AFTER cutoff, point(10) is BEFORE cutoff (at 990 days ago).
		// So we return point(10).
		const start = windowStartPoint(history, 7, now);
		expect(start?.bookNav).toBe(1.2); // point at 10 days ago
	});

	it('returns null when history is empty', () => {
		const start = windowStartPoint([], 7);
		expect(start).toBeNull();
	});

	it('returns null when history has only 1 point', () => {
		const now = Date.now();
		const history = [point(0, 1.0, 1.0, now)];
		const start = windowStartPoint(history, 7, now);
		expect(start).toBeNull();
	});

	it('returns null when all points are newer than the window', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(5, 1.0, 1.0, now),  // 5 days ago
			point(3, 1.1, 1.0, now),  // 3 days ago
			point(0, 1.2, 1.0, now)   // now
		];

		// Window: 30 days. Cutoff = now - 30 days. All points are within the window.
		const start = windowStartPoint(history, 30, now);
		expect(start).toBeNull();
	});

	it('walks backward and returns the first (newest) point at-or-before cutoff', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(100, 1.0, 1.0, now), // Oldest
			point(50, 1.1, 1.0, now),
			point(8, 1.2, 1.0, now),   // Just before the 7-day cutoff
			point(6, 1.3, 1.0, now),   // Within window
			point(0, 1.4, 1.0, now)    // Newest
		];

		// Window: 7 days. Should return the point at 8 days (first at-or-before cutoff).
		const start = windowStartPoint(history, 7, now);
		expect(start?.bookNav).toBe(1.2);
	});
});

// ─────────────────────────────────────────────────────────────────────
// latestPoint
// ─────────────────────────────────────────────────────────────────────

describe('latestPoint', () => {
	it('returns the last point in the history', () => {
		const history = [
			point(100, 1.0, 1.0),
			point(50, 1.1, 1.0),
			point(0, 1.2, 1.0)
		];
		const latest = latestPoint(history);
		expect(latest?.bookNav).toBe(1.2);
	});

	it('returns null for empty history', () => {
		expect(latestPoint([])).toBeNull();
	});

	it('returns the single point if history has length 1', () => {
		const history = [point(0, 1.5, 1.0)];
		const latest = latestPoint(history);
		expect(latest?.bookNav).toBe(1.5);
	});
});

// ─────────────────────────────────────────────────────────────────────
// earnedOverWindow
// ─────────────────────────────────────────────────────────────────────

describe('earnedOverWindow', () => {
	it('computes earned on RWT holdings over the period', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now), // 30 days ago
			point(0, 1.1, 1.0, now)   // now
		];
		const holdings = rwtOnly(100);

		// Window: month (30 days). Anchor = point(30).
		// earned = strwt * (rate_now - rate_start) * nav_now
		//        + rwt * (nav_now - nav_start)
		//        = 0 * (1.0 - 1.0) * 1.1 + 100 * (1.1 - 1.0)
		//        = 0 + 100 * 0.1 = 10
		const earned = earnedOverWindow(holdings, history, 'month', 1.0, 1.1, now);
		expect(earned).toBeCloseTo(10, 10);
	});

	it('computes earned on stRWT holdings over the period', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(7, 1.0, 0.8, now), // 7 days ago
			point(0, 1.0, 0.9, now)  // now
		];
		const holdings = strwtOnly(100);

		// Window: week (7 days). Anchor = point(7).
		// earned = strwt * (rate_now - rate_start) * nav_now
		//        + rwt * (nav_now - nav_start)
		//        = 100 * (0.9 - 0.8) * 1.0 + 0 * (1.0 - 1.0)
		//        = 100 * 0.1 * 1.0 = 10
		const earned = earnedOverWindow(holdings, history, 'week', 0.9, 1.0, now);
		expect(earned).toBeCloseTo(10, 10);
	});

	it('computes earned on mixed holdings', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 0.8, now),
			point(0, 1.2, 0.9, now)
		];
		const holdings = both(100, 50);

		// earned = 50 * (0.9 - 0.8) * 1.2 + 100 * (1.2 - 1.0)
		//        = 50 * 0.1 * 1.2 + 100 * 0.2
		//        = 6 + 20 = 26
		const earned = earnedOverWindow(holdings, history, 'month', 0.9, 1.2, now);
		expect(earned).toBeCloseTo(26, 10);
	});

	it('returns null when history is shorter than the window', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [point(10, 1.0, 1.0, now)]; // Only 10 days, window is 30 days
		const holdings = rwtOnly(100);

		const earned = earnedOverWindow(holdings, history, 'month', 1.0, 1.1, now);
		expect(earned).toBeNull();
	});

	it('returns 0 when rate and NAV are flat', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 1.0, 1.0, now)
		];
		const holdings = both(100, 50);

		const earned = earnedOverWindow(holdings, history, 'month', 1.0, 1.0, now);
		expect(earned).toBe(0);
	});

	it('returns null for non-finite earned value', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 1.0, 1.0, now)
		];
		const holdings = rwtOnly(100);

		// Passing Infinity as rateNow to trigger NaN in earned calculation
		// (Infinity - number is still Infinity, but let's test NaN explicitly)
		const earned = earnedOverWindow(holdings, history, 'month', NaN, 1.0, now);
		expect(earned).toBeNull();
	});

	it('handles negative earned (loss scenario)', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 0.9, 0.9, now) // Both rate and NAV decreased
		];
		const holdings = both(100, 100);

		// earned = 100 * (0.9 - 1.0) * 0.9 + 100 * (0.9 - 1.0)
		//        = 100 * (-0.1) * 0.9 + 100 * (-0.1)
		//        = -9 + (-10) = -19
		const earned = earnedOverWindow(holdings, history, 'month', 0.9, 0.9, now);
		expect(earned).toBeCloseTo(-19, 10);
	});
});

// ─────────────────────────────────────────────────────────────────────
// changePctOverWindow
// ─────────────────────────────────────────────────────────────────────

describe('changePctOverWindow', () => {
	it('computes fractional change over a period', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 1.1, 1.0, now)
		];
		const holdings = rwtOnly(100);

		// value_start = valueAtPoint(holdings, history[0]) = 0 * 1.0 * 1.0 + 100 * 1.0 = 100
		// value_now = valueAt(holdings, 1.0, 1.1) = 0 * 1.0 * 1.1 + 100 * 1.1 = 110
		// pct = 110 / 100 - 1 = 1.1 - 1 = 0.1 (10%)
		const pct = changePctOverWindow(holdings, history, 'month', 1.0, 1.1, now);
		expect(pct).toBeCloseTo(0.1, 10);
	});

	it('returns null when start value is zero', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 2.0, 1.0, now)
		];
		const holdings = both(0, 0); // No holdings

		const pct = changePctOverWindow(holdings, history, 'month', 1.0, 2.0, now);
		expect(pct).toBeNull();
	});

	it('returns null when no window anchor exists', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [point(10, 1.0, 1.0, now)]; // Only 10 days, window is 30 days
		const holdings = rwtOnly(100);

		const pct = changePctOverWindow(holdings, history, 'month', 1.0, 1.5, now);
		expect(pct).toBeNull();
	});

	it('returns null for non-finite pct value', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 1.0, 1.0, now)
		];
		const holdings = rwtOnly(100);

		// Passing Infinity to trigger non-finite result
		const pct = changePctOverWindow(holdings, history, 'month', Infinity, 1.0, now);
		expect(pct).toBeNull();
	});

	it('handles negative change (loss)', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 0.8, 1.0, now)
		];
		const holdings = rwtOnly(100);

		// value_start = 100
		// value_now = 100 * 0.8 = 80
		// pct = 80/100 - 1 = -0.2 (-20%)
		const pct = changePctOverWindow(holdings, history, 'month', 1.0, 0.8, now);
		expect(pct).toBeCloseTo(-0.2, 10);
	});

	it('handles large positive change', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 5.0, 1.0, now)
		];
		const holdings = rwtOnly(100);

		// value_start = 100
		// value_now = 500
		// pct = 500/100 - 1 = 4.0 (400%)
		const pct = changePctOverWindow(holdings, history, 'month', 1.0, 5.0, now);
		expect(pct).toBeCloseTo(4.0, 10);
	});
});

// ─────────────────────────────────────────────────────────────────────
// buildSeries
// ─────────────────────────────────────────────────────────────────────

describe('buildSeries', () => {
	it('builds a portfolio-value series when holdings present', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(15, 1.1, 1.0, now),
			point(0, 1.2, 1.0, now)
		];
		const holdings = rwtOnly(100);

		// Window: month (30 days). Anchor includes point(30).
		// Series: valueAtPoint(holdings, point(30)), valueAtPoint(..., point(15)), valueAtPoint(..., point(0))
		const series = buildSeries(holdings, history, 'month', now);

		expect(series.length).toBe(3);
		expect(series[0]).toBeCloseTo(100, 10); // 100 * 1.0
		expect(series[1]).toBeCloseTo(110, 10); // 100 * 1.1
		expect(series[2]).toBeCloseTo(120, 10); // 100 * 1.2
	});

	it('builds a NAV series when no holdings', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(15, 1.1, 1.0, now),
			point(0, 1.2, 1.0, now)
		];
		const holdings = both(0, 0);

		const series = buildSeries(holdings, history, 'month', now);

		expect(series.length).toBe(3);
		expect(series[0]).toBe(1.0);
		expect(series[1]).toBe(1.1);
		expect(series[2]).toBe(1.2);
	});

	it('returns empty array for empty history', () => {
		const holdings = rwtOnly(100);
		const series = buildSeries(holdings, [], 'month');

		expect(series).toEqual([]);
	});

	it('includes the anchor point at the window boundary', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(35, 1.0, 1.0, now), // Older than the window
			point(25, 1.1, 1.0, now), // Within window
			point(5, 1.2, 1.0, now),  // Within window
			point(0, 1.3, 1.0, now)   // Now
		];
		const holdings = rwtOnly(100);

		// Window: month (30 days). Anchor = point(35) (first at-or-before cutoff).
		// Series should include point(35), 25, 5, 0.
		const series = buildSeries(holdings, history, 'month', now);

		expect(series.length).toBe(4);
		expect(series[0]).toBeCloseTo(100, 10); // point(35), nav=1.0
		expect(series[1]).toBeCloseTo(110, 10); // point(25), nav=1.1
		expect(series[2]).toBeCloseTo(120, 10); // point(5), nav=1.2
		expect(series[3]).toBeCloseTo(130, 10); // point(0), nav=1.3
	});

	it('slices window correctly for week period', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now), // Older than 7-day window
			point(8, 1.1, 1.0, now),  // Just before cutoff (7 days)
			point(5, 1.2, 1.0, now),  // Within week
			point(0, 1.3, 1.0, now)   // Now
		];
		const holdings = rwtOnly(100);

		// Window: week (7 days). Anchor = point(8).
		const series = buildSeries(holdings, history, 'week', now);

		expect(series.length).toBe(3);
		expect(series[0]).toBeCloseTo(110, 10); // point(8)
		expect(series[1]).toBeCloseTo(120, 10); // point(5)
		expect(series[2]).toBeCloseTo(130, 10); // point(0)
	});

	it('handles day window (single-day series)', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(5, 1.0, 1.0, now),   // Older
			point(0.5, 1.05, 1.0, now), // Within 1 day
			point(0, 1.1, 1.0, now)   // Now
		];
		const holdings = rwtOnly(100);

		// Window: day (1 day). Only recent points + anchor.
		const series = buildSeries(holdings, history, 'day', now);

		// Should include point(0.5) and point(0) — both within 1 day.
		// Anchor is point(0.5) (last at-or-before the cutoff).
		expect(series.length).toBeGreaterThanOrEqual(2);
		expect(series[series.length - 1]).toBeCloseTo(110, 10); // Latest (now)
	});

	it('preserves series order (oldest to newest)', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(20, 1.1, 1.0, now),
			point(10, 1.2, 1.0, now),
			point(0, 1.3, 1.0, now)
		];
		const holdings = rwtOnly(100);

		const series = buildSeries(holdings, history, 'month', now);

		// Series should be monotonically mapped from history
		for (let i = 0; i < series.length; i++) {
			expect(series[i]).toBe(100 * history[i].bookNav);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────
// headlineApy
// ─────────────────────────────────────────────────────────────────────

describe('headlineApy', () => {
	it('prefers month when available', () => {
		const apy = { day: 0.05, week: 0.06, month: 0.07 };
		expect(headlineApy(apy)).toBe(0.07);
	});

	it('falls back to week when month is null', () => {
		const apy = { day: 0.05, week: 0.06, month: null };
		expect(headlineApy(apy)).toBe(0.06);
	});

	it('falls back to day when week and month are null', () => {
		const apy = { day: 0.05, week: null, month: null };
		expect(headlineApy(apy)).toBe(0.05);
	});

	it('returns null when all windows are accumulating data', () => {
		const apy = { day: null, week: null, month: null };
		expect(headlineApy(apy)).toBeNull();
	});

	it('prioritizes month over week and day', () => {
		const apy = { day: 1.0, week: 0.5, month: 0.1 };
		expect(headlineApy(apy)).toBe(0.1); // month, not week or day
	});

	it('handles zero APY values correctly', () => {
		const apy = { day: null, week: null, month: 0 };
		expect(headlineApy(apy)).toBe(0);
	});

	it('handles negative APY values (loss)', () => {
		const apy = { day: null, week: -0.02, month: null };
		expect(headlineApy(apy)).toBe(-0.02);
	});
});

// ─────────────────────────────────────────────────────────────────────
// PERIOD_DAYS constant
// ─────────────────────────────────────────────────────────────────────

describe('PERIOD_DAYS', () => {
	it('defines correct window lengths', () => {
		expect(PERIOD_DAYS.day).toBe(1);
		expect(PERIOD_DAYS.week).toBe(7);
		expect(PERIOD_DAYS.month).toBe(30);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Integration-style scenarios
// ─────────────────────────────────────────────────────────────────────

describe('Integration scenarios', () => {
	it('full flow: build series + compute earned + change pct for month', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 0.8, now),
			point(15, 1.05, 0.85, now),
			point(0, 1.1, 0.9, now)
		];
		const holdings = both(100, 50);

		// Live reads
		const rateNow = 0.9;
		const navNow = 1.1;

		// Build series
		const series = buildSeries(holdings, history, 'month', now);
		expect(series.length).toBe(3);
		expect(series[0]).toBeCloseTo(50 * 0.8 * 1.0 + 100 * 1.0, 5); // 130
		expect(series[1]).toBeCloseTo(50 * 0.85 * 1.05 + 100 * 1.05, 5); // 146.625
		expect(series[2]).toBeCloseTo(50 * 0.9 * 1.1 + 100 * 1.1, 5); // 159.5

		// Compute earned
		const earned = earnedOverWindow(holdings, history, 'month', rateNow, navNow, now);
		expect(earned).not.toBeNull();
		expect(earned).toBeGreaterThan(0); // Rate and NAV increased

		// Compute change %
		const changePct = changePctOverWindow(holdings, history, 'month', rateNow, navNow, now);
		expect(changePct).not.toBeNull();
		expect(changePct).toBeGreaterThan(0);
	});

	it('handles degraded state: history too short, render nulls gracefully', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [point(5, 1.0, 1.0, now)]; // Only 5 days old
		const holdings = both(100, 50);

		// Try to compute month metrics — should all return null
		const earned = earnedOverWindow(holdings, history, 'month', 1.1, 1.1, now);
		const changePct = changePctOverWindow(holdings, history, 'month', 1.1, 1.1, now);

		expect(earned).toBeNull();
		expect(changePct).toBeNull();

		// Series can still render the few points we have
		const series = buildSeries(holdings, history, 'month', now);
		expect(series.length).toBeGreaterThan(0);
	});

	it('zero holdings still produce valid NAV series', () => {
		const now = 1000 * 24 * 60 * 60 * 1000;
		const history = [
			point(30, 1.0, 1.0, now),
			point(0, 1.5, 1.0, now)
		];
		const holdings = both(0, 0);

		const series = buildSeries(holdings, history, 'month', now);
		expect(series.length).toBe(2);
		expect(series[0]).toBe(1.0);
		expect(series[1]).toBe(1.5);

		// Earned and change metrics should be null (no holdings to value)
		const earned = earnedOverWindow(holdings, history, 'month', 1.0, 1.5, now);
		const changePct = changePctOverWindow(holdings, history, 'month', 1.0, 1.5, now);

		expect(earned).not.toBeNull(); // Earned CAN be computed (just 0)
		expect(changePct).toBeNull(); // changePct is null because value_start is 0
	});
});
