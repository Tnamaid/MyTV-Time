// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Db } from '#lib/server/db/client.ts';
import type { TmdbApi } from '#lib/server/tmdb/client.ts';

declare global {
	namespace App {
		interface Error {
			message: string;
		}
		interface Locals {
			db: Db;
			/** null when neither TMDB_API_KEY nor TMDB_FAKE=1 is set. */
			tmdb: TmdbApi | null;
		}
	}
}

export {};
