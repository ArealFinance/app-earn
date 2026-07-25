import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PositionsList from './PositionsList.svelte';

let component: ReturnType<typeof mount> | undefined;

const defaults = {
	rwt: 0,
	strwt: 0,
	pendingUnstakes: [],
	ticketsLoading: false,
	ticketsError: null,
	bookNav: 1,
	strwtRate: 10,
	apy: null,
	accumulatingHint: 'accumulating data…',
	onBuy: vi.fn(),
	onClaim: vi.fn(),
	onRetryTickets: vi.fn()
};

function render(overrides: Record<string, unknown> = {}): void {
	component = mount(PositionsList, {
		target: document.body,
		props: { ...defaults, ...overrides }
	});
	flushSync();
}

function button(label: string): HTMLButtonElement {
	const found = Array.from(document.querySelectorAll('button')).find(
		(element) => element.textContent?.trim() === label
	);
	if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing ${label} button`);
	return found;
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('PositionsList unstake tickets', () => {
	it('shows a mature ticket as claimable and claims using its id', () => {
		const onClaim = vi.fn();
		render({
			onClaim,
			pendingUnstakes: [
				{ id: 'mature-ticket', amountRwt: 12.5, unlockTs: Date.now() - 1_000, nonce: '42' }
			]
		});

		expect(document.body.textContent).toContain('ready');
		button('Claim RWT').click();
		expect(onClaim).toHaveBeenCalledWith('mature-ticket');
	});

	it('disables all mature claims while a claim is in flight', () => {
		render({
			claimingTicketId: 'mature-ticket',
			pendingUnstakes: [
				{ id: 'mature-ticket', amountRwt: 12.5, unlockTs: Date.now() - 1_000, nonce: '42' }
			]
		});

		const claim = button('Claiming…');
		expect(claim.disabled).toBe(true);
		expect(claim.getAttribute('aria-busy')).toBe('true');
	});

	it('keeps a pending ticket in cooldown without a claim action', () => {
		render({
			pendingUnstakes: [
				{ id: 'pending-ticket', amountRwt: 2, unlockTs: Date.now() + 60_000, nonce: '7' }
			]
		});

		expect(document.body.textContent).toContain('Unstaking');
		expect(document.body.textContent).not.toContain('Claim RWT');
	});

	it('shows the loading state instead of the empty portfolio state', () => {
		render({ ticketsLoading: true });

		expect(document.body.textContent).toContain('Loading unstake tickets…');
		expect(document.body.textContent).not.toContain('Nothing here yet');
	});

	it('preserves displayed tickets after an API error and retries on request', () => {
		const onRetryTickets = vi.fn();
		render({
			onRetryTickets,
			ticketsError: 'Network unavailable',
			pendingUnstakes: [
				{ id: 'last-ticket', amountRwt: 3, unlockTs: Date.now() + 60_000, nonce: '9' }
			]
		});

		expect(document.body.textContent).toContain('Couldn’t load unstake tickets');
		expect(document.body.textContent).toContain('Unstaking');
		button('Retry').click();
		expect(onRetryTickets).toHaveBeenCalledTimes(1);
	});
});
