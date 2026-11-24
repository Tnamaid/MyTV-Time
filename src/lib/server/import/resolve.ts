import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episode, importIssue, title, watch } from '../db/schema';
import type { TmdbClient } from '../tmdb/client';
import { addMovie, addSeries, addToWatchlist, setArchived } from '../titles/service';
import type { TmdbLike } from '../titles/sync';
import type { ImportBundle, ImportEpisodeWatch, ImportMovie, ImportShow } from './merge';
import { pickMovie, type MovieCandidate } from './movieMatch';

export { normaliseTitle } from './movieMatch';

export type ImportTmdb = TmdbLike & Pick<TmdbClient, 'findByTvdb' | 'searchMovie' | 'getEpisodeExternalIds'>;

export type ImportReport = {
	shows: number;
	showsUnmatched: number;
	episodeWatches: number;
	episodeWatchesUnmatched: number;
	movies: number;
	moviesUnmatched: number;
	/** Watchlist additions requested this run (matched for_later items); idempotent, so re-runs report the same number. */
	watchlist: number;
	/** Watch inserts that hit ON CONFLICT(import_key), i.e. already imported. */
	skippedExisting: number;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Write a merged TV Time bundle into the db. TMDB failures for one show/movie
 * are recorded as import issues and never abort the run; every watch is
 * stored (with its raw TV Time fields) whether or not it could be linked.
 * Re-runnable: watches dedupe on import_key, issues on key.
 *
 * dryRun: everything (TMDB lookups included) runs inside a manual
 * transaction that is always rolled back. Nested db.transaction() calls
 * become SAVEPOINTs on the same better-sqlite3 connection. Nothing else may
 * use this connection while a dry run is in flight.
 */
export async function runImport(
	db: Db,
	tmdb: ImportTmdb,
	bundle: ImportBundle,
	opts: { dryRun: boolean }
): Promise<ImportReport> {
	if (!opts.dryRun) return doImport(db, tmdb, bundle);
	db.$client.exec('BEGIN');
	try {
		return await doImport(db, tmdb, bundle);
	} finally {
		if (db.$client.inTransaction) db.$client.exec('ROLLBACK');
	}
}

async function doImport(db: Db, tmdb: ImportTmdb, bundle: ImportBundle): Promise<ImportReport> {
	const report: ImportReport = {
		shows: 0, showsUnmatched: 0, episodeWatches: 0, episodeWatchesUnmatched: 0,
		movies: 0, moviesUnmatched: 0, watchlist: 0, skippedExisting: 0
	};

	const bySeries = new Map<number, ImportEpisodeWatch[]>();
	for (const w of bundle.episodeWatches) {
		let list = bySeries.get(w.tvdbSeriesId);
		if (!list) bySeries.set(w.tvdbSeriesId, (list = []));
		list.push(w);
	}
	const shows = new Map(bundle.shows);
	for (const [tvdbId, ws] of bySeries) {
		if (!shows.has(tvdbId))
			shows.set(tvdbId, { tvdbId, name: ws[0].seriesName, followed: false, archived: false, forLater: false });
	}

	for (const s of shows.values()) await importShow(db, tmdb, s, bySeries.get(s.tvdbId) ?? [], report);
	for (const m of bundle.movies.values()) await importMovie(db, tmdb, m, report);
	return report;
}

function insertIssue(db: Db, kind: 'show' | 'episode' | 'movie', key: string, label: string, candidates?: MovieCandidate[]) {
	db.insert(importIssue)
		.values({
			kind, key, label,
			candidatesJson: candidates ? JSON.stringify(candidates) : null,
			createdAt: new Date().toISOString()
		})
		.onConflictDoNothing({ target: importIssue.key })
		.run();
}

function insertWatch(db: Db, row: typeof watch.$inferInsert, report: ImportReport) {
	const r = db.insert(watch).values(row).onConflictDoNothing({ target: watch.importKey }).run();
	if (r.changes === 0) report.skippedExisting++;
}

async function importShow(db: Db, tmdb: ImportTmdb, s: ImportShow, ws: ImportEpisodeWatch[], report: ImportReport) {
	report.shows++;
	report.episodeWatches += ws.length;

	let titleId: number | null = null;
	let error: string | null = null;
	try {
		const tmdbId = await tmdb.findByTvdb(s.tvdbId);
		if (tmdbId !== null) titleId = await addSeries(db, tmdb, tmdbId, { follow: s.followed, tvdbId: s.tvdbId });
	} catch (e) {
		error = errText(e);
	}

	const resolved =
		titleId === null ? { ids: new Map<ImportEpisodeWatch, number | null>(), error: null } : await resolveEpisodes(db, tmdb, titleId, ws);

	// One synchronous connection: db.* calls inside the callback join the transaction.
	db.transaction(() => {
		const label = `${s.name || 'Unknown show'} (tvdb ${s.tvdbId})`;
		if (titleId === null) {
			report.showsUnmatched++;
			insertIssue(db, 'show', `show:${s.tvdbId}`, error ? `${label} — TMDB error: ${error}` : label);
		} else {
			if (s.archived) setArchived(db, titleId, true);
			if (s.forLater) {
				addToWatchlist(db, titleId);
				report.watchlist++;
			}
		}

		const unmatchedBySeason = new Map<number, number>();
		for (const w of ws) {
			const episodeId = resolved.ids.get(w) ?? null;
			if (episodeId === null) {
				report.episodeWatchesUnmatched++;
				if (titleId !== null) unmatchedBySeason.set(w.season, (unmatchedBySeason.get(w.season) ?? 0) + 1);
			}
			insertWatch(db, {
				titleId, episodeId, watchedAt: w.watchedAt, source: w.source, importKey: w.importKey,
				rawTvdbSeriesId: w.tvdbSeriesId, rawTvdbEpisodeId: w.tvdbEpisodeId,
				rawSeason: w.season, rawEpisode: w.episode, rawSeriesName: w.seriesName
			}, report);
		}
		for (const [season, count] of unmatchedBySeason) {
			const text = `${s.name || `tvdb ${s.tvdbId}`} S${season} — ${count} unmatched episode${count === 1 ? '' : 's'}`;
			insertIssue(db, 'episode', `episode:${s.tvdbId}:${season}`, resolved.error ? `${text} (TMDB error: ${resolved.error})` : text);
		}
	});
}

/**
 * Match each watch by (season, episode) among the title's synced episodes.
 * For any miss, once per title: fetch tvdb ids for synced episodes that lack
 * one (sequentially, persisted for cheap re-runs), then match on the raw tvdb
 * episode id. A failing lookup stops the fallback; the error ends up in the
 * episode issue label.
 */
async function resolveEpisodes(
	db: Db,
	tmdb: ImportTmdb,
	titleId: number,
	ws: ImportEpisodeWatch[]
): Promise<{ ids: Map<ImportEpisodeWatch, number | null>; error: string | null }> {
	const out = new Map<ImportEpisodeWatch, number | null>();
	const eps = db.select().from(episode).where(eq(episode.titleId, titleId)).all();
	const bySe = new Map(eps.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e.id]));
	const misses: ImportEpisodeWatch[] = [];
	for (const w of ws) {
		const id = bySe.get(`${w.season}:${w.episode}`);
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
		error = errText(err);
	}
	const byTvdb = new Map(eps.filter((e) => e.tvdbId !== null).map((e) => [e.tvdbId!, e.id]));
	for (const w of misses) out.set(w, byTvdb.get(w.tvdbEpisodeId) ?? null);
	return { ids: out, error };
}

async function importMovie(db: Db, tmdb: ImportTmdb, m: ImportMovie, report: ImportReport) {
	report.movies++;
	let titleId: number | null = null;
	let candidates: MovieCandidate[] | undefined;
	let error: string | null = null;
	try {
		const results = await tmdb.searchMovie(m.name, m.releaseYear ?? undefined);
		const pick = pickMovie(m.name, m.releaseYear, results);
		if (pick.match) titleId = await addMovie(db, tmdb, pick.match.id);
		else candidates = pick.candidates;
	} catch (e) {
		error = errText(e);
	}

	db.transaction(() => {
		if (titleId === null) {
			report.moviesUnmatched++;
			const label = `${m.name}${m.releaseYear === null ? '' : ` (${m.releaseYear})`}`;
			insertIssue(db, 'movie', `movie:${m.uuid}`, error ? `${label} — TMDB error: ${error}` : label, candidates);
		} else if (m.forLater) {
			addToWatchlist(db, titleId);
			report.watchlist++;
		}
		for (const w of m.watches) {
			insertWatch(db, {
				titleId, episodeId: null, watchedAt: w.at, source: w.source, importKey: w.importKey,
				rawMovieName: m.name, rawMovieYear: m.releaseYear
			}, report);
		}
	});
}
