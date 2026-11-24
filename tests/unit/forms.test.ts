import { describe, expect, it } from 'vitest';
import {
	BadInput,
	boolField,
	enumField,
	handleBadInput,
	intField,
	optBoolField,
	signedIntField,
	starsField,
	textField
} from '../../src/lib/server/forms';
import { epCode, shortDate } from '../../src/lib/format';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.set(k, v);
	return f;
};

describe('form field parsers', () => {
	it('intField accepts non-negative integers only', () => {
		expect(intField(fd({ id: '42' }), 'id')).toBe(42);
		expect(intField(fd({ id: ' 0 ' }), 'id')).toBe(0);
		for (const bad of ['', '-1', '1.5', '1e3', 'abc', '0x10', '9999999999'])
			expect(() => intField(fd({ id: bad }), 'id')).toThrow(BadInput);
		expect(() => intField(fd({}), 'id')).toThrow(BadInput);
	});

	it('signedIntField accepts negative integers', () => {
		expect(signedIntField(fd({ o: '-4' }), 'o')).toBe(-4);
		expect(signedIntField(fd({ o: '12' }), 'o')).toBe(12);
		for (const bad of ['', '-', '1.5', '+3', 'x', '--1', '1234567'])
			expect(() => signedIntField(fd({ o: bad }), 'o')).toThrow(BadInput);
	});

	it('textField / enumField', () => {
		expect(textField(fd({ k: ' show:1 ' }), 'k')).toBe('show:1');
		expect(() => textField(fd({ k: '  ' }), 'k')).toThrow(BadInput);
		expect(() => textField(fd({ k: 'x'.repeat(11) }), 'k', 10)).toThrow(BadInput);
		expect(enumField(fd({ kind: 'movie' }), 'kind', ['movie', 'series'] as const)).toBe('movie');
		expect(() => enumField(fd({ kind: 'Movie' }), 'kind', ['movie', 'series'] as const)).toThrow(BadInput);
		expect(() => enumField(fd({}), 'kind', ['movie'] as const)).toThrow(BadInput);
	});

	it('starsField: empty clears, 1..5 accepted, anything else rejected', () => {
		expect(starsField(fd({ stars: '' }))).toBeNull();
		expect(starsField(fd({ stars: '1' }))).toBe(1);
		expect(starsField(fd({ stars: '5' }))).toBe(5);
		for (const bad of ['0', '6', '2.5', 'x', '-3'])
			expect(() => starsField(fd({ stars: bad }))).toThrow(BadInput);
		expect(() => starsField(fd({}))).toThrow(BadInput);
	});

	it('boolField / optBoolField', () => {
		expect(boolField(fd({ v: '1' }), 'v')).toBe(true);
		expect(boolField(fd({ v: 'false' }), 'v')).toBe(false);
		expect(() => boolField(fd({ v: 'yes' }), 'v')).toThrow(BadInput);
		expect(optBoolField(fd({ v: '' }), 'v')).toBeNull();
		expect(optBoolField(fd({ v: 'auto' }), 'v')).toBeNull();
		expect(optBoolField(fd({ v: '0' }), 'v')).toBe(false);
		expect(() => optBoolField(fd({ v: '2' }), 'v')).toThrow(BadInput);
	});

	it('handleBadInput turns BadInput into fail(400) and rethrows other errors', async () => {
		const r = await handleBadInput(() => intField(fd({ id: 'x' }), 'id'));
		expect(r).toMatchObject({ status: 400, data: { message: 'invalid id' } });
		expect(await handleBadInput(() => 7)).toBe(7);
		await expect(handleBadInput(() => { throw new Error('boom'); })).rejects.toThrow('boom');
	});
});

describe('format helpers', () => {
	it('epCode pads to two digits', () => {
		expect(epCode(2, 5)).toBe('S02E05');
		expect(epCode(10, 123)).toBe('S10E123');
	});
	it('shortDate', () => {
		expect(shortDate('2026-11-25', 2026)).toBe('Wed 25 Nov');
		expect(shortDate('2027-01-02', 2026)).toBe('Sat 2 Jan 2027');
	});
});
