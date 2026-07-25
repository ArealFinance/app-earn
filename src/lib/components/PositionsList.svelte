<script lang="ts">
	/**
	 * My positions: RWT / stRWT / pending unstake tickets.
	 *
	 *   RWT     — liquid amount ≈ USD (amount × Book NAV)
	 *   stRWT   — amount ≈ USD (amount × rate × Book NAV) with its APY
	 *   Pending — RWT amount + countdown; matured tickets show "Claim RWT"
	 *
	 * When the user holds nothing → an empty-state nudge.
	 */
	import { Coins, Hourglass } from 'lucide-svelte';
	// Token logos live in static/ and are referenced by plain path — NOT a JS
	// `import` (which Vite compiles to `new URL(..., import.meta.url)`, and the
	// node-polyfills shim shadows the global URL → "URL is not a constructor").
	import {
		formatApr,
		formatCountdown,
		formatTokenAmount,
		formatUsd,
		formatUnlockDate,
		isMatured
	} from '$lib/utils/format';
	import type { PendingUnstake } from '$lib/earn/types';

	interface Props {
		rwt: number;
		strwt: number;
		pendingUnstakes: PendingUnstake[];
		/** Ticket API is refreshing; existing tickets remain visible. */
		ticketsLoading: boolean;
		/** Ticket API failure. This must never be rendered as an empty portfolio. */
		ticketsError: string | null;
		/** Last failed complete-unstake transaction, if any. */
		claimError?: string | null;
		/** Ticket whose claim transaction is currently awaiting wallet/chain completion. */
		claimingTicketId?: string | null;
		/** Book NAV price per RWT (USD) — used to value positions. */
		bookNav: number;
		/** stRWT → RWT rate — to value stRWT in RWT before USD. */
		strwtRate: number;
		/** Real staking APY (fraction) for the stRWT row, or `null` while accumulating. */
		apy: number | null;
		/** Concrete "available in ~N days" hint shown when APY isn't ready. */
		accumulatingHint: string;
		/** Buy CTA for the empty state. */
		onBuy: () => void;
		/** Claim a matured unstake ticket. */
		onClaim: (ticketId: string) => void;
		/** Retry the ticket-only API request. */
		onRetryTickets: () => void;
	}

	let {
		rwt,
		strwt,
		pendingUnstakes,
		ticketsLoading,
		ticketsError,
		claimError = null,
		claimingTicketId = null,
		bookNav,
		strwtRate,
		apy,
		accumulatingHint,
		onBuy,
		onClaim,
		onRetryTickets
	}: Props = $props();

	const rwtUsd = $derived(rwt * bookNav);
	const strwtRwt = $derived(strwt * strwtRate);
	const strwtUsd = $derived(strwtRwt * bookNav);

	const isEmpty = $derived(rwt <= 0 && strwt <= 0 && pendingUnstakes.length === 0);
</script>

