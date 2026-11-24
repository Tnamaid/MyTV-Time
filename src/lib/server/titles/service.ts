import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { title, watchlist } from '../db/schema';
import { syncSeries, yearOf, type TmdbLike } from './sync';


export async function addSeries(
	db: Db,
	tmdb: TmdbLike,
	tmdbId: number,
	opts: { follow?: boolean; tvdbId?: number } = {}
): Promise<number> {
	const existing = db
		.select()
		.from(title)
		.where(and(eq(title.kind, 'series'), eq(title.tmdbId, tmdbId)))
		.get();
	if (existing) {
		const set: Partial<typeof title.$inferInsert> = {};
		if (opts.follow) set.followed = true;
		if (opts.tvdbId !== undefined && existing.tvdbId == null) set.tvdbId = opts.tvdbId;
		if (Object.keys(set).length) db.update(title).set(set).where(eq(title.id, existing.id)).run();
		return existing.id;
	}
	const row = db
		.insert(title)
		.values({
			kind: 'series',
			tmdbId,
			name: `TMDB ${tmdbId}`,
			tvdbId: opts.tvdbId ?? null,
			followed: opts.follow ?? false,
			addedAt: new Date().toISOString()
		})
		.returning({ id: title.id })
		.get();
	try {
		await syncSeries(db, tmdb, row.id);
	} catch (e) {
		// Do not leave a placeholder row behind if the first sync fails.
		db.delete(title).where(eq(title.id, row.id)).run();
		throw e;
	}
	return row.id;
}

export async function addMovie(db: Db, tmdb: TmdbLike, tmdbId: number): Promise<number> {
	const existing = db
		.select({ id: title.id })
		.from(title)
		.where(and(eq(title.kind, 'movie'), eq(title.tmdbId, tmdbId)))
		.get();
	if (existing) return existing.id;
	const m = await tmdb.getMovie(tmdbId);
	return db
		.insert(title)
		.values({
			kind: 'movie',
			tmdbId,
			name: m.title,
			originalName: m.original_title,
			year: yearOf(m.release_date),
			posterPath: m.poster_path,
			overview: m.overview,
			isAnime: false,
			addedAt: new Date().toISOString(),
			lastSyncedAt: new Date().toISOString()
		})
		.returning({ id: title.id })
		.get().id;
}

export function setStars(db: Db, titleId: number, stars: 1 | 2 | 3 | 4 | 5 | null): void {
	if (stars !== null && !(Number.isInteger(stars) && stars >= 1 && stars <= 5))
		throw new Error(`invalid stars: ${stars}`);
	db.update(title).set({ stars }).where(eq(title.id, titleId)).run();
}

export function setFollowed(db: Db, titleId: number, followed: boolean): void {
	db.update(title).set({ followed }).where(eq(title.id, titleId)).run();
}

export function setArchived(db: Db, titleId: number, archived: boolean): void {
	db.update(title).set({ archived }).where(eq(title.id, titleId)).run();
}

export function setAnimeOverride(db: Db, titleId: number, value: boolean | null): void {
	db.update(title).set({ isAnimeOverride: value }).where(eq(title.id, titleId)).run();
}

export function addToWatchlist(db: Db, titleId: number): void {
	db.insert(watchlist)
		.values({ titleId, addedAt: new Date().toISOString() })
		.onConflictDoNothing()
		.run();
}

export function removeFromWatchlist(db: Db, titleId: number): void {
	db.delete(watchlist).where(eq(watchlist.titleId, titleId)).run();
}
