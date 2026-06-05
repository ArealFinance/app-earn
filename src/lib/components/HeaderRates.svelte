<script lang="ts">
	/**
	 * Compact live-rate ticker for the header's right side.
	 *
	 *   RWT   — Book NAV (USD per RWT).
	 *   stRWT — value of 1 stRWT in USD (strwtRate × Book NAV).
	 *
	 * Both are the same REAL on-chain reads the dashboard uses, shown as a single
	 * tight row so the header stays clean next to the wallet pill.
	 */
	import { formatNav } from '$lib/utils/format';

	interface Props {
		/** Book NAV price per RWT (USD). */
		bookNav: number;
		/** stRWT → RWT rate — to value 1 stRWT in USD. */
		strwtRate: number;
	}

	let { bookNav, strwtRate }: Props = $props();

	const strwtUsd = $derived(strwtRate * bookNav);
</script>

<div class="header-rates" aria-label="Live RWT and stRWT rates">
	<span class="hr-item">
		<span class="hr-sym">RWT</span>
		<span class="hr-price tabular" title="Book NAV — USD value per RWT">{formatNav(bookNav)}</span>
	</span>
	<span class="hr-sep" aria-hidden="true">·</span>
	<span class="hr-item">
		<span class="hr-sym">stRWT</span>
		<span class="hr-price tabular" title="Value of 1 stRWT in USD">{formatNav(strwtUsd)}</span>
	</span>
</div>

<style>
	.header-rates {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		white-space: nowrap;
	}

	.hr-item {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
	}

	.hr-sym {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.hr-price {
		font-family: var(--font-numeric);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.hr-sep {
		color: var(--color-text-muted);
	}
</style>
