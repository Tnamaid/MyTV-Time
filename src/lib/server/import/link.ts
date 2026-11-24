import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episode, title } from '../db/schema';
import { TmdbError, type TmdbClient } from '../tmdb/client';

export type LinkTmdb = Pick<TmdbClient, 'getEpisodeExternalIds'>;

/** The raw TV Time identity of an episode watch, all that linking needs. */
export type RawEpisode = { tvdbEpisodeId: number; season: number; episode: number };

/**
 * Per-title errors become import issues; anything else aborts the run:
 * TMDB 401/403 (bad key/config) and non-TmdbErrors (bugs, network down).
 */
export function recoverable(e: unknown): string {
	if (e instanceof TmdbError && e.status !== 401 && e.status !== 403) return e.message;
	throw e;
}

export function episodeIssueLabel(showName: string, tvdbId: number, season: number, count: number, error: string | null = null): string {
	const text = `${showName || `tvdb ${tvdbId}`} S${season} — ${count} unmatched episode${count === 1 ? '' : 's'}`;
	return error ? `${text} (TMDB error: ${error})` : text;
}

/**
 * A synced episode whose persisted tvdb_id equals the raw tvdb episode id
 * wins (no TMDB call; guards renumbered shows where the raw (season,
 * episode) points at a different TMDB episode). Otherwise match each watch
 * by (season, episode) among the title's synced episodes.
 * For any miss, once per title: fetch tvdb ids for synced episodes that lack
 * one (sequentially, persisted for cheap re-runs), then match on the raw tvdb
 * episode id. A failing lookup stops the fallback; the error ends up in the
 * episode issue label.
 */
export async function resolveEpisodes<T extends RawEpisode>(
	db: Db,
	tmdb: LinkTmdb,
	titleId: number,
	ws: T[]
): Promise<{ ids: Map<T, number | null>; error: string | null }> {
	const out = new Map<T, number | null>();
	const eps = db.select().from(episode).where(eq(episode.titleId, titleId)).all();
	const bySe = new Map(eps.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e.id]));
	const knownTvdb = new Map(eps.filter((e) => e.tvdbId !== null).map((e) => [e.tvdbId!, e.id]));
	const misses: T[] = [];
	for (const w of ws) {
		const id = knownTvdb.get(w.tvdbEpisodeId) ?? bySe.get(`${w.season}:${w.episode}`);
		if (id !== undefined) out.set(w, id);
		else misses.push(w);
	}
	if (!misses.length) return { ids: out, error: null };

	const showTmdbId = db.select({ tmdbId: title.tmdbId }).from(title).where(eq(title.id, titleId)).get()!.tmdbId;
	let error: string | null = null;
	try {
		for (const e of eps) {
			if (e.tvdbId !== null) continue;
			const { tvdb_id } = await tmdb.getEpisodeExternalIds(showTmdbId, e.seasonNumber, e.episodeNumber);
			if (tvdb_id === null) continue;
			db.update(episode).set({ tvdbId: tvdb_id }).where(eq(episode.id, e.id)).run();
			e.tvdbId = tvdb_id;
		}
	} catch (err) {
		error = recoverable(err);
	}
	const byTvdb = new Map(eps.filter((e) => e.tvdbId !== null).map((e) => [e.tvdbId!, e.id]));
	for (const w of misses) out.set(w, byTvdb.get(w.tvdbEpisodeId) ?? null);
	return { ids: out, error };
}
