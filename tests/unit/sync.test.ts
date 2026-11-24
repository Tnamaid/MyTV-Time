import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { episode, season, title, watch } from '../../src/lib/server/db/schema';
import { syncAllDue, syncSeries } from '../../src/lib/server/titles/sync';
import { addSeries } from '../../src/lib/server/titles/service';
import { TmdbError } from '../../src/lib/server/tmdb/client';
import { ep, fakeTmdb, show } from './fakeTmdb';

const eps = (db: ReturnType<typeof openDb>, tid: number) =>
	db.select().from(episode).where(eq(episode.titleId, tid)).all();

function setup() {
	const db = openDb(':memory:');
	const full = fakeTmdb({
		shows: { 1: show() },
		seasons: { '1:1': { episodes: [ep(1, 1), ep(1, 2), ep(1, 3)] } }
	});
	return { db, full };
}

test('episode dropped by TMDB with a watch is kept; without is removed', async () => {
	const { db, full } = setup();
	const id = await addSeries(db, full, 1);
	const e3 = eps(db, id).find((e) => e.episodeNumber === 3)!;
	const e2 = eps(db, id).find((e) => e.episodeNumber === 2)!;
	db.insert(watch).values({ titleId: id, episodeId: e3.id, watchedAt: 'x', source: 'app' }).run();
	const reduced = fakeTmdb({ shows: { 1: show() }, seasons: { '1:1': { episodes: [ep(1, 1, { name: 'New' })] } } });
	await syncSeries(db, reduced, id);
	const left = eps(db, id);
	expect(left.map((e) => e.episodeNumber).sort()).toEqual([1, 3]);
	expect(left.find((e) => e.episodeNumber === 1)!.name).toBe('New');
	expect(left.find((e) => e.id === e2.id)).toBeUndefined();
});

test('season removed when TMDB drops it and no episodes remain', async () => {
	const { db, full } = setup();
	const id = await addSeries(db, full, 1);
	const none = fakeTmdb({ shows: { 1: show({ seasons: [] }) }, seasons: {} });
	await syncSeries(db, none, id);
	expect(db.select().from(season).all()).toHaveLength(0);
	expect(eps(db, id)).toHaveLength(0);
});

test('getSeason failure leaves everything untouched', async () => {
	const { db, full } = setup();
	const id = await addSeries(db, full, 1);
	const before = eps(db, id);
	const bad = fakeTmdb({
		shows: { 1: show({ name: 'Changed' }) },
		seasons: { '1:1': new TmdbError(500) }
	});
	await expect(syncSeries(db, bad, id)).rejects.toBeInstanceOf(TmdbError);
	expect(eps(db, id)).toEqual(before);
	expect(db.select().from(title).get()!.name).toBe('Show');
});

const NOW = new Date('2026-11-24T12:00:00Z');

test('syncAllDue records failure and continues; skips ended/unfollowed/archived/fresh', async () => {
	const db = openDb(':memory:');
	const base = { kind: 'series' as const, addedAt: 'x', followed: true };
	const ins = (tmdbId: number, over: Partial<typeof title.$inferInsert> = {}) =>
		db.insert(title).values({ ...base, tmdbId, name: 'n' + tmdbId, ...over }).returning().get().id;
	const bad = ins(1);
	const good = ins(2, { status: 'Returning Series', lastSyncedAt: '2026-11-23T00:00:00Z' });
	ins(3, { status: 'Ended' });
	ins(4, { status: 'Canceled' });
	ins(5, { followed: false });
	ins(6, { archived: true });
	ins(7, { lastSyncedAt: '2026-11-24T00:00:00Z' }); // 12h ago: fresh
	const tmdb = fakeTmdb({
		shows: { 1: show({ id: 1 }), 2: show({ id: 2, name: 'Two' }) },
		seasons: { '1:1': new TmdbError(500), '2:1': { episodes: [ep(1, 1)] } }
	});
	const res = await syncAllDue(db, tmdb, NOW);
	expect(res.ok).toBe(1);
	expect(res.failed).toEqual([{ titleId: bad, error: expect.any(String) }]);
	expect(db.select().from(title).where(eq(title.id, good)).get()!.name).toBe('Two');
});

test('syncAllDue catches non-Tmdb errors too', async () => {
	const db = openDb(':memory:');
	const id = db.insert(title).values({ kind: 'series', addedAt: 'x', followed: true, tmdbId: 1, name: 'a' }).returning().get().id;
	const tmdb = fakeTmdb({}); // getShow throws plain Error
	const res = await syncAllDue(db, tmdb, NOW);
	expect(res).toEqual({ ok: 0, failed: [{ titleId: id, error: 'no show 1' }] });
});
