import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { importIssue, title, watch } from '../db/schema';
import type { TmdbClient } from '../tmdb/client';
import { addMovie, addSeries, addToWatchlist, setArchived, setFollowed } from '../titles/service';
import type { TmdbLike } from '../titles/sync';
import type { ImportBundle, ImportEpisodeWatch, ImportMovie, ImportShow } from './merge';
import type { EpisodeRowStats } from './parse';
import { episodeIssueKey, episodeIssueLabel, episodeIssueMeta, recoverable, resolveEpisodes } from './link';
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
	/** Watchlist additions made this run (matched for_later items on titles this run created). */
	watchlist: number;
	/** Watch inserts that hit ON CONFLICT(import_key), i.e. already imported. */
	skippedExisting: number;
	/** Cross-checks against TV Time's own numbers, to spot lost history before trusting the import. */
	sanity: ImportSanity;
};

export type ImportSanity = {
	/** Per export: incomplete watch-/rewatch- rows (only noShowId ones are skipped). */
	rowStats: { tvtime1: EpisodeRowStats; tvtime2: EpisodeRowStats };
	/** Sum of nb_episodes_seen over the shows that have one (max of the two exports); null if none has. */
	expectedEpisodesSeen: number | null;
	/** Distinct episodes (raw tvdb episode ids) in this import, over those same shows. */
	importedDistinctEpisodes: number;
	/** Shows with fewer distinct imported episodes than nb_episodes_seen, biggest gap first (max 10). */
	showsBelowExpected: { name: string; tvdbId: number; imported: number; expected: number }[];
	showsBelowExpectedTotal: number;
};

const SANITY_LIST_MAX = 10;

function sanityOf(bundle: ImportBundle, shows: Map<number, ImportShow>, bySeries: Map<number, ImportEpisodeWatch[]>): ImportSanity {
	let expected: number | null = null;
	let imported = 0;
	const below: ImportSanity['showsBelowExpected'] = [];
	for (const s of shows.values()) {
		if (s.nbEpisodesSeen === null || s.nbEpisodesSeen === undefined) continue;
		// A watch with no ep_id counts by its numbers; one with neither cannot be told apart.
		const ids = (bySeries.get(s.tvdbId) ?? []).flatMap((w) =>
			w.tvdbEpisodeId !== null ? [`id:${w.tvdbEpisodeId}`] : w.season !== null && w.episode !== null ? [`se:${w.season}x${w.episode}`] : []
		);
		const distinct = new Set(ids).size;
		expected = (expected ?? 0) + s.nbEpisodesSeen;
		imported += distinct;
		if (distinct < s.nbEpisodesSeen)
			below.push({ name: s.name || 'Unknown show', tvdbId: s.tvdbId, imported: distinct, expected: s.nbEpisodesSeen });
	}
	below.sort((a, b) => b.expected - b.imported - (a.expected - a.imported) || a.tvdbId - b.tvdbId);
	const zero = (): EpisodeRowStats => ({ noShowId: 0, noEpisodeId: 0, noNumbers: 0 });
	return {
		rowStats: { tvtime1: zero(), tvtime2: zero(), ...bundle.rowStats },
		expectedEpisodesSeen: expected,
		importedDistinctEpisodes: imported,
		showsBelowExpected: below.slice(0, SANITY_LIST_MAX),
		showsBelowExpectedTotal: below.length
	};
}

/** The sanity section as text lines, printed by the CLI after the report table. */
export function formatSanity({ sanity: s }: ImportReport): string[] {
	const n = (x: number) => x.toLocaleString('en-US');
	const per = (k: keyof EpisodeRowStats) => `export 1: ${n(s.rowStats.tvtime1[k])}, export 2: ${n(s.rowStats.tvtime2[k])}`;
	const lines = [
		'Sanity check against TV Time:',
		`  Watch rows without a season or episode number (imported, linked by episode id): ${per('noNumbers')}`,
		`  Watch rows without an episode id (imported, linked by season/episode number): ${per('noEpisodeId')}`,
		`  Watch rows without a show id (cannot be imported): ${per('noShowId')}`
	];
	if (s.expectedEpisodesSeen === null) {
		lines.push('  No nb_episodes_seen in user_tv_show_data.csv: episode totals cannot be cross-checked.');
		return lines;
	}
	lines.push(
		`  Episodes seen according to TV Time (nb_episodes_seen): ${n(s.expectedEpisodesSeen)}`,
		`  Distinct episodes imported for those shows:            ${n(s.importedDistinctEpisodes)}`
	);
	if (s.showsBelowExpectedTotal === 0) {
		lines.push('  Every show has at least as many imported episodes as TV Time counted.');
		return lines;
	}
	lines.push(`  Shows with fewer imported episodes than TV Time counted: ${n(s.showsBelowExpectedTotal)}`);
	for (const x of s.showsBelowExpected)
		lines.push(`    ${x.name} (tvdb ${x.tvdbId}): ${n(x.imported)} imported, TV Time says ${n(x.expected)}`);
	if (s.showsBelowExpectedTotal > s.showsBelowExpected.length)
		lines.push(`    …and ${n(s.showsBelowExpectedTotal - s.showsBelowExpected.length)} more`);
	return lines;
}

