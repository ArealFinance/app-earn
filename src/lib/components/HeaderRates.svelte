<script lang="ts">
	/**
	 * Compact live-rate ticker for the header's right side.
	 *
	 *   RWT   — Book NAV (USD per RWT).
	 *   stRWT — value of 1 stRWT in USD (strwtRate × Book NAV).
	 *
	 * Each token is shown by its logo (not a text symbol) followed by the price.
	 * Both are the same REAL on-chain reads the dashboard uses, on a single tight
	 * row so the header stays clean next to the wallet pill.
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
		<img class="hr-logo" src="/tokens/rwt.png" alt="RWT" width="16" height="16" />
		<span class="hr-price tabular" title="RWT — Book NAV (USD)">{formatNav(bookNav)}</span>
	</span>
	<span class="hr-sep" aria-hidden="true">·</span>
	<span class="hr-item">
		<img class="hr-logo" src="/tokens/strwt.png" alt="stRWT" width="16" height="16" />
		<span class="hr-price tabular" title="stRWT — value of 1 stRWT in USD">{formatNav(strwtUsd)}</span>
	</span>
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

	.hr-logo {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: 50%;
		object-fit: contain;
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
