<script lang="ts">
	/**
	 * Buy RWT — Mint or DEX (live devnet).
	 *
	 *   Mint: Book NAV × (1 + 1% fee). Deposits USDC, mints earn-RWT at Book NAV.
	 *   DEX:  USDC → RWT swap against the live Meteora DLMM pool (a REAL quote +
	 *         swap transaction; mirrors SellModal).
	 *
	 * Both paths are clickable cards. The cheaper path (lower USDC-per-RWT price)
	 * is auto-selected until the user explicitly picks one. The DEX card falls
	 * back to a disabled stub when no quote is available (the pool can't be read
	 * or the quote errors), keeping the modal usable. Mint stays the safe default.
	 *
	 * Mint submits via `wallet.mintRwt`; DEX submits via `wallet.buyRwt`.
	 */
	import { CheckCircle2, AlertTriangle } from 'lucide-svelte';
	import BottomSheet from './BottomSheet.svelte';
	import AmountInput from './AmountInput.svelte';
	import FaucetButton from './FaucetButton.svelte';
	import { mintPreview, MINT_FEE_RATE } from '$lib/earn/mock';
	import { MIN_MINT_AMOUNT_UI, DEFAULT_SLIPPAGE_BPS } from '$lib/chain/config';
	import { quoteBuyRwt, type BuyQuote } from '$lib/chain/meteora';
	import { formatTokenAmount, formatUsd, formatNav } from '$lib/utils/format';
	import { wallet } from '$lib/wallet/store';

	interface Props {
		open: boolean;
		/** Market price (USDC per RWT) from the pool; null if unread. */
		marketPrice: number | null;
		bookNav: number;
		onClose: () => void;
	}

	let { open, marketPrice, bookNav, onClose }: Props = $props();

	type Status = 'idle' | 'submitting' | 'success';
	type Path = 'mint' | 'dex';

	let amountInput = $state('');
	let status = $state<Status>('idle');
	let txError = $state<string | null>(null);

	// Path selection. `userPicked` latches once the user clicks a card so the
	// cheaper-path auto-select stops overriding their choice.
	let selectedPath = $state<Path>('mint');
	let userPicked = $state(false);

	// Live DEX quote state — refreshed (debounced) as the amount changes.
	let quote = $state<BuyQuote | null>(null);
	let quoting = $state(false);
	let quoteError = $state<string | null>(null);

	// Latched at confirm time so the success message reflects what was submitted.
	let lastPath = $state<Path>('mint');
	let lastRwtOut = $state(0);

	const usdc = $derived($wallet.usdc);
	const amount = $derived.by(() => {
		const n = Number(amountInput);
		return Number.isFinite(n) && n > 0 ? n : 0;
	});

	const mintQuote = $derived(mintPreview(amount, bookNav));

	const overBalance = $derived(amount > usdc);
	// Below-min gates the Mint path only (the DEX swap has no mint floor).
	const belowMin = $derived(amount > 0 && amount < MIN_MINT_AMOUNT_UI);
	const error = $derived(
		overBalance
			? 'Amount exceeds balance'
			: belowMin
				? `Minimum deposit is ${MIN_MINT_AMOUNT_UI} USDC`
				: null
	);

	// DEX is selectable only when a real quote is present.
	const dexAvailable = $derived(!!quote);
	const dexSelected = $derived(selectedPath === 'dex' && dexAvailable);

	// RWT received for the active path.
	const activeRwtOut = $derived(dexSelected ? quote!.rwtOut : mintQuote.rwtOut);

	// Which path is cheaper (lower USDC-per-RWT price). Used for auto-select + Best badge.
	const cheaperPath = $derived.by<Path>(() => {
		if (!quote) return 'mint';
		return quote.effectivePrice > 0 && quote.effectivePrice < mintQuote.price ? 'dex' : 'mint';
	});

	const canSubmit = $derived.by(() => {
		if (status !== 'idle') return false;
		if (dexSelected) {
			return amount > 0 && !overBalance && !!quote && !quoting;
		}
		return amount > 0 && !overBalance && !belowMin;
	});

	// ── Debounced live DEX quote ───────────────────────────────────────────────
	// Re-quote when the (valid) amount changes. A token guards against a slow
	// request resolving after a newer input (race / stale write). Validity does
	// NOT gate on the mint `belowMin` floor — the DEX has no such minimum.
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
				const q = await quoteBuyRwt(amt, DEFAULT_SLIPPAGE_BPS);
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

	// Auto-select the cheaper path while the user hasn't explicitly picked one.
	// Force 'mint' whenever the DEX has no quote (so we never sit on an
	// unsubmittable DEX selection).
	$effect(() => {
		if (!dexAvailable) {
			selectedPath = 'mint';
			return;
		}
		if (!userPicked) {
			selectedPath = cheaperPath;
		}
	});

	function pickPath(path: Path): void {
		if (path === 'dex' && !dexAvailable) return;
		selectedPath = path;
		userPicked = true;
	}

	function reset(): void {
		amountInput = '';
		status = 'idle';
		txError = null;
		quote = null;
		quoting = false;
		quoteError = null;
		selectedPath = 'mint';
		userPicked = false;
	}

	function handleClose(): void {
		reset();
		onClose();
	}

	async function confirm(): Promise<void> {
		if (!canSubmit) return;
		status = 'submitting';
		txError = null;
		const path: Path = dexSelected ? 'dex' : 'mint';
		lastPath = path;
		lastRwtOut = activeRwtOut;
		try {
			if (path === 'dex') {
				await wallet.buyRwt(amount, DEFAULT_SLIPPAGE_BPS);
			} else {
				await wallet.mintRwt(amount);
			}
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
			<p class="success-title">
				{lastPath === 'dex' ? 'Bought' : 'Minted'} {formatTokenAmount(lastRwtOut)} RWT
			</p>
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
			<button
				class="path"
				class:active={selectedPath === 'mint'}
				type="button"
				onclick={() => pickPath('mint')}
				disabled={status === 'submitting'}
			>
				<span class="path-head">
					<span class="path-name">Mint</span>
					{#if cheaperPath === 'mint' && dexAvailable}
						<span class="badge">Best</span>
					{/if}
				</span>
				<span class="path-out tabular">{formatTokenAmount(mintQuote.rwtOut)} RWT</span>
				<span class="path-price tabular">{formatNav(mintQuote.price)} / RWT</span>
			</button>

			{#if dexAvailable}
				<button
					class="path"
					class:active={selectedPath === 'dex'}
					type="button"
					onclick={() => pickPath('dex')}
					disabled={status === 'submitting'}
				>
					<span class="path-head">
						<span class="path-name">DEX</span>
						{#if cheaperPath === 'dex'}
							<span class="badge">Best</span>
						{/if}
					</span>
					<span class="path-out tabular">{formatTokenAmount(quote!.rwtOut)} RWT</span>
					<span class="path-price tabular">{formatNav(quote!.effectivePrice)} / RWT</span>
				</button>
			{:else if quoting}
				<div class="path disabled" aria-hidden="true">
					<span class="path-head">
						<span class="path-name">DEX</span>
					</span>
					<span class="path-out tabular">Quoting…</span>
					<span class="path-price tabular">&nbsp;</span>
				</div>
			{:else if quoteError === null && marketPrice !== null}
				<div class="path disabled" title="Enter an amount for a live DEX quote">
					<span class="path-head">
						<span class="path-name">DEX</span>
					</span>
					<span class="path-out tabular">—</span>
					<span class="path-price tabular">~{formatNav(marketPrice)} / RWT</span>
				</div>
			{:else}
				<div class="path disabled" title="The RWT/USDC pool is unavailable right now">
					<span class="path-head">
						<span class="path-name">DEX</span>
					</span>
					<span class="path-out tabular">—</span>
					<span class="path-price tabular">No market yet</span>
				</div>
			{/if}
		</div>

		{#if dexSelected && quote!.priceImpactBps > 100}
			<div class="warn" role="alert">
				<AlertTriangle size={16} aria-hidden="true" />
				<span>
					Price impact is {(quote!.priceImpactBps / 100).toFixed(2)}% — the pool is shallow;
					you may receive significantly less RWT.
				</span>
			</div>
		{/if}

		<div class="preview">
			{#if dexSelected}
				<div class="preview-row">
					<span>Market price</span>
					<span class="tabular">{formatNav(quote!.effectivePrice)} / RWT</span>
				</div>
				<div class="preview-row">
					<span>Price impact</span>
					<span class="tabular">{(quote!.priceImpactBps / 100).toFixed(2)}%</span>
				</div>
				<div class="preview-row">
					<span>Pool fee</span>
					<span class="tabular">−{formatUsd(quote!.feeUsdc)}</span>
				</div>
				<div class="preview-row">
					<span>Min received (slippage {(DEFAULT_SLIPPAGE_BPS / 100).toFixed(1)}%)</span>
					<span class="tabular">{formatTokenAmount(quote!.minOut)} RWT</span>
				</div>
				<div class="preview-row total">
					<span>You receive</span>
					<span class="tabular">{formatTokenAmount(quote!.rwtOut)} RWT</span>
				</div>
			{:else}
				<div class="preview-row">
					<span>Mint fee ({(MINT_FEE_RATE * 100).toFixed(0)}%)</span>
					<span class="tabular">−{formatUsd(mintQuote.fee)}</span>
				</div>
				<div class="preview-row">
					<span>Price (Book NAV +1%)</span>
					<span class="tabular">{formatNav(mintQuote.price)}</span>
				</div>
				<div class="preview-row total">
					<span>You receive</span>
					<span class="tabular">{formatTokenAmount(mintQuote.rwtOut)} RWT</span>
				</div>
			{/if}
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
				{#if status === 'submitting'}
					Confirming…
				{:else if dexSelected}
					{quoting ? 'Quoting…' : 'Confirm Buy'}
				{:else}
					Confirm Mint
				{/if}
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
		/* Reset default <button> styling (font, color, appearance). */
		margin: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		appearance: none;
		cursor: pointer;
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color var(--motion-fast) var(--ease-out);
	}

	button.path:hover:not(:disabled):not(.active) {
		border-color: var(--color-primary);
	}

	.path.active {
		border-color: var(--color-primary);
		background: var(--color-info-tint);
	}

	.path:disabled {
		cursor: not-allowed;
	}

	.path.disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
