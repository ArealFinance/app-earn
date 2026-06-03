<script lang="ts">
	/**
	 * Yield accent row: real window APY + absolute earned ($) over the window.
	 *
	 * Both are derived from the real `GET /earn/stats` time-series. When the
	 * history is shorter than the selected window, the value is `null` → we render
	 * "—" with an "accumulating data…" hint rather than a fabricated number.
	 */
	import { formatApr, formatUsdDelta } from '$lib/utils/format';
	import type { Period } from '$lib/earn/types';

	interface Props {
		/** Real window APY (fraction), or `null` while history is accumulating. */
		apy: number | null;
		/** Earned over the window (USD), or `null` while history is accumulating. */
		earnedUsd: number | null;
		/** Selected window — drives the caveat label. */
		period: Period;
	}

	let { apy, earnedUsd, period }: Props = $props();

	const windowLabel = $derived(
		period === 'day' ? '24h' : period === 'week' ? '7d' : '30d'
	);
</script>

<section class="yield" aria-label="Yield">
	<div class="cell">
		<span class="label">APY</span>
		{#if apy === null}
			<span class="value tabular muted">—</span>
			<span class="hint">accumulating data…</span>
		{:else}
			<span class="value tabular">{formatApr(apy)}</span>
		{/if}
	</div>
	<div class="cell">
		<span class="label">Earned ({windowLabel})</span>
		{#if earnedUsd === null}
			<span class="value tabular muted">—</span>
			<span class="hint">accumulating data…</span>
		{:else}
			<span
				class="value tabular"
				class:positive={earnedUsd > 0}
				class:negative={earnedUsd < 0}
			>
				{formatUsdDelta(earnedUsd)}
			</span>
		{/if}
	</div>
</section>
<p class="caveat">APY is annualised from realised rate growth — not a guarantee of future yield.</p>

<style>
	.yield {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		width: 100%;
	}

	.cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.label {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.value {
		font-family: var(--font-numeric);
		font-size: var(--text-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	/* Earned only: green for a gain, red for a loss (matches the main app's
	 * delta convention — rates/values stay white, signed deltas are tinted). */
	.value.positive {
		color: var(--color-success);
	}

	.value.negative {
		color: var(--color-danger);
	}

	.value.muted {
		color: var(--color-text-muted);
	}

	.hint {
		font-size: var(--text-2xs);
		color: var(--color-text-muted);
	}

	.caveat {
		margin-top: var(--space-2);
		font-size: var(--text-2xs);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
