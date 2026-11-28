import { expect, test } from 'vitest';
import { openDb } from '../../src/lib/server/db/client';
import { episode, title, watch, watchlist } from '../../src/lib/server/db/schema';
import { getUpNext } from '../../src/lib/server/queries/upNext';
import { getUpcoming } from '../../src/lib/server/queries/upcoming';
import { searchLibrary } from '../../src/lib/server/queries/library';

const TODAY = '2026-06-01';
type Db = ReturnType<typeof openDb>;
let n = 0;

function addTitle(db: Db, v: Partial<typeof title.$inferInsert> = {}) {
	n++;
	return db
		.insert(title)
		.values({ kind: 'series', tmdbId: n, name: `Show ${n}`, followed: true, addedAt: '2026-01-01T00:00:00.000Z', ...v })
		.returning()
		.get();
}
function addEps(db: Db, titleId: number, rows: [number, number, string | null][]) {
	return Object.fromEntries(
		rows.map(([s, e, d]) => [
			`${s}x${e}`,
			db.insert(episode).values({ titleId, seasonNumber: s, episodeNumber: e, airDate: d, name: `E${s}x${e}` }).returning().get()
		])
	);
}
function addWatch(db: Db, titleId: number, episodeId: number | null, at = '2026-05-01T00:00:00.000Z') {
	db.insert(watch).values({ titleId, episodeId, watchedAt: at, source: 'app' }).run();
}
const aired = (s: number, count: number): [number, number, string][] =>
	Array.from({ length: count }, (_, i) => [s, i + 1, '2020-01-01']);

test('gap: watched E1,E3-E5 of 6 -> next is E6 (gap ignored), remaining 1', () => {
	const db = openDb(':memory:');
	const t = addTitle(db);
	const eps = addEps(db, t.id, aired(1, 6));
	for (const k of ['1x1', '1x3', '1x4', '1x5']) addWatch(db, t.id, eps[k].id);
	const r = getUpNext(db, TODAY);
	expect(r).toHaveLength(1);
	expect([r[0].season, r[0].episode, r[0].remainingAired]).toEqual([1, 6, 1]);
	expect(r[0].lastWatchedAt).toBe('2026-05-01T00:00:00.000Z');
});

test('no watches, followed -> S1E1 with remaining count, lastWatchedAt null', () => {
	const db = openDb(':memory:');
	const t = addTitle(db);
	addEps(db, t.id, [[0, 1, '2019-01-01'], ...aired(1, 3)]);
	const r = getUpNext(db, TODAY);
	expect([r[0].season, r[0].episode, r[0].remainingAired, r[0].lastWatchedAt]).toEqual([1, 1, 3, null]);
});

test('watch only on S0E1 -> next is S1E1', () => {
	const db = openDb(':memory:');
	const t = addTitle(db);
	const eps = addEps(db, t.id, [[0, 1, '2019-01-01'], ...aired(1, 2)]);
	addWatch(db, t.id, eps['0x1'].id);
	expect(getUpNext(db, TODAY).map((i) => [i.season, i.episode])).toEqual([[1, 1]]);
});

test('next episode with null air_date (TBA) -> absent from Up next and Upcoming', () => {
	const db = openDb(':memory:');
	const t = addTitle(db);
	const eps = addEps(db, t.id, [[1, 1, '2020-01-01'], [1, 2, null], [1, 3, '2020-02-01']]);
	addWatch(db, t.id, eps['1x1'].id);
	expect(getUpNext(db, TODAY)).toEqual([]);
	expect(getUpcoming(db, TODAY)).toEqual([]);
});

test('future next episode -> absent from Up next, present in Upcoming within 30 days only', () => {
	const db = openDb(':memory:');
	const t = addTitle(db);
	const eps = addEps(db, t.id, [[1, 1, '2020-01-01'], [1, 2, '2026-06-10'], [1, 3, '2026-07-01'], [1, 4, '2026-07-02'], [1, 5, '2026-06-01']]);
	addWatch(db, t.id, eps['1x1'].id);
	expect(getUpNext(db, TODAY).map((i) => i.episode)).toEqual([]);
	expect(getUpcoming(db, TODAY).map((i) => i.episode)).toEqual([2, 3]);
	expect(getUpcoming(db, TODAY, 10).map((i) => i.episode)).toEqual([2]);
});

test('Upcoming excludes specials, sorted by date', () => {
	const db = openDb(':memory:');
	const a = addTitle(db, { name: 'A' });
	const b = addTitle(db, { name: 'B' });
	addEps(db, a.id, [[0, 1, '2026-06-05'], [1, 1, '2026-06-20']]);
	addEps(db, b.id, [[1, 1, '2026-06-02']]);
	expect(getUpcoming(db, TODAY).map((i) => [i.name, i.airDate])).toEqual([['B', '2026-06-02'], ['A', '2026-06-20']]);
});

