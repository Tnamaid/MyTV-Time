import { describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb, type Db } from '../../src/lib/server/db/client';
import { episode, importIssue, title, watch, watchlist } from '../../src/lib/server/db/schema';
import type { ImportBundle, ImportEpisodeWatch, ImportMovie, ImportShow } from '../../src/lib/server/import/merge';
import { addSeries } from '../../src/lib/server/titles/service';
import { formatSanity, normaliseTitle, runImport } from '../../src/lib/server/import/resolve';
import { TmdbError, type MovieSearchResult } from '../../src/lib/server/tmdb/client';
import { ep, fakeTmdb, show } from './fakeTmdb';

const sh = (tvdbId: number, name: string, over: Partial<ImportShow> = {}): [number, ImportShow] => [
	tvdbId,
	{ tvdbId, name, followed: false, archived: false, forLater: false, ...over }
];

let n = 0;
const ew = (tvdbSeriesId: number, seriesName: string, season: number, e: number, tvdbEpisodeId: number): ImportEpisodeWatch => {
	const watchedAt = `2021-01-01T10:${String(n++ % 60).padStart(2, '0')}:00Z`;
	return {
		tvdbSeriesId, tvdbEpisodeId, season, episode: e, seriesName, watchedAt, isRewatch: false,
		source: 'tvtime1', importKey: `ep:${tvdbEpisodeId}:${watchedAt.slice(0, 16)}`
	};
};

const mv = (uuid: string, name: string, releaseYear: number | null, watches: number, forLater = false): [string, ImportMovie] => [
	uuid,
	{
		uuid, name, releaseYear, forLater,
		watches: Array.from({ length: watches }, (_, i) => ({
			at: `2022-02-0${i + 1}T20:00:00Z`, source: 'tvtime2' as const, importKey: `mv:${uuid}:2022-02-0${i + 1}T20:00`
		}))
	}
];

const res = (id: number, t: string, date: string): MovieSearchResult => ({
	id, title: t, original_title: t, release_date: date, poster_path: `/p${id}.jpg`
});
const movieDetails = (id: number, t: string, date: string) => ({
	id, title: t, original_title: t, release_date: date, poster_path: null, overview: '', genres: []
});

function makeTmdb() {
	return fakeTmdb({
		tvdb: { 100: 1, 300: 3, 400: 4, 500: new TmdbError(500, 'boom 500') },
		shows: {
			1: show({ id: 1, name: 'Alpha', external_ids: { tvdb_id: 100 } }),
			3: show({ id: 3, name: 'Gamma', external_ids: { tvdb_id: 300 } }),
			4: show({ id: 4, name: 'Delta', external_ids: { tvdb_id: 400 } })
		},
		seasons: {
			'1:1': { episodes: [ep(1, 1), ep(1, 2)] },
			'3:1': { episodes: [ep(1, 1)] },
			'4:1': { episodes: [ep(1, 1), ep(1, 2), ep(1, 3)] }
		},
		episodeTvdb: { '4:1:1': 9001, '4:1:2': 9002, '4:1:3': 9005 },
		movieSearch: {
			'Amélie!': [res(50, 'Amelie', '2001-04-25'), res(59, 'Amelie 2', '2001-01-01')],
			Twin: [res(60, 'Twin', '2010-01-01'), res(61, 'Twin', '2010-06-01'), res(62, 'Twins', '1988-01-01')],
			Later: [res(52, 'Later', '2020-05-05')],
			Nada: [res(70, 'Nada', '1999-01-01'), res(71, 'Nada Mas', '2003-01-01')]
		},
		movies: {
			50: movieDetails(50, 'Amelie', '2001-04-25'),
			52: movieDetails(52, 'Later', '2020-05-05'),
			70: movieDetails(70, 'Nada', '1999-01-01')
		}
	});
}

