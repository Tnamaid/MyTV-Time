import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { openDb, type Db } from '#lib/server/db/client.ts';
import { startScheduler } from '#lib/server/scheduler.ts';
import { TmdbClient, type TmdbApi } from '#lib/server/tmdb/client.ts';

// One database connection and one TMDB client per process, created lazily
// (never at import time, so `vite build` never opens the database).
let db: Db | undefined;
let tmdb: Promise<TmdbApi | null> | undefined;

const getDb = () => (db ??= openDb(process.env.DB_PATH || './data/tracker.db'));
const getTmdb = () => (tmdb ??= createTmdb());

async function createTmdb(): Promise<TmdbApi | null> {
	if (process.env.TMDB_FAKE === '1') {
		// Offline fixtures for e2e tests; only loaded when asked for.
		const { FakeTmdbClient } = await import('#lib/server/tmdb/fake.ts');
		return new FakeTmdbClient();
	}
	const key = process.env.TMDB_API_KEY;
	return key ? new TmdbClient(key) : null;
}

// The flag lives on globalThis so a dev-mode hot reload of this module cannot start a second one.
const SCHEDULER = Symbol.for('mytv-time.scheduler');
const g = globalThis as { [SCHEDULER]?: boolean };

/**
 * Runs once when the server starts (adapter-node calls it before listening): starts the hourly
 * air-date sync. Not during `vite build`, not with fake TMDB fixtures, not without a TMDB key,
 * and not under Vitest.
 */
export const init: ServerInit = async () => {
	if (building || g[SCHEDULER]) return;
	if (process.env.TMDB_FAKE === '1' || process.env.VITEST || !process.env.TMDB_API_KEY) return;
	const client = await getTmdb();
	if (!client) return;
	g[SCHEDULER] = true;
	startScheduler(getDb(), client);
	console.info('[sync] scheduler started (first run in 10 s, then hourly)');
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.db = getDb();
	event.locals.tmdb = await getTmdb();
	return resolve(event);
};
