import type { Handle } from '@sveltejs/kit/hooks';
import { openDb, type Db } from '#lib/server/db/client.ts';
import { TmdbClient, type TmdbApi } from '#lib/server/tmdb/client.ts';

// One database connection and one TMDB client per process, created on the first request
// (not at import time, so `vite build` never opens the database). No scheduler here (Task 12).
let db: Db | undefined;
let tmdb: Promise<TmdbApi | null> | undefined;

async function createTmdb(): Promise<TmdbApi | null> {
	if (process.env.TMDB_FAKE === '1') {
		// Offline fixtures for e2e tests; only loaded when asked for.
		const { FakeTmdbClient } = await import('#lib/server/tmdb/fake.ts');
		return new FakeTmdbClient();
	}
	const key = process.env.TMDB_API_KEY;
	return key ? new TmdbClient(key) : null;
}

export const handle: Handle = async ({ event, resolve }) => {
	db ??= openDb(process.env.DB_PATH || './data/tracker.db');
	tmdb ??= createTmdb();
	event.locals.db = db;
	event.locals.tmdb = await tmdb;
	return resolve(event);
};