function makeBundle(): ImportBundle {
	n = 0;
	return {
		shows: new Map([
			sh(100, 'Alpha', { followed: true, archived: true }),
			sh(200, 'Unknown Show'),
			sh(300, 'Gamma', { forLater: true }),
			sh(400, 'Delta', { followed: true }),
			sh(500, 'Broken')
		]),
		episodeWatches: [
			ew(100, 'Alpha', 1, 1, 8001),
			ew(100, 'Alpha', 1, 2, 8002),
			ew(200, 'Unknown Show', 1, 1, 7001),
			ew(200, 'Unknown Show', 1, 2, 7002),
			ew(400, 'Delta', 2, 5, 9005), // renumbered: TMDB has it as S1E3
			ew(400, 'Delta', 2, 6, 9006), // nowhere on TMDB
			ew(500, 'Broken', 1, 1, 6001)
		],
		movies: new Map([
			mv('u-amelie', 'Amélie!', 2001, 1),
			mv('u-twin', 'Twin', 2010, 2),
			mv('u-later', 'Later', 2020, 0, true),
			mv('u-nada', 'Nada', null, 1)
		])
	};
}

const counts = (db: Db) => ({
	title: db.select().from(title).all().length,
	watch: db.select().from(watch).all().length,
	issue: db.select().from(importIssue).all().length,
	watchlist: db.select().from(watchlist).all().length,
	episode: db.select().from(episode).all().length
});

test('normaliseTitle', () => {
	expect(normaliseTitle('  Amélie!  ')).toBe('amelie');
	expect(normaliseTitle('Spider-Man:  Into the   Spider-Verse')).toBe('spiderman into the spiderverse');
	expect(normaliseTitle('Æon $ Flux')).toBe('æon flux');
});

test('report counts on a fresh import', async () => {
	const db = openDb(':memory:');
	const r = await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	expect(r).toEqual({
		shows: 5,
		showsUnmatched: 2, // 200 not found, 500 TMDB error
		episodeWatches: 7,
		episodeWatchesUnmatched: 4, // 2x show 200, 1x show 500, Delta S2E6
		movies: 4,
		moviesUnmatched: 1, // Twin
		watchlist: 2, // Gamma (show for_later) + Later (movie for_later)
		skippedExisting: 0,
		sanity: {
			skippedRowsNoEpisodeId: { tvtime1: 0, tvtime2: 0 },
			expectedEpisodesSeen: null, // no show has nb_episodes_seen
			importedDistinctEpisodes: 0,
			showsBelowExpected: [],
			showsBelowExpectedTotal: 0
		}
	});
});

test('sanity: skipped rows, nb_episodes_seen vs distinct imported episodes, short shows', async () => {
	const db = openDb(':memory:');
	const bundle = makeBundle();
	const set = (id: number, nb: number) => bundle.shows.set(id, { ...bundle.shows.get(id)!, nbEpisodesSeen: nb });
	set(100, 2); // Alpha: 2 distinct imported -> fine
	set(200, 3); // Unknown Show (unmatched): 2 imported -> short by 1
	set(400, 5); // Delta: 2 imported -> short by 3
	set(300, 0); // Gamma: 0 / 0
	// a rewatch of Alpha S1E1 counts once
	bundle.episodeWatches.push({ ...bundle.episodeWatches[0], watchedAt: '2022-01-01T00:00:00Z', importKey: 'ep:8001:2022-01-01T00:00', isRewatch: true });
	bundle.skippedRowsNoEpisodeId = { tvtime1: 2, tvtime2: 1 };
	const r = await runImport(db, makeTmdb(), bundle, { dryRun: false });
	expect(r.sanity).toEqual({
		skippedRowsNoEpisodeId: { tvtime1: 2, tvtime2: 1 },
		expectedEpisodesSeen: 10,
		importedDistinctEpisodes: 6, // over the 4 shows that have nb_episodes_seen
		showsBelowExpected: [
			{ name: 'Delta', tvdbId: 400, imported: 2, expected: 5 },
			{ name: 'Unknown Show', tvdbId: 200, imported: 2, expected: 3 }
		],
		showsBelowExpectedTotal: 2
	});
	const text = formatSanity(r).join('\n');
	expect(text).toContain('export 1: 2, export 2: 1');
	expect(text).toMatch(/nb_episodes_seen.*10/);
	expect(text).toMatch(/imported.*6/);
	expect(text).toContain('Delta (tvdb 400): 2 imported, TV Time says 5');
});

