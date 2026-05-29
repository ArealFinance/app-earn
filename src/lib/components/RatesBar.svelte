<script lang="ts">
	/**
	 * Rates strip: Book NAV / Market (DEX) / stRWT→RWT.
	 * Compact reference row at the bottom of the dashboard.
	 */
	import { formatNav, formatRate } from '$lib/utils/format';

	interface Props {
		bookNav: number;
		marketPrice: number;
		strwtRate: number;
	}

	let { bookNav, marketPrice, strwtRate }: Props = $props();
</script>

<section class="rates" aria-label="Rates">
	<div class="rate">
		<span class="label">Book NAV</span>
		<span class="val tabular">{formatNav(bookNav)}</span>
	</div>
	<span class="sep" aria-hidden="true">·</span>
	<div class="rate">
		<span class="label">Market</span>
		<span class="val tabular">{formatNav(marketPrice)}</span>
	</div>
	<span class="sep" aria-hidden="true">·</span>
	<div class="rate">
		<span class="label">stRWT→RWT</span>
		<span class="val tabular">{formatRate(strwtRate)}</span>
	</div>
</section>

<style>
	.rates {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: 100%;
	}

	.rate {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.label {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.val {
		font-family: var(--font-numeric);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.sep {
		color: var(--color-text-muted);
	}
</style>
