<script lang="ts">
	/**
	 * Buy RWT — two acquisition paths, the cheaper one highlighted.
	 *
	 *   Mint: Book NAV × (1 + 1% fee) — cheaper when market ≥ Book NAV.
	 *   DEX:  market price + slippage + LP fee — cheaper when market < Book NAV.
	 *
	 * The user picks a path (defaults to the cheaper). Mock-only: no tx submitted.
	 */
	import { CheckCircle2 } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import { mockBuyQuote } from '$lib/earn/mock';
	import { formatTokenAmount, formatUsd, formatNav } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		bookNav: number;
		marketPrice: number;
		onClose: () => void;
	}

	let { open, bookNav, marketPrice, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';
	type Path = 'mint' | 'dex';

	let amountInput = $state('');
	let status = $state<Status>('idle');
	let selected = $state<Path | null>(null);

	const usdc = $derived($wallet.usdc);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const quote = $derived(mockBuyQuote(amount, bookNav, marketPrice));
	// Default to the cheaper path unless the user has picked one explicitly.
	const activePath = $derived<Path>(selected ?? quote.cheaper);

	const overBalance = $derived(amount > usdc);
	const error = $derived(overBalance ? 'Amount exceeds balance' : null);
	const canSubmit = $derived(amount > 0 && !overBalance && status === 'idle');

	const activeRwtOut = $derived(
		activePath === 'mint' ? quote.mintPath.rwtOut : quote.dexPath.rwtOut
	);

	function reset(): void {
		amountInput = '';
		status = 'idle';
		selected = null;
	}

	function handleClose(): void {
		reset();
		onClose();
	}

	async function confirm(): Promise<void> {
		if (!canSubmit) return;
		status = 'submitting';
		await new Promise((r) => setTimeout(r, 1400));
		wallet.mockBuy(amount, activeRwtOut);
		status = 'success';
		setTimeout(handleClose, 1400);
	}

	// Reset selection whenever the sheet re-opens.
	$effect(() => {
		if (open) {
			status = 'idle';
		}
	});
</script>

<BottomSheet {open} title="Buy RWT" busy={status === 'submitting'} onClose={handleClose}>
	{#if status === 'success'}
		<div class="success">
			<CheckCircle2 size={44} aria-hidden="true" />
			<p class="success-title">Bought {formatTokenAmount(activeRwtOut)} RWT</p>
			<p class="demo">Demo mode — no real tx submitted</p>
		</div>
	{:else}
		<AmountInput
			id="buy-amount"
			bind:value={amountInput}
			symbol="USDC"
			balance={usdc}
			balanceDecimals={2}
			disabled={status === 'submitting'}
			{error}
		/>

		<div class="paths" role="radiogroup" aria-label="Choose a path">
			{#each (['mint', 'dex'] as const) as path (path)}
				{@const leg = path === 'mint' ? quote.mintPath : quote.dexPath}
				{@const isCheaper = quote.cheaper === path}
				<button
					type="button"
					class="path"
					class:active={activePath === path}
					role="radio"
					aria-checked={activePath === path}
					onclick={() => (selected = path)}
					disabled={status === 'submitting'}
				>
					<span class="path-head">
						<span class="path-name">{path === 'mint' ? 'Mint' : 'DEX'}</span>
						{#if isCheaper}
							<span class="badge">Cheaper</span>
						{/if}
					</span>
					<span class="path-out tabular">{formatTokenAmount(leg.rwtOut)} RWT</span>
					<span class="path-price tabular">{formatNav(leg.price)} / RWT</span>
				</button>
			{/each}
		</div>

		<div class="preview">
			{#if activePath === 'mint'}
				<div class="preview-row">
					<span>Mint fee (1%)</span>
					<span class="tabular">−{formatUsd(quote.mintPath.fee)}</span>
				</div>
				<div class="preview-row">
					<span>Price (Book NAV +1%)</span>
					<span class="tabular">{formatNav(quote.mintPath.price)}</span>
				</div>
			{:else}
				<div class="preview-row">
					<span>Est. slippage</span>
					<span class="tabular">−{formatUsd(quote.dexPath.slippage)}</span>
				</div>
				<div class="preview-row">
					<span>DEX price</span>
					<span class="tabular">{formatNav(quote.dexPath.price)}</span>
				</div>
			{/if}
			<div class="preview-row total">
				<span>You receive</span>
				<span class="tabular">{formatTokenAmount(activeRwtOut)} RWT</span>
			</div>
		</div>

		<div class="actions">
			<button class="btn ghost" type="button" onclick={handleClose} disabled={status === 'submitting'}>
				Cancel
			</button>
			<button class="btn primary" type="button" onclick={confirm} disabled={!canSubmit}>
				{status === 'submitting' ? 'Confirming…' : 'Confirm Buy'}
			</button>
		</div>

		<p class="demo">Demo mode — no real tx submitted</p>
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