test('sanity: lists at most 10 short shows, biggest gap first', async () => {
	const db = openDb(':memory:');
	const shows = new Map(Array.from({ length: 12 }, (_, i) => sh(1000 + i, `S${i}`, { nbEpisodesSeen: i + 1 })));
	const r = await runImport(db, fakeTmdb({}), { shows, episodeWatches: [], movies: new Map() }, { dryRun: true });
	expect(r.sanity.showsBelowExpectedTotal).toBe(12);
	expect(r.sanity.showsBelowExpected).toHaveLength(10);
	expect(r.sanity.showsBelowExpected[0]).toEqual({ name: 'S11', tvdbId: 1011, imported: 0, expected: 12 });
	expect(formatSanity(r).join('\n')).toContain('…and 2 more');
});

test('running twice does not duplicate watches or issues (Review Focus 1)', async () => {
	const db = openDb(':memory:');
	const first = await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const before = counts(db);
	const second = await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	expect(counts(db)).toEqual(before);
	const totalWatchRows = 7 + 1 + 2 + 1; // episodes + Amelie + Twin x2 + Nada
	expect(before.watch).toBe(totalWatchRows);
	expect(first.skippedExisting).toBe(0);
	// watchlist counts additions actually applied: none on a re-run (titles already existed)
	expect(second).toEqual({ ...first, skippedExisting: totalWatchRows, watchlist: 0 });
});

test('unknown tvdb id -> show issue, watches kept with raw fields and null title_id', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const issue = db.select().from(importIssue).where(eq(importIssue.key, 'show:200')).get()!;
	expect(issue.kind).toBe('show');
	expect(issue.label).toBe('Unknown Show (tvdb 200)');
	expect(issue.resolved).toBe(false);
	const ws = db.select().from(watch).where(eq(watch.rawTvdbSeriesId, 200)).all();
	expect(ws).toHaveLength(2);
	for (const w of ws) {
		expect(w.titleId).toBeNull();
		expect(w.episodeId).toBeNull();
		expect(w.source).toBe('tvtime1');
		expect(w.rawSeriesName).toBe('Unknown Show');
		expect(w.rawSeason).toBe(1);
	}
	expect(ws.map((w) => [w.rawEpisode, w.rawTvdbEpisodeId]).sort()).toEqual([[1, 7001], [2, 7002]]);
	// no episode issue for an unmatched show: the show issue covers it
	expect(db.select().from(importIssue).where(eq(importIssue.key, 'episode:200:1')).get()).toBeUndefined();
});

test('matched episode watches have title, episode and all raw fields', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const w = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 8002)).get()!;
	const e = db.select().from(episode).where(eq(episode.id, w.episodeId!)).get()!;
	expect([e.seasonNumber, e.episodeNumber]).toEqual([1, 2]);
	expect(w.titleId).toBe(e.titleId);
	expect(w).toMatchObject({
		watchedAt: '2021-01-01T10:01:00Z', source: 'tvtime1', importKey: 'ep:8002:2021-01-01T10:01',
		rawTvdbSeriesId: 100, rawSeason: 1, rawEpisode: 2, rawSeriesName: 'Alpha'
	});
});

test('episode tvdb-id fallback links a renumbered episode; truly missing -> episode issue', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const delta = db.select().from(title).where(eq(title.tmdbId, 4)).get()!;
	const w = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9005)).get()!;
	const e = db.select().from(episode).where(eq(episode.id, w.episodeId!)).get()!;
	expect([e.titleId, e.seasonNumber, e.episodeNumber, e.tvdbId]).toEqual([delta.id, 1, 3, 9005]);
	expect(w.rawSeason).toBe(2);
	// tvdb ids persisted on the episode rows for cheap re-runs
	const eps = db.select().from(episode).where(eq(episode.titleId, delta.id)).all();
	expect(eps.map((x) => x.tvdbId).sort()).toEqual([9001, 9002, 9005]);

	const missing = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9006)).get()!;
	expect(missing.titleId).toBe(delta.id);
	expect(missing.episodeId).toBeNull();
	const issue = db.select().from(importIssue).where(eq(importIssue.key, 'episode:400:2')).get()!;
	expect(issue.kind).toBe('episode');
	expect(issue.label).toBe('Delta S2 — 1 unmatched episode');
});

test('fallback lookups are not repeated on re-run once tvdb ids are stored', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const t = makeTmdb();
	let calls = 0;
	const orig = t.getEpisodeExternalIds;
	t.getEpisodeExternalIds = async (...a) => (calls++, orig(...a));
	await runImport(db, t, makeBundle(), { dryRun: false });
	expect(calls).toBe(0);
});

