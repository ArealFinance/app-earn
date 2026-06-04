<script lang="ts">
	/**
	 * Unstake stRWT → RWT with a 21-day cooldown.
	 * RWT is fixed at the current rate; stRWT is burned immediately and earns no
	 * rewards during the cooldown. Prominent warning. Mock-only.
	 */
	import { CheckCircle2, AlertTriangle } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import { unstakePreview } from '$lib/earn/mock';
	import { formatTokenAmount, formatRate, formatUnlockDate } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		strwtRate: number;
		onClose: () => void;
	}

	let { open, strwtRate, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';

	let amountInput = $state('');
	let status = $state<Status>('idle');
	let txError = $state<string | null>(null);

	const strwt = $derived($wallet.strwt);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const quote = $derived(unstakePreview(amount, strwtRate));
	const overBalance = $derived(amount > strwt);
	const error = $derived(overBalance ? 'Amount exceeds stRWT balance' : null);
	const canSubmit = $derived(amount > 0 && !overBalance && status === 'idle');

	function reset(): void {
		amountInput = '';
		status = 'idle';
		txError = null;
	}

	function handleClose(): void {
		reset();
		onClose();
	}

	async function confirm(): Promise<void> {
		if (!canSubmit) return;
		status = 'submitting';
		txError = null;
		try {
			await wallet.initiateUnstake(amount);
			status = 'success';
			setTimeout(handleClose, 1800);
		} catch (e) {
			txError = e instanceof Error ? e.message : 'Transaction failed';
			status = 'idle';
		}
	}
</script>

<BottomSheet {open} title="Unstake stRWT" busy={status === 'submitting'} onClose={handleClose}>
	{#if status === 'success'}
		<div class="success">
			<CheckCircle2 size={44} aria-hidden="true" />
			<p class="success-title">
				Unstaking {formatTokenAmount(quote.rwtOut)} RWT
			</p>
			<p class="success-sub">Claimable {formatUnlockDate(quote.unlockTs)} (21-day cooldown)</p>
			<p class="demo">Confirmed on devnet</p>
		</div>
	{:else}
		<AmountInput
			id="unstake-amount"
			bind:value={amountInput}
			symbol="stRWT"
			balance={strwt}
			disabled={status === 'submitting'}
			{error}
		/>

		<div class="warn" role="alert">
			<AlertTriangle size={16} aria-hidden="true" />
			<span>
				stRWT is burned now and earns no rewards during the 21-day cooldown. The RWT
				amount is fixed at the current rate.
			</span>
		</div>

		<div class="preview">
			<div class="preview-row">
				<span>Rate (stRWT→RWT)</span>
				<span class="tabular">{formatRate(quote.rateUsed)}</span>
			</div>
			<div class="preview-row">
				<span>Unlock date</span>
				<span class="tabular">{formatUnlockDate(quote.unlockTs)}</span>
			</div>
			<div class="preview-row total">
				<span>You receive (after cooldown)</span>
				<span class="tabular">{formatTokenAmount(quote.rwtOut)} RWT</span>
			</div>
		</div>

		{#if txError}
			<p class="tx-error" role="alert">{txError}</p>
		{/if}

		<div class="actions">
			<button class="btn ghost" type="button" onclick={handleClose} disabled={status === 'submitting'}>
				Cancel
			</button>
			<button class="btn primary" type="button" onclick={confirm} disabled={!canSubmit}>
				{status === 'submitting' ? 'Confirming…' : 'Confirm Unstake'}
			</button>
		</div>

		<p class="demo">Live devnet — a real transaction will be submitted</p>
	{/if}
</BottomSheet>

<style>
	.warn {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border);
		border-left: 2px solid var(--color-warning);
		border-radius: var(--radius-md);
	}

	.warn :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--color-warning);
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-inset);
		border-radius: var(--radius-md);
	}

	.preview-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.preview-row.total {
		margin-top: var(--space-1);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
		color: var(--color-text);
		font-weight: var(--font-weight-semibold);
		font-size: var(--text-base);
	}

	.tx-error {
		font-size: var(--text-sm);
		color: var(--color-danger, #ef4444);
		text-align: center;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.btn {
		height: var(--btn-height);
		padding: 0 var(--space-5);
		font-size: var(--text-base);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-tight);
		border-radius: var(--radius-button);
		transition: background-color var(--motion-fast) var(--ease-out);
	}

	.btn.primary {
		color: var(--color-white-900);
		background-color: var(--color-purple-400);
	}

	.btn.primary:hover:not(:disabled) {
		background-color: var(--color-purple-500);
	}

	.btn.primary:active:not(:disabled) {
		background-color: var(--color-purple-700);
	}

	.btn.ghost {
		color: var(--color-text);
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border);
	}

	.btn.ghost:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	.demo {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--color-warning);
	}

	.success {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-6) 0;
		color: var(--color-success);
		text-align: center;
	}

	.success-title {
		font-family: var(--font-numeric);
		font-size: var(--text-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		margin-top: var(--space-2);
	}

	.success-sub {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
</style>
