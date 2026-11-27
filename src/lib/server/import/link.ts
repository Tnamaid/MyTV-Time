import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episode, title } from '../db/schema';
import { TmdbError, type TmdbClient } from '../tmdb/client';

export type LinkTmdb = Pick<TmdbClient, 'getEpisodeExternalIds'>;

/** The raw TV Time identity of an episode watch, all that linking needs. Any part may be missing. */
export type RawEpisode = { tvdbEpisodeId: number | null; season: number | null; episode: number | null };

/** TmdbError statuses that abort an import run instead of becoming an issue. */
const FATAL_STATUSES = new Set([
	0, // network unreachable / timeouts, after the client's own retries
	401, // bad API key
	403
]);

/**
 * Per-title errors (TMDB 404, 5xx/429 after retries, ...) become import issues;
 * anything else aborts the run: TMDB 401/403 (bad key/config), status 0
 * (network down even after retries) and non-TmdbErrors (bugs).
 */
export function recoverable(e: unknown): string {
	if (e instanceof TmdbError && !FATAL_STATUSES.has(e.status)) return e.message;
	throw e;
}

export function episodeIssueLabel(showName: string, tvdbId: number, season: number | null, count: number, error: string | null = null): string {
	const where = season === null ? 'no season number' : `S${season}`;
	const text = `${showName || `tvdb ${tvdbId}`} ${where} — ${count} unmatched episode${count === 1 ? '' : 's'}`;
	return error ? `${text} (TMDB error: ${error})` : text;
}

/**
 * A synced episode whose persisted tvdb_id equals the raw tvdb episode id
 * wins (no TMDB call; guards renumbered shows where the raw (season,
 * episode) points at a different TMDB episode). Otherwise match each watch
 * by (season, episode) among the title's synced episodes.
 *
 * For the misses, fetch tvdb ids (one TMDB call per episode, sequentially,
 * persisted for cheap re-runs) only where they can plausibly be:
 *  1. the TMDB seasons whose numbers equal the raw seasons that had misses;
 *  2. only if step 1 linked none of the misses, every remaining season, once.
 * Step 2 catches shows renumbered across seasons (TV Time S2 = TMDB S1); a
 * season where step 1 links some misses but not all leaves the rest for
 * Fix imports instead of sweeping a whole long-running show for one miss.
 * Episodes that already have a tvdb_id are never re-fetched. A failing lookup
 * stops the fallback; the error ends up in the episode issue label.
 *
 * Incomplete rows: a watch with no season number (empty s_no) can only be
 * found by its tvdb id, so if any is still unlinked after step 1 the
 * remaining seasons are swept even when step 1 linked others. A watch with
 * no tvdb id (empty ep_id) can only match by (season, episode) and never
 * triggers a sweep.
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
		const id =
			(w.tvdbEpisodeId === null ? undefined : knownTvdb.get(w.tvdbEpisodeId)) ??
			(w.season === null || w.episode === null ? undefined : bySe.get(`${w.season}:${w.episode}`));
		if (id !== undefined) out.set(w, id);
		else if (w.tvdbEpisodeId === null) out.set(w, null); // nothing a tvdb sweep could find
		else misses.push(w);
	}
	if (!misses.length) return { ids: out, error: null };

	const showTmdbId = db.select({ tmdbId: title.tmdbId }).from(title).where(eq(title.id, titleId)).get()!.tmdbId;
	const sweep = async (inScope: (seasonNumber: number) => boolean) => {
		for (const e of eps) {
			if (e.tvdbId !== null || !inScope(e.seasonNumber)) continue;
			const { tvdb_id } = await tmdb.getEpisodeExternalIds(showTmdbId, e.seasonNumber, e.episodeNumber);
			if (tvdb_id === null) continue;
			db.update(episode).set({ tvdbId: tvdb_id }).where(eq(episode.id, e.id)).run();
			e.tvdbId = tvdb_id;
		}
		const byTvdb = new Map(eps.filter((e) => e.tvdbId !== null).map((e) => [e.tvdbId!, e.id]));
		let linked = 0;
		for (const w of misses) {
			const id = byTvdb.get(w.tvdbEpisodeId!) ?? null;
			if (id !== null) linked++;
			out.set(w, id);
		}
		return linked;
	};

	let error: string | null = null;
	try {
		const missSeasons = new Set(misses.flatMap((w) => (w.season === null ? [] : [w.season])));
		const linked = missSeasons.size ? await sweep((n) => missSeasons.has(n)) : 0;
		const seasonlessLeft = misses.some((w) => w.season === null && (out.get(w) ?? null) === null);
		if (linked === 0 || seasonlessLeft) await sweep((n) => !missSeasons.has(n));
	} catch (err) {
		error = recoverable(err);
		// Keep whatever the lookups so far linked.
		const byTvdb = new Map(eps.filter((e) => e.tvdbId !== null).map((e) => [e.tvdbId!, e.id]));
		for (const w of misses) out.set(w, byTvdb.get(w.tvdbEpisodeId!) ?? null);
	}
	return { ids: out, error };
}

/**
 * Key and meta of an `episode` import issue; one definition for importer and fixer.
 * Watches with no season number (empty s_no) share one issue per show, `episode:<tvdb>:none`.
 */
export const episodeIssueKey = (tvdbId: number, season: number | null) => `episode:${tvdbId}:${season ?? 'none'}`;
export const episodeIssueMeta = (tvdbId: number, season: number | null) => ({ tvdbId, rawSeason: season });
