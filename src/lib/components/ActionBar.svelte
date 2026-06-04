<script lang="ts">
	/**
	 * Four primary actions → bottom sheets: Buy / Sell / Stake / Unstake.
	 * Sell/Stake/Unstake disable when the user holds none of the relevant token.
	 */
	import { Plus, Minus, Lock, Unlock } from 'lucide-svelte';

	type Action = 'buy' | 'sell' | 'stake' | 'unstake';

	interface Props {
		/** Whether each action is enabled (parent decides from balances). */
		canSell: boolean;
		canStake: boolean;
		canUnstake: boolean;
		/** Tooltip shown on the Sell button when it's disabled. */
		sellDisabledReason?: string;
		onAction: (action: Action) => void;
	}

	let { canSell, canStake, canUnstake, sellDisabledReason, onAction }: Props = $props();
</script>

<section class="action-bar" aria-label="Actions">
	<button class="action primary" type="button" onclick={() => onAction('buy')}>
		<Plus size={18} aria-hidden="true" />
		<span>Buy</span>
	</button>
	<button
		class="action"
		type="button"
		onclick={() => onAction('sell')}
		disabled={!canSell}
		title={!canSell ? sellDisabledReason : undefined}
	>
		<Minus size={18} aria-hidden="true" />
		<span>Sell</span>
	</button>
	<button
		class="action"
		type="button"
		onclick={() => onAction('stake')}
		disabled={!canStake}
	>
		<Lock size={18} aria-hidden="true" />
		<span>Stake</span>
	</button>
	<button
		class="action"
		type="button"
		onclick={() => onAction('unstake')}
		disabled={!canUnstake}
	>
		<Unlock size={18} aria-hidden="true" />
		<span>Unstake</span>
	</button>
</section>

<style>
	.action-bar {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-2);
		width: 100%;
	}

	.action {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition: border-color var(--motion-fast) var(--ease-out),
			background-color var(--motion-fast) var(--ease-out),
			transform var(--motion-fast) var(--ease-out);
	}

	.action:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	.action:active:not(:disabled) {
		transform: scale(0.97);
	}

	.action.primary {
		color: var(--color-on-accent);
		background-color: var(--color-purple-400);
		border-color: transparent;
	}

	.action.primary:hover:not(:disabled) {
		background-color: var(--color-purple-500);
	}

	.action.primary:active:not(:disabled) {
		background-color: var(--color-purple-700);
	}
</style>
