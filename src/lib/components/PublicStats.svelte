<script lang="ts">
	/**
	 * Pre-connect public stats strip: Book NAV / APY / TVL.
	 * Shown in State A (wallet not connected). Stacks on mobile, row on wider.
	 */
	import { formatApr, formatNav, formatUsdCompact } from '$lib/utils/format';
	import type { PublicStats } from '$lib/earn/types';

	interface Props {
		stats: PublicStats;
	}

	let { stats }: Props = $props();
</script>

<section class="public-stats" aria-label="Protocol stats">
	<article class="stat">
		<span class="label">Book NAV</span>
		<span class="value tabular">{formatNav(stats.bookNav)}</span>
	</article>

	<article class="stat">
		<span class="label">Market</span>
		<span class="value tabular" title={stats.marketPrice === null ? 'Pool price unavailable' : undefined}>
			{stats.marketPrice === null ? '—' : formatNav(stats.marketPrice)}
		</span>
		<span class="caveat">Meteora DLMM</span>
	</article>

	<article class="stat">
		<span class="label">Staking APY</span>
		{#if stats.stakingApy === null}
			<span class="value tabular muted" title="Not enough rate history yet">—</span>
			<span class="caveat">accumulating data…</span>
		{:else}
			<span class="value tabular">{formatApr(stats.stakingApy)}</span>
			<span class="caveat">annualised, realised</span>
		{/if}
	</article>

	<article class="stat">
		<span class="label">TVL</span>
		<span class="value tabular">{formatUsdCompact(stats.tvl)}</span>
	</article>
</section>

<style>
	.public-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		width: 100%;
	}

	.stat {
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

	.value.muted {
		color: var(--color-text-muted);
	}

	.caveat {
		font-size: var(--text-2xs);
		color: var(--color-text-muted);
	}

	@media (min-width: 480px) {
		.public-stats {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
