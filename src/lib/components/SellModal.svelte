<script lang="ts">
	/**
	 * Sell RWT → USDC via the live Meteora DLMM pool.
	 *
	 * On every (debounced) amount change we pull a REAL quote from the pool
	 * (`quoteSellRwt`): USDC out, price impact, fee, and the slippage-floored
	 * min-out. Confirm submits a REAL swap transaction via `wallet.sellRwt`.
	 *
	 * RWT has no on-chain redeem in the earn contract — this is a DEX swap. A
	 * prominent warning fires when the market price is below Book NAV (selling
	 * below book value). Market price comes from the pool's active bin; Book NAV
	 * is the on-chain EarnConfig read.
	 */
	import { CheckCircle2, AlertTriangle } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import { quoteSellRwt, type SellQuote } from '$lib/chain/meteora';
	import { DEFAULT_SLIPPAGE_BPS } from '$lib/chain/config';
	import { formatTokenAmount, formatUsd, formatNav } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		/** Market price (USDC per RWT) from the pool; null if unread. */
		marketPrice: number | null;
		/** On-chain Book NAV (USDC per RWT) — for the below-NAV warning. */
		bookNav: number;
		onClose: () => void;
	}

	let { open, marketPrice, bookNav, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';

	let amountInput = $state('');
	let status = $state<Status>('idle');
	let txError = $state<string | null>(null);

	// Live quote state — refreshed (debounced) as the amount changes.
	let quote = $state<SellQuote | null>(null);
	let quoting = $state(false);
	let quoteError = $state<string | null>(null);
	let lastSoldUsdc = $state(0);

	const rwt = $derived($wallet.rwt);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const overBalance = $derived(amount > rwt);
	const error = $derived(overBalance ? 'Amount exceeds RWT balance' : null);

	// Selling below book value: the live market price is under Book NAV.
	const belowBookNav = $derived(marketPrice !== null && marketPrice < bookNav);

	const canSubmit = $derived(
		amount > 0 && !overBalance && !!quote && !quoting && status === 'idle'
	);

	// ── Debounced live quote ──────────────────────────────────────────────────
	// Re-quote when the (valid) amount changes. A token guards against a slow
	// request resolving after a newer input (race / stale write).
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let quoteToken = 0;

	$effect(() => {
		const amt = amount;
		const valid = amt > 0 && !overBalance && open;

		clearTimeout(debounceTimer);
		if (!valid) {
			quote = null;
			quoting = false;
			quoteError = null;
			return;
		}

		const token = ++quoteToken;
		quoting = true;
		quoteError = null;
		debounceTimer = setTimeout(async () => {
			try {
				const q = await quoteSellRwt(amt, DEFAULT_SLIPPAGE_BPS);
				if (token !== quoteToken) return; // superseded by a newer input
				quote = q;
			} catch (e) {
				if (token !== quoteToken) return;
				quote = null;
				quoteError = e instanceof Error ? e.message : 'Failed to fetch quote';
			} finally {
				if (token === quoteToken) quoting = false;
			}
		}, 350);
	});

	function reset(): void {
		amountInput = '';
		status = 'idle';
		txError = null;
		quote = null;
		quoting = false;
		quoteError = null;
	}

	function handleClose(): void {
		reset();
		onClose();
	}

	async function confirm(): Promise<void> {
		if (!canSubmit || !quote) return;
		status = 'submitting';
		txError = null;
		lastSoldUsdc = quote.usdcOut;
		try {
			await wallet.sellRwt(amount, DEFAULT_SLIPPAGE_BPS);
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

<BottomSheet {open} title="Sell RWT" busy={status === 'submitting'} onClose={handleClose}>
	{#if status === 'success'}
		<div class="success">
			<CheckCircle2 size={44} aria-hidden="true" />
			<p class="success-title">Sold for {formatUsd(lastSoldUsdc)}</p>
			<p class="demo">Confirmed on-chain</p>
		</div>
	{:else}
		<p class="note">RWT has no on-chain redeem — this is a DEX swap to USDC via Meteora.</p>

		<AmountInput
			id="sell-amount"
			bind:value={amountInput}
			symbol="RWT"
			balance={rwt}
			disabled={status === 'submitting'}
			{error}
		/>

		{#if belowBookNav}
			<div class="warn" role="alert">
				<AlertTriangle size={16} aria-hidden="true" />
				<span>
					Market price ({formatNav(marketPrice ?? 0)}) is below Book NAV
					({formatNav(bookNav)}) — you are selling below book value.
				</span>
			</div>
		{/if}

		<div class="preview">
			<div class="preview-row">
				<span>Market price</span>
				<span class="tabular">
					{quote ? `${formatNav(quote.effectivePrice)} / RWT` : marketPrice !== null ? `${formatNav(marketPrice)} / RWT` : '—'}
				</span>
			</div>
			<div class="preview-row">
				<span>Price impact</span>
				<span class="tabular">
					{quote ? `${(quote.priceImpactBps / 100).toFixed(2)}%` : '—'}
				</span>
			</div>
			<div class="preview-row">
				<span>Pool fee</span>
				<span class="tabular">{quote ? `−${formatUsd(quote.feeUsdc)}` : '—'}</span>
			</div>
			<div class="preview-row">
				<span>Min received (slippage {(DEFAULT_SLIPPAGE_BPS / 100).toFixed(1)}%)</span>
				<span class="tabular">{quote ? formatUsd(quote.minOut) : '—'}</span>
			</div>
			<div class="preview-row total">
				<span>You receive</span>
				<span class="tabular">
					{#if quoting}
						Quoting…
					{:else if quote}
						{formatUsd(quote.usdcOut)}
					{:else}
						—
					{/if}
				</span>
			</div>
		</div>

		{#if quoteError}
			<p class="tx-error" role="alert">{quoteError}</p>
		{/if}
		{#if txError}
			<p class="tx-error" role="alert">{txError}</p>
		{/if}

		<div class="actions">
			<button class="btn ghost" type="button" onclick={handleClose} disabled={status === 'submitting'}>
				Cancel
			</button>
			<button class="btn primary" type="button" onclick={confirm} disabled={!canSubmit}>
				{status === 'submitting' ? 'Confirming…' : quoting ? 'Quoting…' : 'Confirm Sell'}
			</button>
		</div>

		<p class="demo">A real on-chain swap will be submitted</p>
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

	.tx-error {
		font-size: var(--text-sm);
		color: var(--color-danger, #ef4444);
		text-align: center;
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
		transition: background-color var(--motion-fast) var(--ease-out);
	}

	.btn.primary {
		color: var(--color-on-accent);
		background-color: var(--color-purple-400);
	}

	.btn.primary:hover:not(:disabled) {
		background-color: var(--color-purple-500);
	}

	.btn.primary:active:not(:disabled) {
		background-color: var(--color-purple-700);
	}

	.btn.primary:disabled,
	.btn.ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
