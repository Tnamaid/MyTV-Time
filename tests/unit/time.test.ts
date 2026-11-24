import { afterEach, expect, test, vi } from 'vitest';
import { localDate, today } from '../../src/lib/server/time';

afterEach(() => vi.useRealTimers());

test('today respects tz', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-24T23:30:00Z'));
	expect(today('Europe/Paris')).toBe('2026-11-25');
	expect(today('UTC')).toBe('2026-11-24');
});

test('today() with no arg uses env TZ, falling back to Europe/Paris', () => {
	const saved = process.env.TZ;
	try {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-24T23:30:00Z'));
		process.env.TZ = 'UTC';
		expect(today()).toBe('2026-11-24');
		delete process.env.TZ;
		expect(today()).toBe('2026-11-25');
	} finally {
		if (saved === undefined) delete process.env.TZ;
		else process.env.TZ = saved;
	}
});

test("today() treats an empty TZ ('') like an unset one: Europe/Paris", () => {
	const saved = process.env.TZ;
	try {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-24T23:30:00Z'));
		process.env.TZ = '';
		expect(today()).toBe('2026-11-25');
	} finally {
		if (saved === undefined) delete process.env.TZ;
		else process.env.TZ = saved;
	}
});

test('localDate: an instant as YYYY-MM-DD in the given time zone', () => {
	expect(localDate('2023-03-14T23:30:00.000Z', 'Europe/Paris')).toBe('2023-03-15');
	expect(localDate('2023-03-14T23:30:00.000Z', 'UTC')).toBe('2023-03-14');
	expect(localDate(new Date('2023-07-01T12:00:00Z'), 'Europe/Paris')).toBe('2023-07-01');
});
