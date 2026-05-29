<script lang="ts">
	/**
	 * Persistent "Devnet" badge.
	 *
	 * NAV, the stRWT rate, balances and transactions are REAL devnet state.
	 * The badge stays visible so users know this is not mainnet (and that a
	 * few derived figures — APY history, market price — are still placeholders).
	 *
	 * Sits in the top-right corner. When the wallet pill is also visible
	 * (connected state), the pill renders to the right of this badge.
	 */
</script>

<span
	class="demo-badge"
	title="Live Solana devnet. NAV, rate, balances and transactions are real on-chain state. APY history and market price are placeholders until a DEX pool is seeded."
	aria-label="Devnet — live on-chain state, not mainnet"
>
	<span class="dot" aria-hidden="true"></span>
	Devnet
</span>

<style>
	.demo-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-3);
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-warning);
		background: var(--color-warning-tint);
		border: 1px solid rgba(255, 140, 0, 0.3);
		border-radius: var(--radius-pill);
		cursor: help;
		white-space: nowrap;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-warning);
		box-shadow: var(--glow-orange);
	}
</style>
