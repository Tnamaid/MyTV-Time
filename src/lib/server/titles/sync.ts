import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episode, season, title, watch } from '../db/schema';
import { isAnime } from '../tmdb/anime';
import type { SeasonDetails, TmdbClient } from '../tmdb/client';

export type TmdbLike = Pick<TmdbClient, 'getShow' | 'getSeason' | 'getMovie'>;

const STALE_MS = 20 * 60 * 60 * 1000;

export const yearOf = (date: string | null | undefined): number | null => {
	const y = date ? parseInt(date.slice(0, 4), 10) : NaN;
	return Number.isFinite(y) ? y : null;
};

export async function syncSeries(db: Db, tmdb: TmdbLike, titleId: number): Promise<void> {
	const t = db.select().from(title).where(eq(title.id, titleId)).get();
	if (!t) throw new Error(`title ${titleId} not found`);

	// Fetch everything first; any failure throws before touching the db.
	const details = await tmdb.getShow(t.tmdbId);
	const fetched: { number: number; details: SeasonDetails }[] = [];
	for (const s of details.seasons) {
		fetched.push({ number: s.season_number, details: await tmdb.getSeason(t.tmdbId, s.season_number) });
	}

	db.transaction((tx) => {
		tx.update(title)
			.set({
				name: details.name,
				originalName: details.original_name,
				year: yearOf(details.first_air_date),
				posterPath: details.poster_path,
				overview: details.overview,
				status: details.status,
				isAnime: isAnime(details),
				tvdbId: details.external_ids?.tvdb_id ?? t.tvdbId,
				lastSyncedAt: new Date().toISOString()
			})
			.where(eq(title.id, titleId))
			.run();

		for (const s of details.seasons) {
			tx.insert(season)
				.values({ titleId, number: s.season_number, name: s.name, airDate: s.air_date || null })
				.onConflictDoUpdate({
					target: [season.titleId, season.number],
					set: { name: s.name, airDate: s.air_date || null }
				})
				.run();
		}

		const listed = new Set<string>();
		for (const { details: sd } of fetched) {
			for (const e of sd.episodes) {
				listed.add(`${e.season_number}:${e.episode_number}`);
				const vals = {
					tmdbId: e.id,
					name: e.name,
					airDate: e.air_date || null,
					runtime: e.runtime ?? null
				};
				tx.insert(episode)
					.values({ titleId, seasonNumber: e.season_number, episodeNumber: e.episode_number, ...vals })
					.onConflictDoUpdate({
						target: [episode.titleId, episode.seasonNumber, episode.episodeNumber],
						set: vals
					})
					.run();
			}
		}

		const existing = tx.select().from(episode).where(eq(episode.titleId, titleId)).all();
		const stale = existing.filter((e) => !listed.has(`${e.seasonNumber}:${e.episodeNumber}`));
		if (stale.length) {
			const watched = new Set(
				tx
					.select({ id: watch.episodeId })
					.from(watch)
					.where(inArray(watch.episodeId, stale.map((e) => e.id)))
					.all()
					.map((r) => r.id)
			);
			const del = stale.filter((e) => !watched.has(e.id)).map((e) => e.id);
			if (del.length) tx.delete(episode).where(inArray(episode.id, del)).run();
		}

		const listedSeasons = details.seasons.map((s) => s.season_number);
		const gone = tx
			.select()
			.from(season)
			.where(
				and(
					eq(season.titleId, titleId),
					listedSeasons.length ? notInArray(season.number, listedSeasons) : undefined
				)
			)
			.all();
		for (const s of gone) {
			const left = tx
				.select({ id: episode.id })
				.from(episode)
				.where(and(eq(episode.titleId, titleId), eq(episode.seasonNumber, s.number)))
				.get();
			if (!left) tx.delete(season).where(eq(season.id, s.id)).run();
		}
	});
}

export async function syncAllDue(
	db: Db,
	tmdb: TmdbLike,
	now: Date = new Date()
): Promise<{ ok: number; failed: { titleId: number; error: string }[] }> {
	const cutoff = new Date(now.getTime() - STALE_MS).toISOString();
	const due = db
		.select({ id: title.id })
		.from(title)
		.where(
			and(
				eq(title.kind, 'series'),
				eq(title.followed, true),
				eq(title.archived, false),
				or(isNull(title.status), sql`${title.status} NOT IN ('Ended', 'Canceled')`),
				or(isNull(title.lastSyncedAt), lt(title.lastSyncedAt, cutoff))
			)
		)
		.all();

	let ok = 0;
	const failed: { titleId: number; error: string }[] = [];
	for (const { id } of due) {
		try {
			await syncSeries(db, tmdb, id);
			ok++;
		} catch (e) {
			failed.push({ titleId: id, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return { ok, failed };
}