test('TMDB error on one show does not abort the others', async () => {
	const db = openDb(':memory:');
	const r = await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	expect(r.shows).toBe(5);
	const issue = db.select().from(importIssue).where(eq(importIssue.key, 'show:500')).get()!;
	expect(issue.label).toContain('Broken (tvdb 500)');
	expect(issue.label).toContain('boom 500');
	const w = db.select().from(watch).where(eq(watch.rawTvdbSeriesId, 500)).get()!;
	expect(w.titleId).toBeNull();
	expect(w.rawTvdbEpisodeId).toBe(6001);
	// shows after the broken one in other orders still imported
	expect(db.select().from(title).where(eq(title.kind, 'series')).all().map((x) => x.tmdbId).sort()).toEqual([1, 3, 4]);
});

test('TMDB error on a movie search does not abort the import', async () => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	const orig = t.searchMovie;
	t.searchMovie = async (q, y) => {
		if (q === 'Amélie!') throw new TmdbError(503, 'search down');
		return orig(q, y);
	};
	const r = await runImport(db, t, makeBundle(), { dryRun: false });
	expect(r.moviesUnmatched).toBe(2);
	const issue = db.select().from(importIssue).where(eq(importIssue.key, 'movie:u-amelie')).get()!;
	expect(issue.label).toContain('search down');
	expect(db.select().from(watch).where(eq(watch.rawMovieName, 'Amélie!')).get()!.titleId).toBeNull();
});

test('movie auto-match: exact normalised title + year; null year searched without year', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const amelie = db.select().from(title).where(eq(title.tmdbId, 50)).get()!;
	expect(amelie.kind).toBe('movie');
	const w = db.select().from(watch).where(eq(watch.titleId, amelie.id)).get()!;
	expect(w).toMatchObject({
		episodeId: null, rawMovieName: 'Amélie!', rawMovieYear: 2001, source: 'tvtime2',
		watchedAt: '2022-02-01T20:00:00Z', importKey: 'mv:u-amelie:2022-02-01T20:00'
	});
	const nada = db.select().from(title).where(eq(title.tmdbId, 70)).get()!;
	const nw = db.select().from(watch).where(eq(watch.titleId, nada.id)).get()!;
	expect(nw.rawMovieYear).toBeNull();
	expect(db.select().from(importIssue).where(eq(importIssue.key, 'movie:u-nada')).get()).toBeUndefined();
});

test('ambiguous movie -> issue with candidates, watches kept with raw fields', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const issue = db.select().from(importIssue).where(eq(importIssue.key, 'movie:u-twin')).get()!;
	expect(issue.kind).toBe('movie');
	expect(issue.label).toBe('Twin (2010)');
	const cands = JSON.parse(issue.candidatesJson!);
	expect(cands).toEqual([
		{ id: 60, title: 'Twin', release_date: '2010-01-01', poster_path: '/p60.jpg' },
		{ id: 61, title: 'Twin', release_date: '2010-06-01', poster_path: '/p61.jpg' }
	]);
	const ws = db.select().from(watch).where(eq(watch.rawMovieName, 'Twin')).all();
	expect(ws).toHaveLength(2);
	for (const w of ws) expect([w.titleId, w.episodeId, w.rawMovieYear]).toEqual([null, null, 2010]);
	expect(db.select().from(title).where(eq(title.kind, 'movie')).all().map((t) => t.tmdbId).sort()).toEqual([50, 52, 70]);
});

test('candidates are capped at 5', async () => {
	const db = openDb(':memory:');
	const many = Array.from({ length: 8 }, (_, i) => res(100 + i, 'Same', '2000-01-01'));
	const t = fakeTmdb({ movieSearch: { Same: many } });
	await runImport(db, t, { shows: new Map(), episodeWatches: [], movies: new Map([mv('u-s', 'Same', 2000, 1)]) }, { dryRun: false });
	expect(JSON.parse(db.select().from(importIssue).get()!.candidatesJson!)).toHaveLength(5);
});

test('archived, followed and for_later flags applied', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const alpha = db.select().from(title).where(eq(title.tmdbId, 1)).get()!;
	expect([alpha.followed, alpha.archived, alpha.tvdbId]).toEqual([true, true, 100]);
	const gamma = db.select().from(title).where(eq(title.tmdbId, 3)).get()!;
	expect([gamma.followed, gamma.archived]).toEqual([false, false]);
	const later = db.select().from(title).where(eq(title.tmdbId, 52)).get()!;
	const wl = db.select().from(watchlist).all().map((w) => w.titleId).sort();
	expect(wl).toEqual([gamma.id, later.id].sort());
});

