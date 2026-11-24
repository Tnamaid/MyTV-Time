import { error, fail } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '#lib/server/db/client.ts';
import { episode, season, title, watch, watchlist } from '#lib/server/db/schema.ts';
import { boolField, handleBadInput, intField, optBoolField, starsField } from '#lib/server/forms.ts';
import { today } from '#lib/server/time.ts';
import { TMDB_IMAGE_BASE } from '#lib/server/tmdb/client.ts';
import {
	addToWatchlist,
	removeFromWatchlist,
	setAnimeOverride,
	setArchived,
	setFollowed,
	setStars
} from '#lib/server/titles/service.ts';
import { syncSeries } from '#lib/server/titles/sync.ts';
import {
	markEpisode,
	markMovie,
	markSeason,
	markUpTo,
	unmarkEpisode,
	unmarkMovieLatest
} from '#lib/server/watches/service.ts';
import type { Actions, PageServerLoad } from './$types';

type Title = typeof title.$inferSelect;

/** The title named by the route param, or a 404. */
function getTitle(db: Db, idParam: string): Title {
	const id = /^\d{1,9}$/.test(idParam) ? Number(idParam) : NaN;
	const t = Number.isNaN(id) ? undefined : db.select().from(title).where(eq(title.id, id)).get();
	if (!t) error(404, 'Title not found');
	return t;
}

/** An episode id from the form that must belong to this title. */
function ownEpisode(db: Db, t: Title, form: FormData) {
	const episodeId = intField(form, 'episodeId');
	const e = db
		.select({ id: episode.id })
		.from(episode)
		.where(and(eq(episode.id, episodeId), eq(episode.titleId, t.id)))
		.get();
	return e ? e.id : null;
}

export const load: PageServerLoad = ({ locals, params }) => {
	const { db } = locals;
	const t = getTitle(db, params.id);
	const todayStr = today();
	const inWatchlist = !!db.select({ id: watchlist.id }).from(watchlist).where(eq(watchlist.titleId, t.id)).get();

	const base = {
		today: todayStr,
		tmdbConfigured: locals.tmdb !== null,
		inWatchlist,
		title: {
			id: t.id,
			kind: t.kind,
			name: t.name,
			originalName: t.originalName,
			year: t.year,
			overview: t.overview,
			status: t.status,
			posterUrl: t.posterPath ? TMDB_IMAGE_BASE + t.posterPath : null,
			stars: t.stars,
			followed: t.followed,
			archived: t.archived,
			isAnimeDetected: t.isAnime,
			isAnimeOverride: t.isAnimeOverride,
			lastSyncedAt: t.lastSyncedAt
		}
	};

	if (t.kind === 'movie') {
		const w = db
			.select({ count: sql<number>`count(*)`, last: sql<string | null>`max(${watch.watchedAt})` })
			.from(watch)
			.where(eq(watch.titleId, t.id))
			.get();
		return { ...base, movie: { watchCount: w?.count ?? 0, lastWatchedAt: w?.last ?? null }, seasons: [] };
	}

	// Raw SQL: drizzle drops table qualifiers in single-table selects, which would make
	// `episode_id = id` compare against watch.id inside the subquery.
	const counts = sql<number>`(SELECT COUNT(*) FROM watch w WHERE w.episode_id = episode.id)`;
	const eps = db
		.select({
			id: episode.id,
			seasonNumber: episode.seasonNumber,
			episodeNumber: episode.episodeNumber,
			name: episode.name,
			airDate: episode.airDate,
			watchCount: counts
		})
		.from(episode)
		.where(eq(episode.titleId, t.id))
		.orderBy(asc(episode.seasonNumber), asc(episode.episodeNumber))
		.all();
	const seasonRows = db.select().from(season).where(eq(season.titleId, t.id)).all();

	// Seasons that have episodes or a season row; regular seasons first, Specials (0) last.
	const numbers = [...new Set([...seasonRows.map((s) => s.number), ...eps.map((e) => e.seasonNumber)])].sort(
		(a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b)
	);
	const seasons = numbers.map((n) => {
		const episodes = eps.filter((e) => e.seasonNumber === n);
		const aired = episodes.filter((e) => e.airDate !== null && e.airDate <= todayStr);
		const row = seasonRows.find((s) => s.number === n);
		return {
			number: n,
			label: n === 0 ? 'Specials' : row?.name || `Season ${n}`,
			episodes,
			total: episodes.length,
			watched: episodes.filter((e) => e.watchCount > 0).length,
			airedUnwatched: aired.filter((e) => e.watchCount === 0).length
		};
	});

	// Open the season holding the next episode (first regular episode after the furthest watched).
	const regular = eps.filter((e) => e.seasonNumber > 0);
	const lastWatched = regular.findLastIndex((e) => e.watchCount > 0);
	const next = regular[lastWatched + 1];
	const openSeason = next?.seasonNumber ?? (seasons.length === 1 ? seasons[0].number : null);

	return { ...base, movie: null, seasons, openSeason };
};

export const actions: Actions = {
	stars: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			setStars(locals.db, t.id, starsField(await request.formData()));
		}),

	follow: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			setFollowed(locals.db, t.id, boolField(await request.formData(), 'value'));
		}),

	archive: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			setArchived(locals.db, t.id, boolField(await request.formData(), 'value'));
		}),

	watchlist: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			if (boolField(await request.formData(), 'value')) addToWatchlist(locals.db, t.id);
			else removeFromWatchlist(locals.db, t.id);
		}),

	anime: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			setAnimeOverride(locals.db, t.id, optBoolField(await request.formData(), 'value'));
		}),

	markEpisode: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			const id = ownEpisode(locals.db, t, await request.formData());
			if (id === null) return fail(404, { message: 'Episode not found' });
			markEpisode(locals.db, id);
		}),

	unmarkEpisode: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			const id = ownEpisode(locals.db, t, await request.formData());
			if (id === null) return fail(404, { message: 'Episode not found' });
			unmarkEpisode(locals.db, id);
		}),

	markUpTo: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			const id = ownEpisode(locals.db, t, await request.formData());
			if (id === null) return fail(404, { message: 'Episode not found' });
			markUpTo(locals.db, id);
		}),

	markSeason: ({ request, locals, params }) =>
		handleBadInput(async () => {
			const t = getTitle(locals.db, params.id);
			const n = intField(await request.formData(), 'season');
			const exists = locals.db
				.select({ id: episode.id })
				.from(episode)
				.where(and(eq(episode.titleId, t.id), eq(episode.seasonNumber, n)))
				.get();
			if (!exists) return fail(404, { message: 'Season not found' });
			markSeason(locals.db, t.id, n);
		}),

	markMovie: ({ locals, params }) => {
		const t = getTitle(locals.db, params.id);
		if (t.kind !== 'movie') return fail(400, { message: 'Not a movie' });
		markMovie(locals.db, t.id);
	},

	unmarkMovie: ({ locals, params }) => {
		const t = getTitle(locals.db, params.id);
		if (t.kind !== 'movie') return fail(400, { message: 'Not a movie' });
		unmarkMovieLatest(locals.db, t.id);
	},

	refresh: async ({ locals, params }) => {
		const t = getTitle(locals.db, params.id);
		if (t.kind !== 'series') return fail(400, { message: 'Only series can be refreshed' });
		if (!locals.tmdb) return fail(503, { message: 'TMDB not configured' });
		try {
			await syncSeries(locals.db, locals.tmdb, t.id);
		} catch (e) {
			console.error(`refresh of title ${t.id} failed`, e);
			return fail(502, { message: `Refresh failed: ${e instanceof Error ? e.message : String(e)}` });
		}
	}
};
