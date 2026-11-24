import { resolve } from 'node:path';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	// Same default as hooks.server.ts; resolved so it is clear which file to copy.
	dbPath: resolve(process.env.DB_PATH || './data/tracker.db')
});
