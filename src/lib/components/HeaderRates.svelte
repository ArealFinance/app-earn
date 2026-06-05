<script lang="ts">
	/**
	 * Compact live-rate ticker for the header's right side.
	 *
	 *   RWT   — market (DEX) price, with Book NAV shown small beneath it.
	 *           When no DEX pool is readable, falls back to NAV as the primary
	 *           value (no duplicate NAV sub-line).
	 *   stRWT — value of 1 stRWT in USD (strwtRate × Book NAV).
	 *
	 * All values are the same REAL on-chain reads the dashboard uses. The NAV
	 * sub-line hides on narrow screens to keep the header from crowding the
	 * wallet pill.
	 */
	import { formatNav } from '$lib/utils/format';

	interface Props {
		/** Book NAV price per RWT (USD). */
		bookNav: number;
		/** Market (DEX) price, or null when no pool is readable. */
		marketPrice: number | null;
		/** stRWT → RWT rate — to value 1 stRWT in USD. */
		strwtRate: number;
	}

	let { bookNav, marketPrice, strwtRate }: Props = $props();

	const strwtUsd = $derived(strwtRate * bookNav);
</script>

<div class="header-rates" aria-label="Live RWT and stRWT rates">
	<div class="hr-item">
		<span class="hr-sym">RWT</span>
		{#if marketPrice !== null}
			<span class="hr-vals">
				<span class="hr-price tabular" title="Market (DEX) price">{formatNav(marketPrice)}</span>
				<span class="hr-nav tabular" title="Book NAV">NAV {formatNav(bookNav)}</span>
			</span>
		{:else}
			<span class="hr-price tabular" title="No DEX pool yet — showing Book NAV">
				{formatNav(bookNav)}
			</span>
		{/if}
	</div>

	<span class="hr-sep" aria-hidden="true">·</span>

	<div class="hr-item">
		<span class="hr-sym">stRWT</span>
		<span class="hr-price tabular" title="Value of 1 stRWT in USD">{formatNav(strwtUsd)}</span>
	</div>
</div>

<style>
	.header-rates {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
	}

	.hr-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.hr-sym {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.hr-vals {
		display: inline-flex;
		flex-direction: column;
		line-height: 1.1;
	}

	.hr-price {
		font-family: var(--font-numeric);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.hr-nav {
		font-family: var(--font-numeric);
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-regular);
		color: var(--color-text-muted);
	}

	.hr-sep {
		color: var(--color-text-muted);
	}

	/* Narrow screens: drop the NAV sub-line so the ticker stays a single tight
	 * row beside the wallet pill. */
	@media (max-width: 480px) {
		.hr-nav {
			display: none;
		}
	}
</style>
