<script lang="ts">
	/**
	 * Sell RWT — DEX only (there is no on-chain redeem in the earn contract).
	 * Prominent warning when market price is below Book NAV. Mock-only.
	 */
	import { CheckCircle2, AlertTriangle } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import { mockSellQuote } from '$lib/earn/mock';
	import { formatTokenAmount, formatUsd, formatNav } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		marketPrice: number;
		bookNav: number;
		onClose: () => void;
	}

	let { open, marketPrice, bookNav, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';

	let amountInput = $state('');
	let status = $state<Status>('idle');

	const rwt = $derived($wallet.rwt);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const quote = $derived(mockSellQuote(amount, marketPrice, bookNav));
	const overBalance = $derived(amount > rwt);
	const error = $derived(overBalance ? 'Amount exceeds RWT balance' : null);
	const canSubmit = $derived(amount > 0 && !overBalance && status === 'idle');

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
		wallet.mockSell(amount, quote.usdcOut);
		status = 'success';
		setTimeout(handleClose, 1400);
	}
</script>

<BottomSheet {open} title="Sell RWT" busy={status === 'submitting'} onClose={handleClose}>
	{#if status === 'success'}
		<div class="success">
			<CheckCircle2 size={44} aria-hidden="true" />
			<p class="success-title">Sold for {formatUsd(quote.usdcOut)}</p>
			<p class="demo">Demo mode — no real tx submitted</p>
		</div>
	{:else}
		<p class="note">RWT has no on-chain redeem — this is a DEX swap to USDC.</p>

		<AmountInput
			id="sell-amount"
			bind:value={amountInput}
			symbol="RWT"
			balance={rwt}
			disabled={status === 'submitting'}
			{error}
		/>

		{#if quote.belowBookNav}
			<div class="warn" role="alert">
				<AlertTriangle size={16} aria-hidden="true" />
				<span>
					Market price ({formatNav(marketPrice)}) is below Book NAV
					({formatNav(bookNav)}) — you are selling below book value.
				</span>
			</div>
		{/if}

		<div class="preview">
			<div class="preview-row">
				<span>DEX price</span>
				<span class="tabular">{formatNav(quote.price)} / RWT</span>
			</div>
			<div class="preview-row">
				<span>Est. slippage</span>
				<span class="tabular">−{formatUsd(quote.slippage)}</span>
			</div>
			<div class="preview-row total">
				<span>You receive</span>
				<span class="tabular">{formatUsd(quote.usdcOut)}</span>
			</div>
		</div>

		<div class="actions">
			<button class="btn ghost" type="button" onclick={handleClose} disabled={status === 'submitting'}>
				Cancel
			</button>
			<button class="btn primary" type="button" onclick={confirm} disabled={!canSubmit}>
				{status === 'submitting' ? 'Confirming…' : 'Confirm Sell'}
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

	.warn {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-warning);
		background: var(--color-warning-tint);
		border: 1px solid rgba(255, 140, 0, 0.3);
		border-radius: var(--radius-md);
	}

	.warn :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
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
		font-size: var(--text-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		margin-top: var(--space-2);
	}
</style>
