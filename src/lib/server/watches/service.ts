import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episode, watch } from '../db/schema';
import { today } from '../time';

type Ep = typeof episode.$inferSelect;

function addWatches(db: Db, eps: Pick<Ep, 'id' | 'titleId'>[], at: Date) {
	const watchedAt = at.toISOString();
	for (const e of eps) {
		db.insert(watch)
			.values({ titleId: e.titleId, episodeId: e.id, watchedAt, source: 'app', importKey: null })
			.run();
	}
}

function watchedIds(db: Db, ids: number[]): Set<number> {
	if (ids.length === 0) return new Set();
	const rows = db.select({ id: watch.episodeId }).from(watch).where(inArray(watch.episodeId, ids)).all();
	return new Set(rows.map((r) => r.id as number));
}

export function isWatched(db: Db, episodeId: number): boolean {
	return !!db.select({ id: watch.id }).from(watch).where(eq(watch.episodeId, episodeId)).limit(1).get();
}

export function markEpisode(db: Db, episodeId: number, at: Date = new Date()): void {
	const e = db.select().from(episode).where(eq(episode.id, episodeId)).get();
	if (!e) return;
	addWatches(db, [e], at);
}

export function unmarkEpisode(db: Db, episodeId: number): void {
	const latest = (source?: 'app') =>
		db
			.select({ id: watch.id })
			.from(watch)
			.where(source ? and(eq(watch.episodeId, episodeId), eq(watch.source, source)) : eq(watch.episodeId, episodeId))
			.orderBy(desc(watch.watchedAt), desc(watch.id))
			.limit(1)
			.get();
	db.transaction((tx) => {
		const row = latest("app") ?? latest();
		if (row) tx.delete(watch).where(eq(watch.id, row.id)).run();
	});
}

function airedIn(titleId: number, todayStr: string) {
	return and(eq(episode.titleId, titleId), isNotNull(episode.airDate), lte(episode.airDate, todayStr));
}

export function markSeason(
	db: Db, titleId: number, season: number, at: Date = new Date(), todayStr: string = today()
): void {
	db.transaction((tx) => {
		const eps = tx
			.select()
			.from(episode)
			.where(and(airedIn(titleId, todayStr), eq(episode.seasonNumber, season)))
			.orderBy(asc(episode.episodeNumber))
			.all();
		const done = watchedIds(tx as unknown as Db, eps.map((e) => e.id));
		addWatches(tx as unknown as Db, eps.filter((e) => !done.has(e.id)), at);
	});
}

export function markUpTo(
	db: Db, episodeId: number, at: Date = new Date(), todayStr: string = today()
): void {
	const target = db.select().from(episode).where(eq(episode.id, episodeId)).get();
	if (!target) return;
	db.transaction((tx) => {
		const eps = tx
			.select()
			.from(episode)
			.where(
				and(
					airedIn(target.titleId, todayStr),
					sql`${episode.seasonNumber} > 0`,
					sql`(${episode.seasonNumber}, ${episode.episodeNumber}) <= (${target.seasonNumber}, ${target.episodeNumber})`
				)
			)
			.orderBy(asc(episode.seasonNumber), asc(episode.episodeNumber))
			.all();
		const done = watchedIds(tx as unknown as Db, eps.map((e) => e.id));
		addWatches(tx as unknown as Db, eps.filter((e) => !done.has(e.id)), at);
	});
}

export function markMovie(db: Db, titleId: number, at: Date = new Date()): void {
	db.insert(watch)
		.values({ titleId, episodeId: null, watchedAt: at.toISOString(), source: 'app', importKey: null })
		.run();
}

export function unmarkMovieLatest(db: Db, titleId: number): void {
	db.transaction((tx) => {
		const row = tx
			.select({ id: watch.id })
			.from(watch)
			.where(eq(watch.titleId, titleId))
			.orderBy(desc(watch.watchedAt), desc(watch.id))
			.limit(1)
			.get();
		if (row) tx.delete(watch).where(eq(watch.id, row.id)).run();
	});
}
