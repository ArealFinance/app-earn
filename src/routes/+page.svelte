<script lang="ts">
	/**
	 * Earn MVP — single-scroll, mobile-first dashboard.
	 *
	 * State A (not connected): hero + connect CTA + public stats.
	 * State B (connected):     portfolio header, yield, 4-action bar, positions,
	 *                          rates. Balances are deterministic mocks (some 0).
	 *
	 * All numbers come from `$lib/earn/mock` — the single swap-out point for when
	 * the earn + staking contracts deploy (Phase 4). DemoBadge stays visible.
	 */
	import { wallet } from '$lib/wallet/store';
	import {
		mockPublicStats,
		generatePortfolioHistory,
		MOCK_BOOK_NAV,
		MOCK_MARKET_PRICE,
		MOCK_STRWT_RATE,
		MOCK_STAKING_APY
	} from '$lib/earn/mock';
	import type { Period } from '$lib/earn/types';

	import DemoBadge from '$lib/components/DemoBadge.svelte';
	import WalletPill from '$lib/components/WalletPill.svelte';
	import ConnectWalletButton from '$lib/components/ConnectWalletButton.svelte';
	import PublicStats from '$lib/components/PublicStats.svelte';
	import PortfolioHeader from '$lib/components/PortfolioHeader.svelte';
	import YieldStats from '$lib/components/YieldStats.svelte';
	import ActionBar from '$lib/components/ActionBar.svelte';
	import PositionsList from '$lib/components/PositionsList.svelte';
	import RatesBar from '$lib/components/RatesBar.svelte';
	import BuyModal from '$lib/components/BuyModal.svelte';
	import SellModal from '$lib/components/SellModal.svelte';
	import StakeModal from '$lib/components/StakeModal.svelte';
	import UnstakeModal from '$lib/components/UnstakeModal.svelte';

	// ── Protocol-level mock data ────────────────────────────────────────────
	const stats = mockPublicStats();
	const bookNav = MOCK_BOOK_NAV;
	const marketPrice = MOCK_MARKET_PRICE;
	const strwtRate = MOCK_STRWT_RATE;
	const apy = MOCK_STAKING_APY;

	// ── Wallet-derived state ─────────────────────────────────────────────────
	const connected = $derived($wallet.connected);
	const rwt = $derived($wallet.rwt);
	const strwt = $derived($wallet.strwt);
	const pendingUnstakes = $derived($wallet.pendingUnstakes);

	// Total portfolio value in USD: liquid RWT + stRWT valued in RWT, all × Book NAV.
	// Pending-unstake RWT is reserved (fixed) but still belongs to the user → include.
	const pendingRwt = $derived(
		pendingUnstakes.reduce((sum, t) => sum + t.amountRwt, 0)
	);
	const totalRwtEquivalent = $derived(rwt + strwt * strwtRate + pendingRwt);
	const totalValue = $derived(totalRwtEquivalent * bookNav);

	// ── Period toggle + sparkline history ────────────────────────────────────
	let period = $state<Period>('month');

	const periodDays: Record<Period, number> = { day: 1, week: 7, month: 30 };
	const periodGrowth: Record<Period, number> = { day: 0.004, week: 0.021, month: 0.083 };

	// History is keyed to the current total and the selected window's growth.
	const history = $derived(
		generatePortfolioHistory(
			Math.max(2, periodDays[period] + 1),
			totalValue,
			periodGrowth[period]
		)
	);
	const changePct = $derived(periodGrowth[period]);

	// Earned ($) over the window — value gained vs. the window's start.
	const earnedUsd = $derived(
		totalValue > 0 ? totalValue - totalValue / (1 + changePct) : 0
	);

	// ── Action capability flags ──────────────────────────────────────────────
	const canSell = $derived(rwt > 0);
	const canStake = $derived(rwt > 0);
	const canUnstake = $derived(strwt > 0);

	// ── Modal routing ─────────────────────────────────────────────────────────
	type Sheet = 'buy' | 'sell' | 'stake' | 'unstake' | null;
	let activeSheet = $state<Sheet>(null);

	function openSheet(sheet: Exclude<Sheet, null>): void {
		activeSheet = sheet;
	}

	function closeSheet(): void {
		activeSheet = null;
	}

	function handleClaim(ticketId: string): void {
		wallet.mockClaimUnstake(ticketId);
	}
