<script lang="ts">
	/**
	 * Stake RWT → stRWT at the current rate (stRWT_out = RWT / rate).
	 * Shows projected (historical) APY. Mock-only.
	 */
	import { CheckCircle2 } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import { mockStakeQuote } from '$lib/earn/mock';
	import { formatTokenAmount, formatApr, formatRate, formatUsd } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		strwtRate: number;
		/** Book NAV — to show the projected annual $ earnings estimate. */
		bookNav: number;
		onClose: () => void;
	}

	let { open, strwtRate, bookNav, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';

	let amountInput = $state('');
	let status = $state<Status>('idle');

	const rwt = $derived($wallet.rwt);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const quote = $derived(mockStakeQuote(amount, strwtRate));
	const overBalance = $derived(amount > rwt);
	const error = $derived(overBalance ? 'Amount exceeds RWT balance' : null);
	const canSubmit = $derived(amount > 0 && !overBalance && status === 'idle');

	// Projected first-year earnings, in USD, at the historical APY.
	const projectedEarningsUsd = $derived(amount * bookNav * quote.projectedApy);

	function reset(): void {
		amountInput = '';
		status = 'idle';
	}

	function handleClose(): void {
		reset();
		onClose();
	}

	async function confirm(): Promise<void> {
		if (!canSubmit) return;
		status = 'submitting';
		await new Promise((r) => setTimeout(r, 1400));
		wallet.mockStake(amount, quote.strwtOut);
		status = 'success';
		setTimeout(handleClose, 1400);
	}
</script>

<BottomSheet {open} title="Stake RWT" busy={status === 'submitting'} onClose={handleClose}>
	{#if status === 'success'}
		<div class="success">
			<CheckCircle2 size={44} aria-hidden="true" />
			<p class="success-title">Staked — got {formatTokenAmount(quote.strwtOut)} stRWT</p>
			<p class="demo">Demo mode — no real tx submitted</p>
		</div>
	{:else}
		<p class="note">
			Stake RWT to receive stRWT. Rewards accrue as the stRWT→RWT rate rises — no claiming.
		</p>

		<AmountInput
			id="stake-amount"
			bind:value={amountInput}
			symbol="RWT"
			balance={rwt}
			disabled={status === 'submitting'}
			{error}
		/>

		<div class="preview">
			<div class="preview-row">
				<span>Rate (stRWT→RWT)</span>
				<span class="tabular">{formatRate(quote.rateUsed)}</span>
			</div>
			<div class="preview-row">
				<span>Projected APY</span>
				<span class="tabular accent">{formatApr(quote.projectedApy)}</span>
			</div>
			<div class="preview-row">
				<span>Est. 1-year earnings</span>
				<span class="tabular">{formatUsd(projectedEarningsUsd)}</span>
			</div>
			<div class="preview-row total">
				<span>You receive</span>
				<span class="tabular">{formatTokenAmount(quote.strwtOut)} stRWT</span>
			</div>
		</div>

		<p class="caveat">APY is historical and not a guarantee.</p>

		<div class="actions">
			<button class="btn ghost" type="button" onclick={handleClose} disabled={status === 'submitting'}>
				Cancel
			</button>
			<button class="btn primary" type="button" onclick={confirm} disabled={!canSubmit}>
				{status === 'submitting' ? 'Confirming…' : 'Confirm Stake'}
			</button>
		</div>

		<p class="demo">Demo mode — no real tx submitted</p>
	{/if}
</BottomSheet>

<style>
	.note {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
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

	.preview-row .accent {
		color: var(--color-success);
		font-weight: var(--font-weight-semibold);
	}

	.preview-row.total {
		margin-top: var(--space-1);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
		color: var(--color-text);
		font-weight: var(--font-weight-semibold);
		font-size: var(--text-base);
	}

	.caveat {
		font-size: var(--text-2xs);
		color: var(--color-text-muted);
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
		transition: filter var(--motion-fast) var(--ease-out);
	}

	.btn.primary {
		color: var(--color-text);
		background: linear-gradient(
			135deg,
			var(--color-primary-gradient-from),
			var(--color-primary-gradient-to)
		);
		box-shadow: var(--glow-purple);
	}

	.btn.primary:hover:not(:disabled) {
		filter: brightness(1.06);
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
	}

	.success-title {
		font-family: var(--font-numeric);
		font-size: var(--text-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		margin-top: var(--space-2);
		text-align: center;
	}
</style>
