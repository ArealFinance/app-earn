<script lang="ts">
	/**
	 * Persistent "Devnet" badge.
	 *
	 * Everything is REAL devnet state now: NAV, the stRWT rate, market price
	 * (live Meteora pool), balances, transactions, and APY / earned (from the
	 * earn-stats time-series). The badge stays visible only to mark this as
	 * devnet, not mainnet — APY/earned simply show "accumulating data…" until
	 * enough snapshot history exists.
	 *
	 * Sits in the top-right corner. When the wallet pill is also visible
	 * (connected state), the pill renders to the right of this badge.
	 */
</script>

<span
	class="demo-badge"
	title="Live Solana devnet. NAV, rate, market price, balances, transactions and APY are all real on-chain state. APY/earned show 'accumulating data…' until enough snapshot history exists."
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
		color: var(--color-text-muted);
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		cursor: help;
		white-space: nowrap;
	}

	/* Small solid amber status dot — the single, restrained accent. No glow. */
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-warning);
	}
</style>
