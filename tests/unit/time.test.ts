import { afterEach, expect, test, vi } from 'vitest';
import { today } from '../../src/lib/server/time';

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
