import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { episode, season, title, watchlist } from '../../src/lib/server/db/schema';
import {
	addMovie, addSeries, addToWatchlist, removeFromWatchlist,
	setAnimeOverride, setArchived, setFollowed, setStars
} from '../../src/lib/server/titles/service';
import { ep, fakeTmdb, show } from './fakeTmdb';

const anime = show({ id: 7, genres: [{ id: 16, name: 'Animation' }], origin_country: ['JP'] });
const tmdb = fakeTmdb({
	shows: { 1: show(), 7: anime },
	seasons: {
		'1:0': { episodes: [ep(0, 1)] },
		'1:1': { episodes: [ep(1, 1), ep(1, 2)] },
		'7:1': { episodes: [ep(1, 1)] }
	},
	movies: {
		9: { id: 9, title: 'Mov', original_title: 'Mov O', release_date: '1999-03-01', poster_path: null, overview: 'm', genres: [{ id: 16, name: 'Animation' }] }
	}
});
tmdb.getShow = ((orig) => async (id: number) => {
	const s = await orig(id);
	return id === 1 ? { ...s, seasons: [{ season_number: 0, name: 'Specials', air_date: null }, ...s.seasons] } : s;
})(tmdb.getShow);

test('addSeries is idempotent and syncs seasons/episodes', async () => {
	const db = openDb(':memory:');
	const a = await addSeries(db, tmdb, 1, { follow: true });
	const b = await addSeries(db, tmdb, 1);
	expect(a).toBe(b);
	expect(db.select().from(title).all()).toHaveLength(1);
	const t = db.select().from(title).get()!;
	expect(t.followed).toBe(true);
	expect(t.tvdbId).toBe(555);
	expect(t.year).toBe(2020);
	expect(t.isAnime).toBe(false);
	expect(t.lastSyncedAt).toBeTruthy();
	expect(db.select().from(season).all()).toHaveLength(2);
	expect(db.select().from(episode).all()).toHaveLength(3);
});

test('addSeries applies opts on existing; anime flagged', async () => {
	const db = openDb(':memory:');
	const id = await addSeries(db, tmdb, 7);
	expect(db.select().from(title).get()!.isAnime).toBe(true);
	await addSeries(db, tmdb, 7, { follow: true });
	expect(db.select().from(title).where(eq(title.id, id)).get()!.followed).toBe(true);
});

test('addMovie idempotent, not anime', async () => {
	const db = openDb(':memory:');
	const a = await addMovie(db, tmdb, 9);
	expect(await addMovie(db, tmdb, 9)).toBe(a);
	const t = db.select().from(title).get()!;
	expect(t.kind).toBe('movie');
	expect(t.name).toBe('Mov');
	expect(t.year).toBe(1999);
	expect(t.isAnime).toBe(false);
});

test('setters', async () => {
	const db = openDb(':memory:');
	const id = await addSeries(db, tmdb, 1);
	const get = () => db.select().from(title).where(eq(title.id, id)).get()!;
	setStars(db, id, 4);
	expect(get().stars).toBe(4);
	expect(() => setStars(db, id, 6 as any)).toThrow();
	expect(() => setStars(db, id, 2.5 as any)).toThrow();
	expect(get().stars).toBe(4);
	setStars(db, id, null);
	expect(get().stars).toBeNull();
	setFollowed(db, id, true);
	setArchived(db, id, true);
	setAnimeOverride(db, id, true);
	expect([get().followed, get().archived, get().isAnimeOverride]).toEqual([true, true, true]);
	setAnimeOverride(db, id, null);
	expect(get().isAnimeOverride).toBeNull();
});

test('watchlist add idempotent and remove', async () => {
	const db = openDb(':memory:');
	const id = await addSeries(db, tmdb, 1);
	addToWatchlist(db, id);
	addToWatchlist(db, id);
	expect(db.select().from(watchlist).all()).toHaveLength(1);
	removeFromWatchlist(db, id);
	expect(db.select().from(watchlist).all()).toHaveLength(0);
});
