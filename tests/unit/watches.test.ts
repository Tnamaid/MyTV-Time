import { expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { episode, title, watch } from '../../src/lib/server/db/schema';
import {
	isWatched, markEpisode, markMovie, markSeason, markUpTo, unmarkEpisode, unmarkMovieLatest
} from '../../src/lib/server/watches/service';

const TODAY = '2026-06-01';

function seed() {
	const db = openDb(':memory:');
	const t = db.insert(title).values({ kind: 'series', tmdbId: 1, name: 'S', addedAt: '2026-01-01T00:00:00.000Z' }).returning().get();
	const rows: [number, number, string | null][] = [
		[0, 1, '2020-01-01'],
		[1, 1, '2020-01-01'], [1, 2, '2020-01-08'],
		[2, 1, '2021-01-01'], [2, 2, '2021-01-08'], [2, 3, '2021-01-15'], [2, 4, '2021-01-22'],
		[3, 1, '2099-01-01'], [3, 2, null]
	];
	const eps = Object.fromEntries(
		rows.map(([s, e, d]) => [
			`${s}x${e}`,
			db.insert(episode).values({ titleId: t.id, seasonNumber: s, episodeNumber: e, airDate: d }).returning().get()
		])
	);
	return { db, t, eps };
}
const count = (db: ReturnType<typeof openDb>) => db.select().from(watch).all().length;

test('markUpTo(S2E3) marks S1 + S2E1-3, skips S0, later and unaired; idempotent', () => {
	const { db, eps } = seed();
	markUpTo(db, eps['2x3'].id, new Date(), TODAY);
	const watched = db.select().from(watch).all();
	expect(watched).toHaveLength(5);
	expect(watched.every((w) => w.source === 'app' && w.importKey === null)).toBe(true);
	expect(watched.every((w) => w.titleId === eps['2x3'].titleId)).toBe(true);
	expect(isWatched(db, eps['0x1'].id)).toBe(false);
	expect(isWatched(db, eps['2x4'].id)).toBe(false);
	expect(isWatched(db, eps['3x1'].id)).toBe(false);
	expect(isWatched(db, eps['1x1'].id)).toBe(true);
	markUpTo(db, eps['2x3'].id, new Date(), TODAY);
	expect(count(db)).toBe(5);
});

test('markUpTo skips an unaired target', () => {
	const { db, eps } = seed();
	markUpTo(db, eps['3x1'].id, new Date(), TODAY);
	expect(isWatched(db, eps['3x1'].id)).toBe(false);
	expect(count(db)).toBe(6);
});

test('markSeason marks only aired unwatched episodes', () => {
	const { db, t, eps } = seed();
	markEpisode(db, eps['2x1'].id);
	markSeason(db, t.id, 2, new Date(), TODAY);
	expect(count(db)).toBe(4);
	markSeason(db, t.id, 3, new Date(), TODAY);
	expect(count(db)).toBe(4);
	markSeason(db, t.id, 0, new Date(), TODAY);
	expect(isWatched(db, eps['0x1'].id)).toBe(true);
});

test('markEpisode adds a row each call; unmarkEpisode removes one', () => {
	const { db, eps } = seed();
	const id = eps['1x1'].id;
	markEpisode(db, id);
	markEpisode(db, id);
	expect(count(db)).toBe(2);
	unmarkEpisode(db, id);
	expect(count(db)).toBe(1);
	expect(isWatched(db, id)).toBe(true);
	unmarkEpisode(db, id);
	expect(isWatched(db, id)).toBe(false);
	unmarkEpisode(db, id);
	expect(count(db)).toBe(0);
});

test('unmarkEpisode prefers app watch over a later imported one, else latest imported', () => {
	const { db, eps } = seed();
	const id = eps['1x1'].id;
	const tid = eps['1x1'].titleId;
	db.insert(watch).values({ titleId: tid, episodeId: id, watchedAt: '2025-01-01T00:00:00.000Z', source: 'app' }).run();
	db.insert(watch).values({ titleId: tid, episodeId: id, watchedAt: '2025-06-01T00:00:00.000Z', source: 'tvtime1', importKey: 'a' }).run();
	unmarkEpisode(db, id);
	const left = db.select().from(watch).where(eq(watch.episodeId, id)).all();
	expect(left).toHaveLength(1);
	expect(left[0].source).toBe('tvtime1');
	db.insert(watch).values({ titleId: tid, episodeId: id, watchedAt: '2025-07-01T00:00:00.000Z', source: 'tvtime2', importKey: 'b' }).run();
	unmarkEpisode(db, id);
	const rest = db.select().from(watch).where(and(eq(watch.episodeId, id))).all();
	expect(rest.map((w) => w.importKey)).toEqual(['a']);
});

test('movies: markMovie twice adds 2 rows; unmarkMovieLatest removes latest', () => {
	const db = openDb(':memory:');
	const m = db.insert(title).values({ kind: 'movie', tmdbId: 9, name: 'M', addedAt: '2026-01-01T00:00:00.000Z' }).returning().get();
	markMovie(db, m.id, new Date('2025-01-01T00:00:00Z'));
	markMovie(db, m.id, new Date('2025-02-01T00:00:00Z'));
	expect(count(db)).toBe(2);
	unmarkMovieLatest(db, m.id);
	const left = db.select().from(watch).all();
	expect(left).toHaveLength(1);
	expect(left[0].watchedAt).toBe('2025-01-01T00:00:00.000Z');
	expect(left[0].episodeId).toBeNull();
	unmarkMovieLatest(db, m.id);
	unmarkMovieLatest(db, m.id);
	expect(count(db)).toBe(0);
});
