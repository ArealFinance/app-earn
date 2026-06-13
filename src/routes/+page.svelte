<script lang="ts">
	/**
	 * Earn MVP — single-scroll, mobile-first dashboard.
	 *
	 * State A (not connected): hero + connect CTA + public stats.
	 * State B (connected):     portfolio header, yield, 4-action bar, positions,
	 *                          rates.
	 *
	 * Every number is REAL: NAV / rate / TVL / balances / tickets from on-chain
	 * reads, market price from the live Meteora pool, and APY / EARNED / portfolio
	 * history from `GET /earn/stats` (`$lib/chain/stats`). When the stats endpoint
	 * has no history yet (fresh devnet) or is unreachable, the APY/earned/delta
	 * surfaces degrade to "—" + "accumulating data…" — never a fabricated value.
	 */
	import { onMount } from 'svelte';
	import { wallet } from '$lib/wallet/store';
	import { fetchBookNav, fetchStrwtRate, fetchTvl } from '$lib/chain/reads';
	import { fetchMarketPrice } from '$lib/chain/meteora';
	import { fetchEarnStats, type EarnStats } from '$lib/chain/stats';
	import {
		accumulatingHint,
		buildSeries,
		changePctOverWindow,
		earnedOverWindow,
		headlineApy
	} from '$lib/earn/derive';
	import type { Period, PublicStats as PublicStatsType } from '$lib/earn/types';

	import HeaderRates from '$lib/components/HeaderRates.svelte';
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

	// ── Protocol-level state ─────────────────────────────────────────────────
	// Book NAV + stRWT rate + TVL + market price are all REAL on-chain reads
	// (devnet). Market price comes from the live Meteora DLMM pool's active bin;
	// `null` only if the pool read fails (renders "—").

	// Defaults match the empty on-chain state ($1.00 NAV, 10.0 rate) so the
	// first paint is correct even before the async read resolves.
	let bookNav = $state(1);
	let strwtRate = $state(10);
	let tvl = $state(0);
	// Market price starts null ("—") until the pool read resolves.
	let marketPrice = $state<number | null>(null);

	// Real earn-stats (APY + time-series) from `GET /earn/stats`. `null` until
	// the fetch resolves AND only stays null when the endpoint has no history /
	// is unreachable → APY/earned/delta show "accumulating data…".
	let earnStats = $state<EarnStats | null>(null);

	// Headline APY (fraction) — prefer the month window, fall back week→day. When
	// every window is still accumulating, `null` → "—" + accumulating hint.
	const apy = $derived<number | null>(earnStats ? headlineApy(earnStats.apy) : null);

	const stats = $derived<PublicStatsType>({
		bookNav,
		marketPrice,
		strwtRate,
		stakingApy: apy,
		tvl
	});

	onMount(async () => {
		try {
			const [nav, rate, tvlUsd] = await Promise.all([
				fetchBookNav(),
				fetchStrwtRate(),
				fetchTvl()
			]);
			bookNav = nav;
			strwtRate = rate;
			tvl = tvlUsd;
		} catch {
			// Keep the empty-state defaults on RPC failure; the UI still renders.
		}

		// Market price is read separately: the Meteora pool read is heavier than
		// the contract reads, and a pool failure must not block NAV/rate/TVL.
		try {
			marketPrice = await fetchMarketPrice();
		} catch {
			marketPrice = null; // renders "—"
		}

		// Earn-stats is its own backend call; `fetchEarnStats` already swallows
		// every failure into `null`, so no try/catch needed. A `null` here is the
		// "accumulating data…" state, not an error.
		earnStats = await fetchEarnStats();
	});

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

	// ── Period toggle + real time-series derivations ─────────────────────────
	let period = $state<Period>('month');

	// Current holdings (liquid RWT + stRWT) used to value the real series.
	const holdings = $derived({ rwt, strwt });

	// APY for the SELECTED window (period-specific). `null` while that window is
	// still accumulating → YieldStats renders "—" + the accumulating hint.
	const periodApy = $derived<number | null>(
		earnStats ? earnStats.apy[period] : null
	);

	// Epoch-ms of the OLDEST snapshot (null when there's no history / endpoint
	// down). Drives the human "available in ~N days" hint for windows that don't
	// have enough history yet.
	const historyStartMs = $derived<number | null>(
		earnStats && earnStats.history.length > 0 ? Date.parse(earnStats.history[0].ts) : null
	);

	// Concrete countdown shown instead of the vague "accumulating data…" — same
	// for APY / earned / delta since they all key off the selected window.
	const notReadyHint = $derived(accumulatingHint(historyStartMs, period, Date.now()));

	// Sparkline series, built from the REAL stats time-series sliced to the
	// window. With holdings → the user's portfolio-value curve; without holdings
	// (or not connected) → the protocol NAV curve so the chart still shows the
	// vault's real trajectory. Empty array when there's no history at all.
	const seriesValues = $derived(
		earnStats ? buildSeries(holdings, earnStats.history, period) : []
	);

	// EARNED ($) over the window on CURRENT holdings, computed from the real
	// series (rate + NAV movement). `null` when history is shorter than the
	// window → "—" + accumulating.
	const earnedUsd = $derived<number | null>(
		earnStats
			? earnedOverWindow(holdings, earnStats.history, period, strwtRate, bookNav)
			: null
	);

	// The "+X% (window)" delta, derived from the real value series. `null` when
	// there's no window anchor (or the user holds nothing) → neutral delta.
	const changePct = $derived<number | null>(
		earnStats
			? changePctOverWindow(holdings, earnStats.history, period, strwtRate, bookNav)
			: null
	);

	// ── Action capability flags ──────────────────────────────────────────────
	// Sell routes through the live Meteora DLMM pool: enabled once the user holds
	// RWT and the pool price has been read (a missing market read disables it).
	const canSell = $derived(rwt > 0 && marketPrice !== null);
	const sellDisabledReason = $derived(
		marketPrice === null
			? 'Market price unavailable — try again shortly'
			: 'You have no RWT to sell'
	);
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

	let claimError = $state<string | null>(null);

	async function handleClaim(ticketId: string): Promise<void> {
		// PositionsList passes the ticket's nonce as the id payload for claiming.
		const ticket = pendingUnstakes.find((t) => t.id === ticketId);
		if (!ticket?.nonce) return;
		claimError = null;
		try {
			await wallet.completeUnstake(ticket.nonce);
		} catch (e) {
			claimError = e instanceof Error ? e.message : 'Claim failed';
		}
	}