test('dryRun: report non-zero, DB tables empty after', async () => {
	const db = openDb(':memory:');
	const r = await runImport(db, makeTmdb(), makeBundle(), { dryRun: true });
	expect(r.shows).toBe(5);
	expect(r.episodeWatches).toBe(7);
	expect(r.movies).toBe(4);
	expect(r.watchlist).toBe(2);
	expect(counts(db)).toEqual({ title: 0, watch: 0, issue: 0, watchlist: 0, episode: 0 });
	expect(db.$client.inTransaction).toBe(false);
	// the real run afterwards gives the same report
	expect(await runImport(db, makeTmdb(), makeBundle(), { dryRun: false })).toEqual(r);
});

test('dryRun rolls back even when the import throws', async () => {
	const db = openDb(':memory:');
	const bundle = makeBundle();
	// force a NOT NULL failure on the last write
	bundle.movies.get('u-nada')!.watches[0].at = null as unknown as string;
	await expect(runImport(db, makeTmdb(), bundle, { dryRun: true })).rejects.toThrow();
	expect(db.$client.inTransaction).toBe(false);
	expect(counts(db)).toEqual({ title: 0, watch: 0, issue: 0, watchlist: 0, episode: 0 });
});

const empty = { title: 0, watch: 0, issue: 0, watchlist: 0, episode: 0 };

test.each([401, 403])('TMDB %i on the first show aborts the run and leaves the DB unchanged', async (status) => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	t.findByTvdb = async () => {
		throw new TmdbError(status);
	};
	await expect(runImport(db, t, makeBundle(), { dryRun: false })).rejects.toMatchObject({ status });
	expect(db.$client.inTransaction).toBe(false);
	expect(counts(db)).toEqual(empty);
});

test('auth error late in the run rolls back earlier writes; prior data untouched', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const before = counts(db);
	const t = makeTmdb();
	t.searchMovie = async () => {
		throw new TmdbError(401);
	};
	const bundle = makeBundle();
	bundle.shows.set(999, { tvdbId: 999, name: 'New', followed: false, archived: false, forLater: false });
	await expect(runImport(db, t, bundle, { dryRun: false })).rejects.toBeInstanceOf(TmdbError);
	expect(counts(db)).toEqual(before);
	expect(db.select().from(importIssue).where(eq(importIssue.key, 'show:999')).get()).toBeUndefined();
});

test('auth error during episode fallback aborts too', async () => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	t.getEpisodeExternalIds = async () => {
		throw new TmdbError(401);
	};
	await expect(runImport(db, t, makeBundle(), { dryRun: false })).rejects.toBeInstanceOf(TmdbError);
	expect(counts(db)).toEqual(empty);
});

test('non-TmdbError (programming/network error) aborts instead of becoming an issue', async () => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	t.findByTvdb = async () => {
		throw new TypeError('fetch failed');
	};
	await expect(runImport(db, t, makeBundle(), { dryRun: false })).rejects.toThrow('fetch failed');
	expect(counts(db)).toEqual(empty);
});

test('network failure after the client gave up (TmdbError status 0) aborts and rolls back', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const before = counts(db);
	const t = makeTmdb();
	t.searchMovie = async () => {
		throw new TmdbError(0, 'network error: TypeError: fetch failed');
	};
	const bundle = makeBundle();
	bundle.shows.set(999, { tvdbId: 999, name: 'New', followed: false, archived: false, forLater: false });
	await expect(runImport(db, t, bundle, { dryRun: false })).rejects.toMatchObject({ status: 0 });
	expect(db.$client.inTransaction).toBe(false);
	expect(counts(db)).toEqual(before);
	expect(db.select().from(importIssue).where(eq(importIssue.key, 'show:999')).get()).toBeUndefined();
});

test('other TmdbErrors (e.g. 404/500) stay per-title issues', async () => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	t.getMovie = async () => {
		throw new TmdbError(404);
	};
	const r = await runImport(db, t, makeBundle(), { dryRun: false });
	expect(r.moviesUnmatched).toBe(4);
	expect(db.select().from(importIssue).where(eq(importIssue.key, 'movie:u-amelie')).get()!.label).toContain('404');
	expect(db.$client.inTransaction).toBe(false);
});