test('all aired watched (ended) -> absent; no aired episodes -> absent, no crash', () => {
	const db = openDb(':memory:');
	const t = addTitle(db, { status: 'Ended' });
	const eps = addEps(db, t.id, aired(1, 2));
	addWatch(db, t.id, eps['1x1'].id);
	addWatch(db, t.id, eps['1x2'].id);
	const u = addTitle(db);
	addEps(db, u.id, [[1, 1, '2099-01-01'], [1, 2, null]]);
	addTitle(db); // no episodes at all
	expect(getUpNext(db, TODAY)).toEqual([]);
});

test('archived or unfollowed -> absent from Up next and Upcoming', () => {
	const db = openDb(':memory:');
	const a = addTitle(db, { archived: true });
	const b = addTitle(db, { followed: false });
	for (const t of [a, b]) addEps(db, t.id, [[1, 1, '2020-01-01'], [2, 1, '2026-06-10']]);
	expect(getUpNext(db, TODAY)).toEqual([]);
	expect(getUpcoming(db, TODAY)).toEqual([]);
});

test('Up next sorted by lastWatchedAt desc, nulls last', () => {
	const db = openDb(':memory:');
	const a = addTitle(db, { name: 'A' });
	const b = addTitle(db, { name: 'B' });
	const c = addTitle(db, { name: 'C' });
	const ea = addEps(db, a.id, aired(1, 2));
	const eb = addEps(db, b.id, aired(1, 2));
	addEps(db, c.id, aired(1, 2));
	addWatch(db, a.id, ea['1x1'].id, '2026-01-01T00:00:00.000Z');
	addWatch(db, b.id, eb['1x1'].id, '2026-03-01T00:00:00.000Z');
	expect(getUpNext(db, TODAY).map((i) => i.name)).toEqual(['B', 'A', 'C']);
});

test('searchLibrary: anime respects override; q finds Naruto; escapes wildcards', () => {
	const db = openDb(':memory:');
	addTitle(db, { name: 'Naruto', originalName: 'ナルト', isAnime: true });
	addTitle(db, { name: 'Fake Anime', isAnime: true, isAnimeOverride: false });
	addTitle(db, { name: 'Cartoon', isAnime: false, isAnimeOverride: true });
	addTitle(db, { name: '100% Wolf', isAnime: false });
	addTitle(db, { kind: 'movie', name: 'Akira', isAnime: true });
	expect(searchLibrary(db, { kind: 'anime' }).map((i) => i.name)).toEqual(['Cartoon', 'Naruto']);
	expect(searchLibrary(db, { q: 'naru' }).map((i) => i.name)).toEqual(['Naruto']);
	expect(searchLibrary(db, { q: 'ナ' }).map((i) => i.name)).toEqual(['Naruto']);
	expect(searchLibrary(db, { q: '%' }).map((i) => i.name)).toEqual(['100% Wolf']);
	expect(searchLibrary(db, { q: '_' })).toEqual([]);
	expect(searchLibrary(db, { kind: 'movie' }).map((i) => i.name)).toEqual(['Akira']);
	expect(searchLibrary(db, { kind: 'series' })).toHaveLength(4);
});

test('searchLibrary: filters, counts and sorts', () => {
	const db = openDb(':memory:');
	const a = addTitle(db, { name: 'alpha', stars: 3 });
	const b = addTitle(db, { name: 'Beta', stars: 5, followed: false });
	addTitle(db, { name: 'Gamma', archived: true });
	const ea = addEps(db, a.id, aired(1, 2));
	addWatch(db, a.id, ea['1x1'].id, '2026-02-01T00:00:00.000Z');
	addWatch(db, a.id, ea['1x2'].id, '2026-04-01T00:00:00.000Z');
	addWatch(db, b.id, null, '2026-03-01T00:00:00.000Z');
	const all = searchLibrary(db, {});
	expect(all.map((i) => i.name)).toEqual(['alpha', 'Beta', 'Gamma']);
	expect(all[0]).toMatchObject({ watchCount: 2, lastWatchedAt: '2026-04-01T00:00:00.000Z', isAnime: false, stars: 3 });
	expect(searchLibrary(db, { stars: 5 }).map((i) => i.name)).toEqual(['Beta']);
	expect(searchLibrary(db, { followed: false }).map((i) => i.name)).toEqual(['Beta']);
	expect(searchLibrary(db, { archived: true }).map((i) => i.name)).toEqual(['Gamma']);
	expect(searchLibrary(db, { sort: 'lastWatched' }).map((i) => i.name)).toEqual(['alpha', 'Beta', 'Gamma']);
	expect(searchLibrary(db, { sort: 'stars' }).map((i) => i.name)).toEqual(['Beta', 'alpha', 'Gamma']);
});

test('watchlist series ("to watch later") stay out of Up next until watched', () => {
	const db = openDb(':memory:');
	const t = addTitle(db);
	addEps(db, t.id, aired(1, 3));
	db.insert(watchlist).values({ titleId: t.id, addedAt: '2026-01-01T00:00:00.000Z' }).run();
	expect(getUpNext(db, TODAY)).toEqual([]);
	db.delete(watchlist).run();
	expect(getUpNext(db, TODAY).map((i) => i.episode)).toEqual([1]);
});
