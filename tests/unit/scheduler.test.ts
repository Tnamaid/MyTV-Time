import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Db } from '../../src/lib/server/db/client';
import type { TmdbLike } from '../../src/lib/server/titles/sync';

vi.mock('../../src/lib/server/titles/sync', () => ({ syncAllDue: vi.fn() }));

const { syncAllDue } = await import('../../src/lib/server/titles/sync');
const { startScheduler } = await import('../../src/lib/server/scheduler');

const sync = vi.mocked(syncAllDue);
const db = {} as Db;
const tmdb = {} as TmdbLike;
const HOUR = 3_600_000;

function makeLog() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A promise whose settlement the test controls. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

let stop: (() => void) | undefined;

beforeEach(() => {
	vi.useFakeTimers();
	sync.mockReset();
});

afterEach(() => {
	stop?.();
	stop = undefined;
	vi.useRealTimers();
});

test('runs shortly after start, then once per interval', async () => {
	sync.mockResolvedValue({ ok: 0, failed: [] });
	stop = startScheduler(db, tmdb, { intervalMs: HOUR, log: makeLog() });
	expect(sync).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(10_000);
	expect(sync).toHaveBeenCalledTimes(1);
	expect(sync).toHaveBeenCalledWith(db, tmdb);
	await vi.advanceTimersByTimeAsync(HOUR);
	expect(sync).toHaveBeenCalledTimes(2);
	await vi.advanceTimersByTimeAsync(HOUR);
	expect(sync).toHaveBeenCalledTimes(3);
});

test('never overlaps: ticks while a run is pending are skipped', async () => {
	const first = deferred<{ ok: number; failed: { titleId: number; error: string }[] }>();
	sync.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: 0, failed: [] });
	stop = startScheduler(db, tmdb, { intervalMs: HOUR, log: makeLog() });
	await vi.advanceTimersByTimeAsync(10_000);
	await vi.advanceTimersByTimeAsync(2 * HOUR); // two more ticks while the first is still pending
	expect(sync).toHaveBeenCalledTimes(1);
	first.resolve({ ok: 1, failed: [] });
	await vi.advanceTimersByTimeAsync(HOUR);
	expect(sync).toHaveBeenCalledTimes(2);
});

test('a rejected run is logged and the next tick still runs', async () => {
	const log = makeLog();
	sync.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: 2, failed: [] });
	stop = startScheduler(db, tmdb, { intervalMs: HOUR, log });
	await vi.advanceTimersByTimeAsync(10_000);
	expect(log.error).toHaveBeenCalledTimes(1);
	expect(String(log.error.mock.calls[0].join(' '))).toContain('boom');
	await vi.advanceTimersByTimeAsync(HOUR);
	expect(sync).toHaveBeenCalledTimes(2);
	expect(log.error).toHaveBeenCalledTimes(1);
});

test('each failed entry is logged, plus a one-line summary', async () => {
	const log = makeLog();
	sync.mockResolvedValue({
		ok: 3,
		failed: [
			{ titleId: 7, error: 'TMDB 429' },
			{ titleId: 9, error: 'TMDB 500' }
		]
	});
	stop = startScheduler(db, tmdb, { intervalMs: HOUR, log });
	await vi.advanceTimersByTimeAsync(10_000);
	const warned = log.warn.mock.calls.map((c) => c.join(' '));
	expect(warned.some((l) => l.includes('7') && l.includes('TMDB 429'))).toBe(true);
	expect(warned.some((l) => l.includes('9') && l.includes('TMDB 500'))).toBe(true);
	const summary = log.info.mock.calls.map((c) => c.join(' ')).join('\n');
	expect(summary).toMatch(/3 ok/);
	expect(summary).toMatch(/2 failed/);
});

test('stop() prevents further runs', async () => {
	sync.mockResolvedValue({ ok: 0, failed: [] });
	stop = startScheduler(db, tmdb, { intervalMs: HOUR, log: makeLog() });
	await vi.advanceTimersByTimeAsync(10_000);
	stop();
	await vi.advanceTimersByTimeAsync(5 * HOUR);
	expect(sync).toHaveBeenCalledTimes(1);
});

test('stop() before the first run cancels it', async () => {
	sync.mockResolvedValue({ ok: 0, failed: [] });
	stop = startScheduler(db, tmdb, { intervalMs: HOUR, log: makeLog() });
	stop();
	await vi.advanceTimersByTimeAsync(5 * HOUR);
	expect(sync).not.toHaveBeenCalled();
});
