import type { Db } from './db/client';
import { syncAllDue, type TmdbLike } from './titles/sync';

type Log = Pick<Console, 'info' | 'warn' | 'error'>;

export interface SchedulerOptions {
	/** Time between runs. Default: one hour. */
	intervalMs?: number;
	/** Delay before the first run, so startup and the first request are not slowed. Default: 10 s. */
	initialDelayMs?: number;
	log?: Log;
}

/**
 * Background air-date sync. Calls syncAllDue (which itself only picks shows not synced in the
 * last 20 h) once `initialDelayMs` after start, then every `intervalMs`. A tick that fires while
 * the previous run is still pending is skipped, so runs never overlap. Per-show failures are
 * logged (their data is untouched by syncSeries); a run that rejects outright is logged and the
 * next tick still runs. Returns a stop function.
 */
export function startScheduler(
	db: Db,
	tmdb: TmdbLike,
	{ intervalMs = 3_600_000, initialDelayMs = 10_000, log = console }: SchedulerOptions = {}
): () => void {
	let running = false;
	let stopped = false;

	const tick = async () => {
		if (running || stopped) return;
		running = true;
		const started = Date.now();
		try {
			const { ok, failed } = await syncAllDue(db, tmdb);
			for (const f of failed) log.warn(`[sync] title ${f.titleId} failed: ${f.error}`);
			log.info(`[sync] done: ${ok} ok, ${failed.length} failed (${Date.now() - started} ms)`);
		} catch (e) {
			log.error(`[sync] run failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			running = false;
		}
	};

	let interval: ReturnType<typeof setInterval> | undefined;
	const first = setTimeout(() => {
		void tick();
		interval = setInterval(() => void tick(), intervalMs);
		interval.unref?.();
	}, initialDelayMs);
	first.unref?.();

	return () => {
		stopped = true;
		clearTimeout(first);
		if (interval) clearInterval(interval);
	};
}
