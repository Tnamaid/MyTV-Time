import { expect, test } from 'vitest';
import { openDb } from '../../src/lib/server/db/client';
import { episode, importIssue, season, title, watch, watchlist } from '../../src/lib/server/db/schema';
import { exportAll } from '../../src/lib/server/export';

function seed() {
	const db = openDb(':memory:');
	const at = '2026-01-01T00:00:00.000Z';
	const show = db.insert(title).values({ kind: 'series', tmdbId: 1, name: 'Show', addedAt: at, stars: 4 }).returning().get();
	const movie = db.insert(title).values({ kind: 'movie', tmdbId: 2, name: 'Movie', addedAt: at }).returning().get();
	db.insert(season).values({ titleId: show.id, number: 1, name: 'Season 1' }).run();
	const e1 = db.insert(episode).values({ titleId: show.id, seasonNumber: 1, episodeNumber: 1 }).returning().get();
	db.insert(episode).values({ titleId: show.id, seasonNumber: 1, episodeNumber: 2 }).run();
	db.insert(watch).values({ titleId: show.id, episodeId: e1.id, watchedAt: at, source: 'app' }).run();
	db.insert(watch).values({ titleId: show.id, episodeId: e1.id, watchedAt: at, source: 'app' }).run();
	db.insert(watch).values({ titleId: movie.id, watchedAt: at, source: 'tvtime1', rawMovieName: 'Movie' }).run();
	// An unlinked imported watch (no title yet) must be exported too.
	db.insert(watch).values({ watchedAt: at, source: 'tvtime2', rawTvdbSeriesId: 77, rawSeason: 1, rawEpisode: 3 }).run();
	db.insert(watchlist).values({ titleId: movie.id, addedAt: at }).run();
	db.insert(importIssue).values({ kind: 'show', key: 'show:77', label: 'Unknown (77)', createdAt: at }).run();
	return db;
}

test('exportAll returns every row of every table as plain objects', () => {
	const db = seed();
	const out = exportAll(db);
	expect(out.titles).toHaveLength(2);
	expect(out.seasons).toHaveLength(1);
	expect(out.episodes).toHaveLength(2);
	expect(out.watches).toHaveLength(4);
	expect(out.watchlist).toHaveLength(1);
	expect(out.importIssues).toHaveLength(1);
	expect(out.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	expect(out.titles.find((t) => t.name === 'Show')).toMatchObject({ kind: 'series', stars: 4, tmdbId: 1 });
});

test('export survives a JSON round trip with identical row counts', () => {
	const db = seed();
	const back = JSON.parse(JSON.stringify(exportAll(db)));
	const counts = (o: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(o).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
	expect(counts(back)).toEqual({ titles: 2, seasons: 1, episodes: 2, watches: 4, watchlist: 1, importIssues: 1 });
	expect(back.watches.find((w: { titleId: number | null }) => w.titleId === null)).toMatchObject({ rawTvdbSeriesId: 77 });
});

test('empty database exports empty arrays', () => {
	const out = exportAll(openDb(':memory:'));
	expect([out.titles, out.seasons, out.episodes, out.watches, out.watchlist, out.importIssues].every((a) => a.length === 0)).toBe(true);
});
