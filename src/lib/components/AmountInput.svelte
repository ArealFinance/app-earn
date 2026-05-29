<script lang="ts">
	/**
	 * Shared amount input with a token symbol, Max button and balance line.
	 * Used by all four bottom sheets. Owns input sanitisation (digits + one dot);
	 * the parent reads the cleaned string via `bind:value`.
	 */
	interface Props {
		/** Cleaned numeric string (bindable). */
		value: string;
		/** Token symbol shown on the right (USDC / RWT / stRWT). */
		symbol: string;
		/** Available balance for the Max button + balance line. */
		balance: number;
		/** Decimals to show in the balance line. */
		balanceDecimals?: number;
		/** Field label. */
		label?: string;
		/** Input id (for the label). */
		id: string;
		disabled?: boolean;
		/** Shown in red under the input when set. */
		error?: string | null;
	}

	let {
		value = $bindable(),
		symbol,
		balance,
		balanceDecimals = 4,
		label = 'Amount',
		id,
		disabled = false,
		error = null
	}: Props = $props();

	function handleInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		const cleaned = target.value.replace(/[^0-9.]/g, '');
		const firstDot = cleaned.indexOf('.');
		value =
			firstDot === -1
				? cleaned
				: cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
	}

	function setMax(): void {
		// Trim to the displayed precision so the input doesn't overflow balance.
		value = balance > 0 ? trimFloat(balance, balanceDecimals) : '';
	}

	function trimFloat(n: number, decimals: number): string {
		return String(Number(n.toFixed(decimals)));
	}

	const balanceLabel = $derived(
		balance.toLocaleString('en-US', {
			minimumFractionDigits: balanceDecimals,
			maximumFractionDigits: balanceDecimals
		})
	);
</script>

<div class="input-row">
	<label class="input-label" for={id}>{label}</label>
	<div class="input-wrap" class:invalid={!!error}>
		<input
			{id}
			name="amount"
			type="text"
			inputmode="decimal"
			autocomplete="off"
			placeholder="0.00"
			{value}
			oninput={handleInput}
			{disabled}
			class="tabular"
		/>
		<span class="symbol">{symbol}</span>
		<button
			class="max-btn"
			type="button"
			onclick={setMax}
			disabled={disabled || balance <= 0}
		>
			Max
		</button>
	</div>
	<p class="balance tabular">Balance: {balanceLabel} {symbol}</p>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.input-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.input-label {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-medium);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.input-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color var(--motion-fast) var(--ease-out);
	}

	.input-wrap:focus-within {
		border-color: var(--color-primary);
	}

	.input-wrap.invalid {
		border-color: var(--color-danger);
	}

	input {
		flex: 1;
		width: 100%;
		min-width: 0;
		font-family: var(--font-numeric);
		font-size: var(--text-xl);
		font-weight: var(--font-weight-semibold);
		background: transparent;
		border: 0;
		outline: 0;
		padding: 0;
		color: var(--color-text);
	}

	input::placeholder {
		color: var(--color-text-muted);
	}

	.symbol {
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
	}

	.max-btn {
		padding: 4px var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-wide);
		color: var(--color-primary);
		background: var(--color-info-tint);
		border-radius: var(--radius-xs);
	}

	.max-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.balance {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.error {
		font-size: var(--text-xs);
		color: var(--color-danger);
	}
</style>