<section class="positions" aria-label="My positions">
	<h2 class="title">My positions</h2>

	{#if ticketsLoading}
		<p class="ticket-status" role="status">Loading unstake tickets…</p>
	{/if}

	{#if ticketsError}
		<div class="ticket-status ticket-error" role="alert">
			<span>Couldn’t load unstake tickets. {pendingUnstakes.length > 0 ? 'Showing the last confirmed list.' : ''}</span>
			<button class="retry-btn" type="button" onclick={onRetryTickets}>Retry</button>
		</div>
	{/if}

	{#if claimError}
		<p class="ticket-status ticket-action-error" role="alert">Couldn’t claim RWT: {claimError}</p>
	{/if}

	{#if isEmpty && !ticketsLoading && !ticketsError}
		<div class="empty">
			<Coins size={28} aria-hidden="true" />
			<p class="empty-title">Nothing here yet</p>
			<p class="empty-sub">Buy RWT to start earning.</p>
			<button class="btn-primary" type="button" onclick={onBuy}>Buy RWT</button>
		</div>
	{:else}
		<ul class="list">
			{#if rwt > 0}
				<li class="row">
					<img class="token-logo" src="/tokens/rwt.png" alt="RWT" width="32" height="32" />
					<span class="name">RWT</span>
					<span class="amounts">
						<span class="amount tabular">{formatTokenAmount(rwt)}</span>
						<span class="usd tabular">≈ {formatUsd(rwtUsd)}</span>
					</span>
				</li>
			{/if}

			{#if strwt > 0}
				<li class="row">
					<img class="token-logo" src="/tokens/strwt.png" alt="stRWT" width="32" height="32" />
					<span class="name">
						stRWT
						{#if apy !== null}
							<span class="apy-tag tabular">APY {formatApr(apy)}</span>
						{:else}
							<span class="apy-tag tabular muted">APY {accumulatingHint}</span>
						{/if}
					</span>
					<span class="amounts">
						<span class="amount tabular">{formatTokenAmount(strwt)}</span>
						<span class="usd tabular">≈ {formatUsd(strwtUsd)}</span>
					</span>
				</li>
			{/if}

			{#each pendingUnstakes as ticket (ticket.id)}
				<li class="row pending">
					<span class="icon" aria-hidden="true"><Hourglass size={16} /></span>
					<span class="name">
						Unstaking
						<span class="meta">
							{formatTokenAmount(ticket.amountRwt)} RWT ·
							{#if isMatured(ticket.unlockTs)}
								ready
							{:else}
								{formatCountdown(ticket.unlockTs)} · {formatUnlockDate(ticket.unlockTs)}
							{/if}
						</span>
					</span>
					<span class="amounts">
						{#if isMatured(ticket.unlockTs)}
							<button
								class="claim-btn"
								type="button"
								disabled={claimingTicketId !== null}
								aria-busy={claimingTicketId === ticket.id}
								onclick={() => onClaim(ticket.id)}
							>
								{claimingTicketId === ticket.id ? 'Claiming…' : 'Claim RWT'}
							</button>
						{:else}
							<span class="cooldown tabular">{formatCountdown(ticket.unlockTs)}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.positions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		width: 100%;
	}

	.title {
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--color-text-muted);
		font-family: var(--font-body);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface-inset);
		border-radius: var(--radius-md);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-primary);
	}

	.token-logo {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: 50%;
		object-fit: contain;
	}

	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-weight: var(--font-weight-medium);
	}

	.apy-tag {
		font-size: var(--text-2xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-success);
	}

	.apy-tag.muted {
		color: var(--color-text-muted);
		font-weight: var(--font-weight-medium);
	}

	.meta {
		font-size: var(--text-xs);
		font-weight: var(--font-weight-regular);
		color: var(--color-text-muted);
	}

	.ticket-status {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.ticket-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
		color: var(--color-warning);
		background: var(--color-surface-inset);
		border-radius: var(--radius-sm);
	}

	.ticket-action-error {
		padding: var(--space-3);
		color: var(--color-warning);
		background: var(--color-surface-inset);
		border-radius: var(--radius-sm);
	}

	.retry-btn {
		flex-shrink: 0;
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.amounts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		flex-shrink: 0;
	}

	.amount {
		font-family: var(--font-numeric);
		font-size: var(--text-base);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.usd {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.cooldown {
		font-size: var(--text-xs);
		color: var(--color-warning);
	}

	.claim-btn {
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-on-accent);
		background-color: var(--color-purple-400);
		border-radius: var(--radius-sm);
		white-space: nowrap;
		transition: background-color var(--motion-fast) var(--ease-out);
	}

	.claim-btn:hover {
		background-color: var(--color-purple-500);
	}

	.claim-btn:disabled {
		cursor: wait;
		opacity: 0.65;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-6) 0 var(--space-4);
		text-align: center;
		color: var(--color-text-muted);
	}

	.empty-title {
		font-size: var(--text-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.empty-sub {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.btn-primary {
		margin-top: var(--space-2);
		height: var(--btn-height);
		padding: 0 var(--space-6);
		font-size: var(--text-base);
		font-weight: var(--font-weight-semibold);
		color: var(--color-on-accent);
		background-color: var(--color-purple-400);
		border-radius: var(--radius-button);
		transition: background-color var(--motion-fast) var(--ease-out);
	}

	.btn-primary:hover {
		background-color: var(--color-purple-500);
	}

	.btn-primary:active {
		background-color: var(--color-purple-700);
	}
</style>