</script>

<header class="top-strip">
	<a class="brand" href="/" aria-label="Areal">
		<img class="brand-logo" src="/images/logo-areal.svg" alt="Areal" />
	</a>
	<div class="top-right">
		<HeaderRates {bookNav} {strwtRate} />
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
				<p class="cta-disclaimer">By connecting, you agree to the terms.</p>
			</div>
		{:else}
			<PortfolioHeader
				{totalValue}
				{changePct}
				{period}
				values={seriesValues}
				accumulatingHint={notReadyHint}
				onPeriodChange={(p) => (period = p)}
			/>

			<YieldStats apy={periodApy} {earnedUsd} {period} accumulatingHint={notReadyHint} />

			<ActionBar {canSell} {sellDisabledReason} {canStake} {canUnstake} onAction={openSheet} />

			<PositionsList
				{rwt}
				{strwt}
				{pendingUnstakes}
				{bookNav}
				{strwtRate}
				apy={periodApy}
				accumulatingHint={notReadyHint}
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

<BuyModal open={activeSheet === 'buy'} {marketPrice} onClose={closeSheet} />
<SellModal open={activeSheet === 'sell'} {marketPrice} {bookNav} onClose={closeSheet} />
<StakeModal open={activeSheet === 'stake'} {strwtRate} {bookNav} apy={periodApy} onClose={closeSheet} />
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
		color: var(--color-text);
		text-decoration: none;
	}

	.brand:hover {
		text-decoration: none;
	}

	/* Same vector wordmark (crystal + "Areal") as the main app's Logo component
	 * (logo-areal.svg, 117×24). Height fixed, width scales to preserve ratio. */
	.brand-logo {
		display: block;
		height: 24px;
		width: auto;
		flex-shrink: 0;
	}

	.top-right {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1) var(--space-2);
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