</script>

<header class="top-strip">
	<a class="brand" href="/" aria-label="Areal Earn">
		<span class="brand-mark" aria-hidden="true">◆</span>
		<span class="brand-text">Areal Earn</span>
	</a>
	<div class="top-right">
		<DemoBadge />
		{#if connected}
			<WalletPill />
		{/if}
	</div>
</header>

<main class="page">
	<div class="container">
		{#if !connected}
			<section class="hero">
				<h1 class="hero-title">Grow your USDC</h1>
				<p class="hero-sub">
					Buy RWT — a token backed by real-world assets whose value grows over time.
					Stake it to earn yield. Sell anytime on the DEX.
				</p>
			</section>

			<PublicStats {stats} />

			<div class="cta-wrap">
				<ConnectWalletButton />
				<p class="cta-disclaimer">By connecting, you agree to terms (demo).</p>
			</div>
		{:else}
			<PortfolioHeader
				{totalValue}
				{changePct}
				{period}
				{history}
				onPeriodChange={(p) => (period = p)}
			/>

			<YieldStats {apy} {earnedUsd} />

			<ActionBar {canSell} {canStake} {canUnstake} onAction={openSheet} />

			<PositionsList
				{rwt}
				{strwt}
				{pendingUnstakes}
				{bookNav}
				{strwtRate}
				{apy}
				onBuy={() => openSheet('buy')}
				onClaim={handleClaim}
			/>

			<RatesBar {bookNav} {marketPrice} {strwtRate} />
		{/if}
	</div>

	<footer class="footer">
		<p>
			Powered by
			<a href="https://areal.finance" target="_blank" rel="noopener noreferrer">Areal Finance</a>
		</p>
	</footer>
</main>

<BuyModal open={activeSheet === 'buy'} {bookNav} {marketPrice} onClose={closeSheet} />
<SellModal open={activeSheet === 'sell'} {marketPrice} {bookNav} onClose={closeSheet} />
<StakeModal open={activeSheet === 'stake'} {strwtRate} {bookNav} onClose={closeSheet} />
<UnstakeModal open={activeSheet === 'unstake'} {strwtRate} onClose={closeSheet} />

<style>
	.top-strip {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: var(--z-sticky);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-4);
		pointer-events: none;
	}

	.brand,
	.top-right {
		pointer-events: auto;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text);
		text-decoration: none;
	}

	.brand:hover {
		text-decoration: none;
	}

	.brand-mark {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		font-size: var(--text-md);
		color: var(--color-primary);
		background: rgba(158, 96, 246, 0.12);
		border: 1px solid rgba(158, 96, 246, 0.3);
		border-radius: var(--radius-sm);
	}

	.top-right {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
		padding: 80px var(--space-4) var(--space-8);
	}

	.container {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-4);
		width: 100%;
		max-width: 440px;
		margin: 0 auto;
	}

	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		text-align: center;
		padding: var(--space-6) 0 var(--space-2);
	}

	.hero-title {
		font-family: var(--font-sans);
		font-size: var(--text-3xl);
		font-weight: var(--font-weight-bold);
		line-height: var(--leading-tight);
		letter-spacing: var(--tracking-display);
		color: var(--color-text);
	}

	.hero-sub {
		max-width: 380px;
		color: var(--color-text-muted);
		font-size: var(--text-base);
		line-height: var(--leading-normal);
	}

	.cta-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
	}

	.cta-disclaimer {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.footer {
		display: flex;
		justify-content: center;
		padding: var(--space-6) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.footer a {
		color: var(--color-text-muted);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.footer a:hover {
		color: var(--color-text);
	}

	@media (min-width: 768px) {
		.container {
			max-width: 480px;
			gap: var(--space-5);
		}

		.hero-title {
			font-size: var(--text-4xl);
		}

		.top-strip {
			padding: var(--space-5) var(--space-6);
		}

		.page {
			padding: 100px var(--space-6) var(--space-12);
		}
	}
</style>