test('persisted tvdb_id wins over a colliding (season, episode)', async () => {
	const db = openDb(':memory:');
	const t = fakeTmdb({
		tvdb: { 800: 8 },
		shows: {
			8: show({
				id: 8, name: 'Renum', external_ids: { tvdb_id: 800 },
				seasons: [
					{ season_number: 1, name: 'S1', air_date: null },
					{ season_number: 2, name: 'S2', air_date: null }
				]
			})
		},
		seasons: { '8:1': { episodes: [ep(1, 1), ep(1, 2), ep(1, 3)] }, '8:2': { episodes: [1, 2, 3, 4, 5].map((i) => ep(2, i)) } }
	});
	const titleId = await addSeries(db, t, 8);
	const s1e3 = db.select().from(episode).all().find((e) => e.seasonNumber === 1 && e.episodeNumber === 3)!;
	db.update(episode).set({ tvdbId: 9105 }).where(eq(episode.id, s1e3.id)).run();
	let calls = 0;
	t.getEpisodeExternalIds = async () => (calls++, { tvdb_id: null });
	n = 0;
	const bundle: ImportBundle = {
		shows: new Map([sh(800, 'Renum')]),
		episodeWatches: [ew(800, 'Renum', 2, 5, 9105), ew(800, 'Renum', 2, 4, 9104)],
		movies: new Map()
	};
	await runImport(db, t, bundle, { dryRun: false });
	const w = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9105)).get()!;
	expect(w.episodeId).toBe(s1e3.id);
	expect(w.titleId).toBe(titleId);
	const s2e4 = db.select().from(episode).all().find((e) => e.seasonNumber === 2 && e.episodeNumber === 4)!;
	expect(db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9104)).get()!.episodeId).toBe(s2e4.id);
	expect(calls).toBe(0);
});

const meta = (db: Db, key: string) => JSON.parse(db.select().from(importIssue).where(eq(importIssue.key, key)).get()!.metaJson!);

test('issues keep the TV Time state in meta_json', async () => {
	const db = openDb(':memory:');
	const bundle = makeBundle();
	bundle.shows.set(200, { ...bundle.shows.get(200)!, followed: true, archived: true, forLater: true });
	bundle.movies.get('u-twin')!.forLater = true;
	await runImport(db, makeTmdb(), bundle, { dryRun: false });
	expect(meta(db, 'show:200')).toEqual({ tvdbId: 200, name: 'Unknown Show', followed: true, archived: true, forLater: true });
	expect(meta(db, 'show:500')).toEqual({ tvdbId: 500, name: 'Broken', followed: false, archived: false, forLater: false });
	expect(meta(db, 'movie:u-twin')).toEqual({ uuid: 'u-twin', name: 'Twin', releaseYear: 2010, forLater: true });
	expect(meta(db, 'episode:400:2')).toEqual({ tvdbId: 400, rawSeason: 2 });
});

test('re-run refreshes meta_json of unresolved issues only', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	db.update(importIssue).set({ resolved: true }).where(eq(importIssue.key, 'show:500')).run();
	const bundle = makeBundle();
	bundle.shows.set(200, { ...bundle.shows.get(200)!, followed: true });
	bundle.shows.set(500, { ...bundle.shows.get(500)!, followed: true });
	const before = counts(db);
	await runImport(db, makeTmdb(), bundle, { dryRun: false });
	expect(counts(db)).toEqual(before);
	expect(meta(db, 'show:200').followed).toBe(true);
	expect(meta(db, 'show:500').followed).toBe(false);
});

