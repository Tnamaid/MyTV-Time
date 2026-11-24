import { afterEach, expect, test, vi } from 'vitest';
import { today } from '../../src/lib/server/time';

afterEach(() => vi.useRealTimers());

test('today respects tz', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-24T23:30:00Z'));
	expect(today('Europe/Paris')).toBe('2026-11-25');
	expect(today('UTC')).toBe('2026-11-24');
});
