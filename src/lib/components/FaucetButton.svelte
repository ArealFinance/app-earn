<script lang="ts">
	/**
	 * Devnet "Get test USDC" affordance.
	 *
	 * Renders ONLY on devnet with a configured faucet base (`IS_DEVNET &&
	 * FAUCET_API_BASE`) — never on mainnet. Calls the backend faucet, then
	 * refreshes on-chain balances so the freshly-minted USDC (and auto-dripped
	 * SOL for fees) appears immediately. Inline status mirrors the app's existing
	 * modal pattern (no global toast system).
	 */
	import { Droplets, CheckCircle2 } from 'lucide-svelte';
	import { IS_DEVNET, FAUCET_API_BASE } from '$lib/chain/config';
	import { requestEarnUsdc, FaucetError, formatRetryAfter } from '$lib/chain/faucet';
	import { wallet } from '$lib/wallet/store';
	import { formatUsdc } from '$lib/utils/format';

	interface Props {
		/** Whole USDC to request (backend default 100, max 1000). */
		amount?: number;
		/** Disable while a parent action is in flight (e.g. a mint submitting). */
		disabled?: boolean;
	}

	let { amount, disabled = false }: Props = $props();

	/** Hard gate: only ever active on devnet with a configured faucet. */
	const enabled = IS_DEVNET && FAUCET_API_BASE.length > 0;

	const address = $derived($wallet.address);

	type Status = 'idle' | 'requesting' | 'success' | 'error';
	let status = $state<Status>('idle');
	let message = $state<string | null>(null);
	let mintedAmount = $state<number | null>(null);

	async function claim(): Promise<void> {
		if (!address || status === 'requesting') return;
		status = 'requesting';
		message = null;
		try {
			const result = await requestEarnUsdc(address, amount);
			mintedAmount = result.amount;
			// Pull fresh balances so the new USDC (and SOL) is reflected at once.
			await wallet.refreshBalances();
			status = 'success';
			message = `Received ${formatUsdc(result.amount, 0)} test USDC`;
		} catch (e) {
			status = 'error';
			if (e instanceof FaucetError && e.kind === 'rate-limited') {
				message = `Faucet cooldown — try again in ${formatRetryAfter(e.retryAfterSec)}.`;
			} else if (e instanceof FaucetError && e.kind === 'unavailable') {
				message = 'Faucet is not available right now.';
			} else if (e instanceof FaucetError) {
				message = e.message;
			} else {
				message = 'Could not get test USDC. Please try again.';
			}
		}
	}
</script>

{#if enabled}
	<div class="faucet">
		{#if status === 'success'}
			<p class="faucet-success" role="status">
				<CheckCircle2 size={16} aria-hidden="true" />
				<span>{message}</span>
			</p>
		{:else}
			<button
				class="faucet-btn"
				type="button"
				onclick={claim}
				disabled={disabled || !address || status === 'requesting'}
			>
				<Droplets size={16} aria-hidden="true" />
				<span>{status === 'requesting' ? 'Requesting…' : 'Get test USDC'}</span>
			</button>
			{#if status === 'error' && message}
				<p class="faucet-error" role="alert">{message}</p>
			{:else}
				<p class="faucet-hint">Drips test USDC (and SOL for fees) to your wallet.</p>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.faucet {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.faucet-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
		height: var(--btn-height);
		padding: 0 var(--space-4);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text);
		background-color: var(--color-surface-inset);
		border: 1px dashed var(--color-primary);
		border-radius: var(--radius-button);
		transition:
			background-color var(--motion-fast) var(--ease-out),
			border-color var(--motion-fast) var(--ease-out);
	}

	.faucet-btn:hover:not(:disabled) {
		background-color: var(--color-surface);
		border-color: var(--color-purple-500);
	}

	.faucet-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.faucet-hint {
		font-size: var(--text-2xs);
		color: var(--color-text-muted);
		text-align: center;
	}

	.faucet-error {
		font-size: var(--text-xs);
		color: var(--color-danger, #ef4444);
		text-align: center;
	}

	.faucet-success {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-success);
	}
</style>
