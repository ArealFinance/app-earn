<script lang="ts">
	/**
	 * Yield accent row: current staking APY + absolute earned ($).
	 * Always carries the "historical, not a guarantee" caveat.
	 */
	import { formatApr, formatUsdDelta } from '$lib/utils/format';

	interface Props {
		/** Staking APY (fraction, e.g. 0.142). */
		apy: number;
		/** Absolute earned to date (USD). */
		earnedUsd: number;
	}

	let { apy, earnedUsd }: Props = $props();
</script>

<section class="yield" aria-label="Yield">
	<div class="cell">
		<span class="label">APY</span>
		<span class="value tabular">{formatApr(apy)}</span>
	</div>
	<div class="cell">
		<span class="label">Earned</span>
		<span
			class="value tabular"
			class:positive={earnedUsd > 0}
			class:negative={earnedUsd < 0}
		>
			{formatUsdDelta(earnedUsd)}
		</span>
	</div>
</section>
<p class="caveat">APY is historical and not a guarantee.</p>

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

	.caveat {
		margin-top: var(--space-2);
		font-size: var(--text-2xs);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
