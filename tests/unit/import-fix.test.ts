import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../../src/lib/server/db/client';
import { episode, importIssue, title, watch, watchlist } from '../../src/lib/server/db/schema';
import type { ImportBundle, ImportEpisodeWatch, ImportMovie, ImportShow } from '../../src/lib/server/import/merge';
import { runImport } from '../../src/lib/server/import/resolve';
import {
	dismissIssue, fixEpisodes, fixMovie, fixShow, listOpenIssues, previewEpisodeMapping
} from '../../src/lib/server/import/fix';
import { addSeries } from '../../src/lib/server/titles/service';
import { ep, fakeTmdb, show } from './fakeTmdb';

const sh = (tvdbId: number, name: string, over: Partial<ImportShow> = {}): [number, ImportShow] => [
	tvdbId, { tvdbId, name, followed: false, archived: false, forLater: false, ...over }
];
let n = 0;
const ew = (tvdbSeriesId: number, seriesName: string, season: number, e: number, tvdbEpisodeId: number): ImportEpisodeWatch => {
	const watchedAt = `2021-01-01T10:${String(n++ % 60).padStart(2, '0')}:00Z`;
	return {
		tvdbSeriesId, tvdbEpisodeId, season, episode: e, seriesName, watchedAt, isRewatch: false,
		source: 'tvtime1', importKey: `ep:${tvdbEpisodeId}:${watchedAt.slice(0, 16)}`
	};
};
const mv = (uuid: string, name: string, releaseYear: number | null, forLater = false): [string, ImportMovie] => [
	uuid,
	{ uuid, name, releaseYear, forLater, watches: [{ at: '2022-02-01T20:00:00Z', source: 'tvtime2' as const, importKey: `mv:${uuid}:1` }] }
];
const movieDetails = (id: number, t: string, date: string) => ({
	id, title: t, original_title: t, release_date: date, poster_path: null, overview: '', genres: []
});

// Import-time TMDB knows nothing: everything becomes an issue.
const emptyTmdb = () => fakeTmdb({});
const fixTmdb = () =>
	fakeTmdb({
		shows: {
			20: show({ id: 20, name: 'Twenty', external_ids: { tvdb_id: 200 }, seasons: [{ season_number: 1, name: 'S1', air_date: '2020-01-01' }, { season_number: 2, name: 'S2', air_date: '2021-01-01' }] }),
			30: show({ id: 30, name: 'Anime', external_ids: { tvdb_id: 300 }, seasons: [{ season_number: 1, name: 'S1', air_date: '2020-01-01' }, { season_number: 2, name: 'S2', air_date: '2021-01-01' }] })
		},
		seasons: {
			'20:1': { episodes: [ep(1, 1), ep(1, 2)] },
			'20:2': { episodes: [ep(2, 1)] },
			'30:1': { episodes: [ep(1, 1), ep(1, 2)] },
			'30:2': { episodes: Array.from({ length: 12 }, (_, i) => ep(2, i + 1, { name: `Ep ${i + 1}` })) }
		},
		movies: { 80: movieDetails(80, 'Zed', '2015-01-01'), 81: movieDetails(81, 'Nodate', '2000-01-01') }
	});

async function seed(): Promise<Db> {
	n = 0;
	const db = openDb(':memory:');
	const bundle: ImportBundle = {
		shows: new Map([
			sh(200, 'Twenty', { followed: true, archived: true, forLater: true }),
			sh(300, 'Anime')
		]),
		episodeWatches: [
			ew(200, 'Twenty', 1, 1, 7001),
			ew(200, 'Twenty', 1, 2, 7002),
			ew(200, 'Twenty', 3, 1, 7003), // no S3 on TMDB
			ew(300, 'Anime', 1, 30, 6030),
			ew(300, 'Anime', 1, 31, 6031),
			ew(300, 'Anime', 1, 40, 6040)
		],
		movies: new Map([mv('u-zed', 'Zed', 2015, true), mv('u-nd', 'Nodate', null)])
	};
	await runImport(db, emptyTmdb(), bundle, { dryRun: false });
	return db;
}

const issue = (db: Db, key: string) => db.select().from(importIssue).where(eq(importIssue.key, key)).get()!;
const watchesOf = (db: Db, tvdb: number) => db.select().from(watch).where(eq(watch.rawTvdbSeriesId, tvdb)).all();

test('listOpenIssues: unresolved only, parsed, ordered by kind then label', async () => {
	const db = await seed();
	const list = listOpenIssues(db);
	expect(list.map((i) => i.kind)).toEqual(['movie', 'movie', 'show', 'show']);
	expect(list.map((i) => i.label)).toEqual(['Nodate', 'Zed (2015)', 'Anime (tvdb 300)', 'Twenty (tvdb 200)']);
	expect(list[3].meta).toMatchObject({ tvdbId: 200, followed: true });
	expect(list[0].candidates).toEqual([]);
	expect(list[3].candidates).toBeNull();
	dismissIssue(db, 'movie:u-nd');
	expect(listOpenIssues(db)).toHaveLength(3);
});

