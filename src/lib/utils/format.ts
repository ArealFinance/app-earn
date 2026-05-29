/**
 * Pure formatting helpers — no side effects, no DOM.
 * Everything returns a string ready for display.
 */

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

const USD_COMPACT = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumFractionDigits: 1
});

/** Format USDC as a plain decimal string with thousand separators (no $ sign). */
export function formatUsdc(value: number, decimals = 2): string {
	if (!Number.isFinite(value)) return '0.00';
	return value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	});
}

/** Format RWT to 6 decimals (Solana SPL convention). */
export function formatRwt(value: number, decimals = 6): string {
	if (!Number.isFinite(value)) return '0.000000';
	return value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	});
}

/** Format a USD amount with the $ sign and thousand separators. */
export function formatUsd(value: number): string {
	if (!Number.isFinite(value)) return '$0.00';
	return USD_FORMATTER.format(value);
}

/** Compact USD for hero stats (`$10.0M`). */
export function formatUsdCompact(value: number): string {
	if (!Number.isFinite(value)) return '$0';
	return `$${USD_COMPACT.format(value)}`;
}

/** Format NAV as $X.XXXX (4 decimals — matches the brief). */
export function formatNav(value: number): string {
	if (!Number.isFinite(value)) return '$0.0000';
	return `$${value.toFixed(4)}`;
}

/** APR as `8.4%`. Pass a fraction (0.084), not a percentage. */
export function formatApr(value: number): string {
	if (!Number.isFinite(value)) return '0.0%';
	return `${(value * 100).toFixed(1)}%`;
}

/**
 * Shortens a Solana base58 address.
 * Default `4 / 4` matches the brief's `0x82A1…3K7C` style.
 */
export function shortenAddress(address: string, head = 4, tail = 4): string {
	if (!address || address.length <= head + tail + 1) return address;
	return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Signed delta string like `+0.04%` / `-0.12%`. Pass a fraction. */
export function formatPctDelta(value: number, decimals = 2): string {
	if (!Number.isFinite(value)) return '0.00%';
	const pct = value * 100;
	const sign = pct > 0 ? '+' : '';
	return `${sign}${pct.toFixed(decimals)}%`;
}

/** Signed USD delta like `+$0.32` / `-$1.20`. */
export function formatUsdDelta(value: number): string {
	if (!Number.isFinite(value)) return '$0.00';
	const sign = value > 0 ? '+' : value < 0 ? '-' : '';
	return `${sign}${USD_FORMATTER.format(Math.abs(value))}`;
}

/**
 * Format a token amount (RWT / stRWT) for display. Trims trailing zeros while
 * keeping thousand separators — e.g. `1,000`, `179.5`, `0.25`.
 */
export function formatTokenAmount(value: number, maxDecimals = 4): string {
	if (!Number.isFinite(value)) return '0';
	return value.toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: maxDecimals
	});
}

/** Format the stRWT → RWT exchange rate, e.g. `12.5`. */
export function formatRate(value: number): string {
	if (!Number.isFinite(value)) return '0';
	return value.toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 4
	});
}

/**
 * Whole days remaining until `unlockTs` (Unix ms). Floors to whole days;
 * returns 0 once the unlock time has passed.
 */
export function daysUntil(unlockTs: number): number {
	const ms = unlockTs - Date.now();
	if (ms <= 0) return 0;
	return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** True once a cooldown ticket has matured (unlock time reached). */
export function isMatured(unlockTs: number): boolean {
	return unlockTs - Date.now() <= 0;
}

/**
 * Human countdown label for a cooldown ticket: `12 days left`, `1 day left`,
 * or `Ready to claim` once matured.
 */
export function formatCountdown(unlockTs: number): string {
	const days = daysUntil(unlockTs);
	if (days <= 0) return 'Ready to claim';
	return `${days} day${days === 1 ? '' : 's'} left`;
}

/** Format a Unix-ms timestamp as a short date, e.g. `Jun 19`. */
export function formatUnlockDate(unlockTs: number): string {
	return new Date(unlockTs).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric'
	});
}