describe('tvdb fallback sweep is limited to the seasons with misses', () => {
	const threeSeasons = (episodeTvdb: Record<string, number>) =>
		fakeTmdb({
			tvdb: { 900: 9 },
			shows: {
				9: show({
					id: 9, name: 'Wide', external_ids: { tvdb_id: 900 },
					seasons: [1, 2, 3].map((n) => ({ season_number: n, name: `S${n}`, air_date: null }))
				})
			},
			seasons: Object.fromEntries([1, 2, 3].map((n) => [`9:${n}`, { episodes: [1, 2, 3].map((i) => ep(n, i)) }])),
			episodeTvdb
		});
	const run = async (t: ReturnType<typeof threeSeasons>, w: ImportEpisodeWatch[]) => {
		const db = openDb(':memory:');
		const calls: string[] = [];
		const orig = t.getEpisodeExternalIds;
		t.getEpisodeExternalIds = async (id, s, e) => (calls.push(`${s}:${e}`), orig(id, s, e));
		await runImport(db, t, { shows: new Map([sh(900, 'Wide')]), episodeWatches: w, movies: new Map() }, { dryRun: false });
		return { db, calls };
	};

	test('a miss in raw season 2 that TMDB has in season 2 -> only season 2 is swept', async () => {
		n = 0;
		const { db, calls } = await run(threeSeasons({ '9:2:3': 9205 }), [ew(900, 'Wide', 1, 1, 9101), ew(900, 'Wide', 2, 5, 9205)]);
		expect(calls.sort()).toEqual(['2:1', '2:2', '2:3']);
		const w = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9205)).get()!;
		const e = db.select().from(episode).where(eq(episode.id, w.episodeId!)).get()!;
		expect([e.seasonNumber, e.episodeNumber]).toEqual([2, 3]);
	});

	test('no match in the miss seasons -> the remaining seasons are swept once', async () => {
		n = 0;
		const { db, calls } = await run(threeSeasons({ '9:1:2': 9105 }), [ew(900, 'Wide', 2, 5, 9105)]);
		expect(calls.slice(0, 3).sort()).toEqual(['2:1', '2:2', '2:3']);
		expect(calls.slice(3).sort()).toEqual(['1:1', '1:2', '1:3', '3:1', '3:2', '3:3']);
		const w = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9105)).get()!;
		const e = db.select().from(episode).where(eq(episode.id, w.episodeId!)).get()!;
		expect([e.seasonNumber, e.episodeNumber]).toEqual([1, 2]);
	});
});

test('re-run after using the app does not re-set followed/archived/watchlist (titles that already existed)', async () => {
	const db = openDb(':memory:');
	await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	const byTmdb = (kind: 'series' | 'movie', id: number) =>
		db.select().from(title).where(and(eq(title.kind, kind), eq(title.tmdbId, id))).get()!;
	const alpha = byTmdb('series', 1); // imported followed + archived
	const delta = byTmdb('series', 4); // imported followed
	// Gamma (series) and Later (movie) were imported for_later -> on the watchlist
	// the owner then uses the app
	db.update(title).set({ followed: false, archived: false }).where(eq(title.id, alpha.id)).run();
	db.update(title).set({ followed: false }).where(eq(title.id, delta.id)).run();
	db.delete(watchlist).run();

	const r = await runImport(db, makeTmdb(), makeBundle(), { dryRun: false });
	expect([byTmdb('series', 1).followed, byTmdb('series', 1).archived]).toEqual([false, false]);
	expect(byTmdb('series', 4).followed).toBe(false);
	expect(db.select().from(watchlist).all()).toEqual([]);
	expect(r.watchlist).toBe(0);
});

test('a title the owner added in the app before the import keeps its flags', async () => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	const alphaId = await addSeries(db, t, 1); // added from search, not followed
	await runImport(db, t, makeBundle(), { dryRun: false });
	const alpha = db.select().from(title).where(eq(title.id, alphaId)).get()!;
	expect([alpha.followed, alpha.archived]).toEqual([false, false]);
	expect(alpha.tvdbId).toBe(100); // still learns the tvdb id
	// its watches are still imported and linked
	expect(db.select().from(watch).where(eq(watch.titleId, alphaId)).all()).toHaveLength(2);
});

test('two TV Time shows on the same new TMDB title in one run both apply their flags', async () => {
	const db = openDb(':memory:');
	const t = makeTmdb();
	const orig = t.findByTvdb;
	t.findByTvdb = async (id) => (id === 101 ? 1 : orig(id));
	const bundle: ImportBundle = {
		shows: new Map([sh(100, 'Alpha'), sh(101, 'Alpha again', { followed: true, archived: true })]),
		episodeWatches: [],
		movies: new Map()
	};
	await runImport(db, t, bundle, { dryRun: false });
	const alpha = db.select().from(title).where(eq(title.tmdbId, 1)).get()!;
	expect([alpha.followed, alpha.archived]).toEqual([true, true]);
});