/**
 * Write a merged TV Time bundle into the db. TMDB failures for one show/movie
 * (any TmdbError except 401/403 and network status 0) are recorded as import
 * issues and the run continues; 401/403, status 0 (network down after the
 * client's retries) and non-TmdbErrors abort and roll back. Every watch is
 * stored (with its raw TV Time fields) whether or not it could be linked.
 * Re-runnable: watches dedupe on import_key, issues on key. TV Time's
 * followed/archived/for_later flags are applied only to titles this run
 * created: a title that existed before the run (an earlier import, or added
 * in the app) keeps the state the owner gave it, so re-runs only add history.
 *
 * The whole run is one manual transaction on the connection: COMMIT at the
 * end, ROLLBACK on any thrown error (so an aborted run leaves the db
 * unchanged), and always ROLLBACK for dryRun (TMDB lookups still happen).
 * Nested db.transaction() calls become SAVEPOINTs on the same
 * better-sqlite3 connection. Nothing else may use this connection while a
 * run is in flight.
 */
export async function runImport(
	db: Db,
	tmdb: ImportTmdb,
	bundle: ImportBundle,
	opts: { dryRun: boolean }
): Promise<ImportReport> {
	const conn = db.$client;
	conn.exec('BEGIN');
	try {
		const report = await doImport(db, tmdb, bundle);
		conn.exec(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
		return report;
	} finally {
		if (conn.inTransaction) conn.exec('ROLLBACK');
	}
}

async function doImport(db: Db, tmdb: ImportTmdb, bundle: ImportBundle): Promise<ImportReport> {

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

	const report: ImportReport = {
		shows: 0, showsUnmatched: 0, episodeWatches: 0, episodeWatchesUnmatched: 0,
		movies: 0, moviesUnmatched: 0, watchlist: 0, skippedExisting: 0,
		sanity: sanityOf(bundle, shows, bySeries)
	};

	const ctx: Ctx = {
		report,
		preexisting: new Set(db.select({ id: title.id }).from(title).all().map((t) => t.id))
	};
	for (const s of shows.values()) await importShow(db, tmdb, s, bySeries.get(s.tvdbId) ?? [], ctx);
	for (const m of bundle.movies.values()) await importMovie(db, tmdb, m, ctx);
	return report;
}

type Ctx = {
	report: ImportReport;
	/** Title ids that existed before this run: their flags/watchlist are never touched. */
	preexisting: Set<number>;
};

/**
 * Insert an issue once per key. On re-run, an unresolved issue gets its
 * meta_json refreshed (the bundle is the latest union of both exports);
 * label/candidates and resolved issues are left alone.
 */
function insertIssue(
	db: Db,
	kind: 'show' | 'episode' | 'movie',
	key: string,
	label: string,
	meta: Record<string, unknown>,
	candidates?: MovieCandidate[]
) {
	const metaJson = JSON.stringify(meta);
	db.insert(importIssue)
		.values({
			kind, key, label, metaJson,
			candidatesJson: candidates ? JSON.stringify(candidates) : null,
			createdAt: new Date().toISOString()
		})
		.onConflictDoUpdate({ target: importIssue.key, set: { metaJson }, setWhere: eq(importIssue.resolved, false) })
		.run();
}

function insertWatch(db: Db, row: typeof watch.$inferInsert, report: ImportReport) {
	const r = db.insert(watch).values(row).onConflictDoNothing({ target: watch.importKey }).run();
	if (r.changes === 0) report.skippedExisting++;
}

async function importShow(db: Db, tmdb: ImportTmdb, s: ImportShow, ws: ImportEpisodeWatch[], { report, preexisting }: Ctx) {
	report.shows++;
	report.episodeWatches += ws.length;

	let titleId: number | null = null;
	let error: string | null = null;
	try {
		const tmdbId = await tmdb.findByTvdb(s.tvdbId);
		// follow is applied below, only for a title this run created.
		if (tmdbId !== null) titleId = await addSeries(db, tmdb, tmdbId, { tvdbId: s.tvdbId });
	} catch (e) {
		error = recoverable(e);
	}

	const resolved =
		titleId === null ? { ids: new Map<ImportEpisodeWatch, number | null>(), error: null } : await resolveEpisodes(db, tmdb, titleId, ws);

	// One synchronous connection: db.* calls inside the callback join the transaction.
	db.transaction(() => {
		const label = `${s.name || 'Unknown show'} (tvdb ${s.tvdbId})`;
		if (titleId === null) {
			report.showsUnmatched++;
			const meta = { tvdbId: s.tvdbId, name: s.name, followed: s.followed, archived: s.archived, forLater: s.forLater };
			insertIssue(db, 'show', `show:${s.tvdbId}`, error ? `${label} — TMDB error: ${error}` : label, meta);
		} else if (!preexisting.has(titleId)) {
			if (s.followed) setFollowed(db, titleId, true);
			if (s.archived) setArchived(db, titleId, true);
			if (s.forLater) {
				addToWatchlist(db, titleId);
				report.watchlist++;
			}
		}

		const unmatchedBySeason = new Map<number | null, number>(); // null: no season number
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
			insertIssue(db, 'episode', episodeIssueKey(s.tvdbId, season), episodeIssueLabel(s.name, s.tvdbId, season, count, resolved.error), episodeIssueMeta(s.tvdbId, season));
		}
	});
}

async function importMovie(db: Db, tmdb: ImportTmdb, m: ImportMovie, { report, preexisting }: Ctx) {
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
		error = recoverable(e);
	}

	db.transaction(() => {
		if (titleId === null) {
			report.moviesUnmatched++;
			const meta = { uuid: m.uuid, name: m.name, releaseYear: m.releaseYear, forLater: m.forLater };
			const label = `${m.name}${m.releaseYear === null ? '' : ` (${m.releaseYear})`}`;
			insertIssue(db, 'movie', `movie:${m.uuid}`, error ? `${label} — TMDB error: ${error}` : label, meta, candidates);
		} else if (m.forLater && !preexisting.has(titleId)) {
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