test('fixShow links the show, applies meta flags, relinks watches, leftovers become episode issues', async () => {
	const db = await seed();
	await fixShow(db, fixTmdb(), 'show:200', 20);
	const t = db.select().from(title).where(eq(title.tmdbId, 20)).get()!;
	expect(t).toMatchObject({ followed: true, archived: true, tvdbId: 200 });
	expect(db.select().from(watchlist).where(eq(watchlist.titleId, t.id)).all()).toHaveLength(1);
	const ws = watchesOf(db, 200);
	expect(ws.every((w) => w.titleId === t.id)).toBe(true);
	expect(ws.filter((w) => w.episodeId !== null)).toHaveLength(2);
	expect(issue(db, 'show:200').resolved).toBe(true);
	const ei = issue(db, 'episode:200:3');
	expect(ei).toMatchObject({ kind: 'episode', resolved: false, label: 'Twenty S3 — 1 unmatched episode' });
	expect(JSON.parse(ei.metaJson!)).toEqual({ tvdbId: 200, rawSeason: 3 });
	expect(db.select().from(importIssue).where(eq(importIssue.key, 'episode:200:1')).get()).toBeUndefined();
});

test('anime absolute numbering: S1E30 + {targetSeason 2, offset -25} -> S2E5', async () => {
	const db = await seed();
	await fixShow(db, fixTmdb(), 'show:300', 30);
	const t = db.select().from(title).where(eq(title.tmdbId, 30)).get()!;
	expect(watchesOf(db, 300).every((w) => w.episodeId === null)).toBe(true);
	expect(issue(db, 'episode:300:1').resolved).toBe(false);

	const r = fixEpisodes(db, t.id, 1, { targetSeason: 2, offset: -25 });
	expect(r).toEqual({ linked: 2, unlinked: 1 }); // E40 -> S2E15 does not exist
	const e30 = watchesOf(db, 300).find((w) => w.rawEpisode === 30)!;
	const target = db.select().from(episode).where(eq(episode.id, e30.episodeId!)).get()!;
	expect([target.seasonNumber, target.episodeNumber]).toEqual([2, 5]);
	expect(issue(db, 'episode:300:1').resolved).toBe(false);

	// Fix the stray one with a different offset; only unlinked watches are touched.
	const r2 = fixEpisodes(db, t.id, 1, { targetSeason: 2, offset: -30 });
	expect(r2).toEqual({ linked: 1, unlinked: 0 });
	expect(watchesOf(db, 300).find((w) => w.rawEpisode === 30)!.episodeId).toBe(e30.episodeId);
	expect(issue(db, 'episode:300:1').resolved).toBe(true);
});

test('previewEpisodeMapping is read-only and names the targets', async () => {
	const db = await seed();
	await fixShow(db, fixTmdb(), 'show:300', 30);
	const t = db.select().from(title).where(eq(title.tmdbId, 30)).get()!;
	const p = previewEpisodeMapping(db, t.id, 1, { targetSeason: 2, offset: -25 });
	expect(p).toEqual([
		{ rawSeason: 1, rawEpisode: 30, targetSeason: 2, targetEpisode: 5, targetName: 'Ep 5' },
		{ rawSeason: 1, rawEpisode: 31, targetSeason: 2, targetEpisode: 6, targetName: 'Ep 6' },
		{ rawSeason: 1, rawEpisode: 40, targetSeason: 2, targetEpisode: 15, targetName: null }
	]);
	expect(previewEpisodeMapping(db, t.id, 1, { targetSeason: 2, offset: -25 }, 1)).toHaveLength(1);
	expect(watchesOf(db, 300).every((w) => w.episodeId === null)).toBe(true);
});

test('fixMovie links by name + year (including null year), applies forLater, resolves', async () => {
	const db = await seed();
	await fixMovie(db, fixTmdb(), 'movie:u-zed', 80);
	const zed = db.select().from(title).where(eq(title.tmdbId, 80)).get()!;
	const zw = db.select().from(watch).where(eq(watch.rawMovieName, 'Zed')).all();
	expect(zw.every((w) => w.titleId === zed.id)).toBe(true);
	expect(db.select().from(watchlist).where(eq(watchlist.titleId, zed.id)).all()).toHaveLength(1);
	expect(issue(db, 'movie:u-zed').resolved).toBe(true);

	await fixMovie(db, fixTmdb(), 'movie:u-nd', 81);
	const nd = db.select().from(title).where(eq(title.tmdbId, 81)).get()!;
	expect(db.select().from(watch).where(eq(watch.rawMovieName, 'Nodate')).get()!.titleId).toBe(nd.id);
	expect(db.select().from(watchlist).where(eq(watchlist.titleId, nd.id)).all()).toHaveLength(0);
});

test('dismissIssue keeps watches untouched; unknown keys throw', async () => {
	const db = await seed();
	const before = db.select().from(watch).all();
	dismissIssue(db, 'show:200');
	expect(issue(db, 'show:200').resolved).toBe(true);
	expect(db.select().from(watch).all()).toEqual(before);
	expect(() => dismissIssue(db, 'show:999')).toThrow();
	await expect(fixShow(db, fixTmdb(), 'show:999', 1)).rejects.toThrow();
	await expect(fixMovie(db, fixTmdb(), 'movie:nope', 1)).rejects.toThrow();
});

test('fixEpisodes resolves the issue by the raw tvdb id even when the title carries a different tvdb id', async () => {
	const db = await seed();
	const tmdb = fixTmdb();
	const titleId = await addSeries(db, tmdb, 20);
	db.update(title).set({ tvdbId: 999 }).where(eq(title.id, titleId)).run();
	await fixShow(db, tmdb, 'show:200', 20);
	expect(db.select().from(title).where(eq(title.id, titleId)).get()!.tvdbId).toBe(999);
	expect(issue(db, 'episode:200:3').resolved).toBe(false);
	expect(fixEpisodes(db, titleId, 3, { targetSeason: 1, offset: 0 })).toEqual({ linked: 1, unlinked: 0 });
	expect(issue(db, 'episode:200:3').resolved).toBe(true);
});
