<script lang="ts">
	/**
	 * Buy RWT — Mint path only (live devnet).
	 *
	 *   Mint: Book NAV × (1 + 1% fee). Deposits USDC, mints earn-RWT at Book NAV.
	 *
	 * The DEX path is unavailable until a RWT/USDC pool is seeded; it's shown as
	 * a disabled note. Mint submits a REAL transaction via `wallet.mintRwt`.
	 */
	import { CheckCircle2 } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import FaucetButton from './FaucetButton.svelte';
	import { mintPreview, MINT_FEE_RATE } from '$lib/earn/mock';
	import { MIN_MINT_AMOUNT_UI } from '$lib/chain/config';
	import { formatTokenAmount, formatUsd, formatNav } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		bookNav: number;
		onClose: () => void;
	}

	let { open, bookNav, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';

	let amountInput = $state('');
	let status = $state<Status>('idle');
	let txError = $state<string | null>(null);

	const usdc = $derived($wallet.usdc);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const quote = $derived(mintPreview(amount, bookNav));
	const activeRwtOut = $derived(quote.rwtOut);

	const overBalance = $derived(amount > usdc);
	const belowMin = $derived(amount > 0 && amount < MIN_MINT_AMOUNT_UI);
	const error = $derived(
		overBalance
			? 'Amount exceeds balance'
			: belowMin
				? `Minimum deposit is ${MIN_MINT_AMOUNT_UI} USDC`
				: null
	);
	const canSubmit = $derived(
		amount > 0 && !overBalance && !belowMin && status === 'idle'
	);

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
			await wallet.mintRwt(amount);
			status = 'success';
			setTimeout(handleClose, 1600);
		} catch (e) {
			txError = e instanceof Error ? e.message : 'Transaction failed';
			status = 'idle';
		}
	}

	$effect(() => {
		if (open) {
			status = 'idle';
			txError = null;
		}
	});
</script>

<BottomSheet {open} title="Buy RWT" busy={status === 'submitting'} onClose={handleClose}>
	{#if status === 'success'}
		<div class="success">
			<CheckCircle2 size={44} aria-hidden="true" />
			<p class="success-title">Minted {formatTokenAmount(activeRwtOut)} RWT</p>
			<p class="demo">Confirmed on devnet</p>
		</div>
	{:else}
		{#if usdc <= 0}
			<FaucetButton disabled={status === 'submitting'} />
		{/if}

		<AmountInput
			id="buy-amount"
			bind:value={amountInput}
			symbol="USDC"
			balance={usdc}
			balanceDecimals={2}
			disabled={status === 'submitting'}
			{error}
		/>

		<div class="paths">
			<div class="path active">
				<span class="path-head">
					<span class="path-name">Mint</span>
					<span class="badge">Active</span>
				</span>
				<span class="path-out tabular">{formatTokenAmount(activeRwtOut)} RWT</span>
				<span class="path-price tabular">{formatNav(quote.price)} / RWT</span>
			</div>
			<div class="path disabled" title="Sell opens once the RWT/USDC pool is live">
				<span class="path-head">
					<span class="path-name">DEX</span>
				</span>
				<span class="path-out tabular">—</span>
				<span class="path-price tabular">No market yet</span>
			</div>
		</div>

		<div class="preview">
			<div class="preview-row">
				<span>Mint fee ({(MINT_FEE_RATE * 100).toFixed(0)}%)</span>
				<span class="tabular">−{formatUsd(quote.fee)}</span>
			</div>
			<div class="preview-row">
				<span>Price (Book NAV +1%)</span>
				<span class="tabular">{formatNav(quote.price)}</span>
			</div>
			<div class="preview-row total">
				<span>You receive</span>
				<span class="tabular">{formatTokenAmount(activeRwtOut)} RWT</span>
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
				{status === 'submitting' ? 'Confirming…' : 'Confirm Mint'}
			</button>
		</div>

		<p class="demo">Live devnet — a real transaction will be submitted</p>
	{/if}
</BottomSheet>

<style>
	.paths {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.path {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		text-align: left;
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color var(--motion-fast) var(--ease-out);
	}

	.path.active {
		border-color: var(--color-primary);
		background: var(--color-info-tint);
	}

	.path.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tx-error {
		font-size: var(--text-sm);
		color: var(--color-danger, #ef4444);
		text-align: center;
	}

	.path-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.path-name {
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.badge {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-on-success);
		background: var(--color-success);
		padding: 2px 6px;
		border-radius: var(--radius-xs);
	}

	.path-out {
		font-family: var(--font-numeric);
		font-size: var(--text-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.path-price {
		font-size: var(--text-xs);
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
