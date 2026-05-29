<script lang="ts">
	/**
	 * Portfolio header — the main accent of the dashboard.
	 *
	 *   total value (USD)  +  period change (toggle: day / week / month)
	 *   sparkline of value over the selected window.
	 *
	 * The parent owns the data and the selected period; this component emits the
	 * period change and renders. Sparkline data is derived from the chosen window.
	 */
	import { TrendingUp, TrendingDown } from 'lucide-svelte';
	import AnimatedNumber from './AnimatedNumber.svelte';
	import Sparkline from './Sparkline.svelte';
	import { formatPctDelta } from '$lib/utils/format';
	import type { Period, PortfolioPoint } from '$lib/earn/types';

	interface Props {
		/** Current total portfolio value (USD). */
		totalValue: number;
		/** Fractional change over the selected period (e.g. 0.083). */
		changePct: number;
		/** Selected period. */
		period: Period;
		/** History points for the sparkline (already scoped to the period). */
		history: PortfolioPoint[];
		/** Called when the user picks a different period. */
		onPeriodChange: (period: Period) => void;
	}

	let { totalValue, changePct, period, history, onPeriodChange }: Props = $props();

	const PERIODS: Array<{ id: Period; label: string }> = [
		{ id: 'day', label: '1D' },
		{ id: 'week', label: '1W' },
		{ id: 'month', label: '30D' }
	];

	const isUp = $derived(changePct >= 0);
	const periodLabel = $derived(
		period === 'day' ? '24h' : period === 'week' ? '7d' : '30d'
	);
	const values = $derived(history.map((p) => p.value));
</script>

<section class="portfolio" aria-label="Portfolio value">
	<header class="head">
		<span class="label">Portfolio</span>
	</header>

	<div class="value-row">
		<span class="total tabular">
			$<AnimatedNumber value={totalValue} decimals={2} durationMs={800} easing="easeOutCubic" />
		</span>
	</div>

	<div class="change-row">
		<span class="delta" class:up={isUp} class:down={!isUp}>
			{#if isUp}
				<TrendingUp size={15} aria-hidden="true" />
			{:else}
				<TrendingDown size={15} aria-hidden="true" />
			{/if}
			<span class="tabular">{formatPctDelta(changePct, 1)}</span>
			<span class="period-tag">({periodLabel})</span>
		</span>
	</div>

	{#if values.length >= 2}
		<Sparkline {values} label="Portfolio value over {periodLabel}" />
	{/if}

	<div class="period-toggle" role="group" aria-label="Select period">
		{#each PERIODS as p (p.id)}
			<button
				type="button"
				class="period-btn"
				class:active={p.id === period}
				aria-pressed={p.id === period}
				onclick={() => onPeriodChange(p.id)}
			>
				{p.label}
			</button>
		{/each}
	</div>
</section>

<style>
	.portfolio {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-6);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		width: 100%;
	}

	.label {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.value-row {
		margin-top: var(--space-1);
	}

	.total {
		font-family: var(--font-numeric);
		font-size: var(--text-3xl);
		font-weight: var(--font-weight-bold);
		line-height: var(--leading-tight);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text);
	}

	.change-row {
		display: flex;
		align-items: center;
	}

	.delta {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
	}

	.delta.up {
		color: var(--color-success);
	}

	.delta.down {
		color: var(--color-danger);
	}

	.period-tag {
		color: var(--color-text-muted);
		font-weight: var(--font-weight-regular);
	}

	.period-toggle {
		display: inline-flex;
		gap: var(--space-1);
		align-self: flex-start;
		padding: var(--space-1);
		background: var(--color-surface-inset);
		border-radius: var(--radius-md);
		margin-top: var(--space-2);
	}

	.period-btn {
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		transition: color var(--motion-fast) var(--ease-out),
			background var(--motion-fast) var(--ease-out);
	}

	.period-btn:hover {
		color: var(--color-text);
	}

	.period-btn.active {
		color: var(--color-text);
		background: var(--color-surface);
	}
</style>
