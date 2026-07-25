import { describe, expect, it } from 'vitest';
import { parseUnstakeTickets, usesUnstakeTicketsApi } from './unstake-tickets';

describe('parseUnstakeTickets', () => {
	it('enables the indexed API only for mainnet', () => {
		expect(usesUnstakeTicketsApi('mainnet')).toBe(true);
		expect(usesUnstakeTicketsApi('devnet')).toBe(false);
	});

	it('normalizes the production raw ticket response and sorts it by unlock time', () => {
		const result = parseUnstakeTickets({
			tickets: [
				{
					ticket: 'later',
					amountRwtBaseUnits: '2500000',
					unlockTsSec: '200',
					nonce: '18446744073709551615'
				},
				{
					ticket: 'earlier',
					amountRwtBaseUnits: '1000000',
					unlockTsSec: '100',
					nonce: '0'
				}
			]
		});

		expect(result.tickets).toEqual([
			{ id: 'earlier', amountRwt: 1, unlockTs: 100_000, nonce: '0' },
			{ id: 'later', amountRwt: 2.5, unlockTs: 200_000, nonce: '18446744073709551615' }
		]);
	});

	it('rejects malformed tickets instead of converting the result to an empty list', () => {
		expect(() => parseUnstakeTickets({ tickets: [{ ticket: 'bad' }] })).toThrow(
			'Invalid unstake ticket'
		);
	});

	it('rejects raw amount and timestamp values that cannot be represented safely', () => {
		expect(() =>
			parseUnstakeTickets({
				tickets: [
					{
						ticket: 'unsafe-amount',
						amountRwtBaseUnits: '9007199254740992',
						unlockTsSec: '1',
						nonce: '1'
					}
				]
			})
		).toThrow('Invalid unstake ticket');

		expect(() =>
			parseUnstakeTickets({
				tickets: [
					{
						ticket: 'unsafe-time',
						amountRwtBaseUnits: '1',
						unlockTsSec: '9007199254741',
						nonce: '1'
					}
				]
			})
		).toThrow('Invalid unstake ticket');
	});
});
