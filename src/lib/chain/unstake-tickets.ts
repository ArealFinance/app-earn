/**
 * Mainnet unstake-ticket API client.
 *
 * Ticket discovery is intentionally served by the backend indexer instead of
 * `getProgramAccounts`: public RPC proxies commonly disallow expensive account
 * scans, while the API can provide a wallet-scoped, indexed response.
 */

import {
	FAUCET_API_BASE,
	NETWORK,
	TOKEN_DECIMALS,
	UNSTAKE_TICKETS_PATH,
	type AppNetwork
} from './config';
import type { PendingUnstake } from '$lib/earn/types';

interface UnstakeTicketsResponse {
	tickets: PendingUnstake[];
}

/** The indexed ticket endpoint belongs exclusively to the mainnet deployment. */
export function usesUnstakeTicketsApi(network: AppNetwork = NETWORK): boolean {
	return network === 'mainnet';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object';
}

function parseNonce(value: unknown): string | null {
	if (typeof value === 'string' && /^\d+$/.test(value)) return value;
	return null;
}

function parseDecimalString(value: unknown): bigint | null {
	if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
	try {
		return BigInt(value);
	} catch {
		return null;
	}
}

function parseAmountRwt(ticket: Record<string, unknown>): number | null {
	if (typeof ticket.amountRwt === 'number' && Number.isFinite(ticket.amountRwt)) {
		return ticket.amountRwt >= 0 ? ticket.amountRwt : null;
	}

	const baseUnits = parseDecimalString(ticket.amountRwtBaseUnits);
	if (baseUnits === null) return null;
	if (baseUnits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	const amount = Number(baseUnits) / 10 ** TOKEN_DECIMALS;
	return Number.isFinite(amount) ? amount : null;
}

function parseUnlockTs(ticket: Record<string, unknown>): number | null {
	if (typeof ticket.unlockTs === 'number' && Number.isFinite(ticket.unlockTs)) {
		return ticket.unlockTs >= 0 && Number.isSafeInteger(ticket.unlockTs) ? ticket.unlockTs : null;
	}

	const seconds = parseDecimalString(ticket.unlockTsSec);
	if (seconds === null) return null;
	const unlockTs = seconds * 1000n;
	if (unlockTs > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	return Number(unlockTs);
}

/** Parse and validate the untrusted public API response. */
export function parseUnstakeTickets(raw: unknown): UnstakeTicketsResponse {
	if (!isRecord(raw) || !Array.isArray(raw.tickets)) {
		throw new Error('Invalid unstake tickets response');
	}

	const tickets = raw.tickets.map((ticket): PendingUnstake => {
		if (!isRecord(ticket)) throw new Error('Invalid unstake ticket');

		const id = typeof ticket.id === 'string' ? ticket.id : ticket.ticket;
		const amountRwt = parseAmountRwt(ticket);
		const unlockTs = parseUnlockTs(ticket);
		const nonce = parseNonce(ticket.nonce);
		if (
			typeof id !== 'string' ||
			id.length === 0 ||
			amountRwt === null ||
			unlockTs === null ||
			nonce === null
		) {
			throw new Error('Invalid unstake ticket');
		}

		return { id, amountRwt, unlockTs, nonce };
	});

	return { tickets: tickets.sort((a, b) => a.unlockTs - b.unlockTs) };
}

/** Build the wallet-scoped ticket URL, preserving an optional API path override. */
export function unstakeTicketsUrl(owner: string): string {
	if (!FAUCET_API_BASE) throw new Error('Unstake tickets API is not configured');

	const base = FAUCET_API_BASE.replace(/\/$/, '');
	const path = UNSTAKE_TICKETS_PATH.startsWith('/')
		? UNSTAKE_TICKETS_PATH
		: `/${UNSTAKE_TICKETS_PATH}`;
	const encodedOwner = encodeURIComponent(owner);
	return `${base}${path.includes(':owner') ? path.replace(':owner', encodedOwner) : `${path}/${encodedOwner}`}`;
}

/** Fetch indexed pending and mature unstake tickets for a wallet. */
export async function fetchUnstakeTickets(owner: string): Promise<PendingUnstake[]> {
	if (!usesUnstakeTicketsApi()) {
		throw new Error('Unstake tickets API is only available on mainnet');
	}

	let response: Response;
	try {
		response = await fetch(unstakeTicketsUrl(owner), {
			method: 'GET',
			headers: { Accept: 'application/json' }
		});
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error('Unable to load unstake tickets');
	}

	if (!response.ok) {
		throw new Error(`Unable to load unstake tickets (${response.status})`);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error('Invalid unstake tickets response');
	}

	return parseUnstakeTickets(body).tickets;
}
