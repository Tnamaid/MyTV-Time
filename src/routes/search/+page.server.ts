import { fail, redirect } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '#lib/server/db/client.ts';
import { title } from '#lib/server/db/schema.ts';
import { enumField, handleBadInput, intField } from '#lib/server/forms.ts';
import { TMDB_IMAGE_BASE, type TmdbApi } from '#lib/server/tmdb/client.ts';
import { addMovie, addSeries, addToWatchlist } from '#lib/server/titles/service.ts';
import { markMovie } from '#lib/server/watches/service.ts';
import type { Actions, PageServerLoad } from './$types';

type Kind = 'movie' | 'series';
const MAX_PER_KIND = 10;

const yearOf = (d: string | null | undefined) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the library already knows about these TMDB ids of one kind. */
function libraryState(db: Db, kind: Kind, ids: number[]) {
	if (!ids.length) return new Map<number, { titleId: number; followed: boolean; inWatchlist: boolean; watchCount: number }>();
	const rows = db
		.select({
			tmdbId: title.tmdbId,
			titleId: title.id,
			followed: title.followed,
			// Literal "title"."id": drizzle renders ${title.id} unqualified in single-table selects,
			// which inside the subquery would resolve to the inner table's id.
			inWatchlist: sql<number>`EXISTS (SELECT 1 FROM watchlist wl WHERE wl.title_id = "title"."id")`,
			watchCount: sql<number>`(SELECT COUNT(*) FROM watch w WHERE w.title_id = "title"."id")`
		})
		.from(title)
		.where(and(eq(title.kind, kind), inArray(title.tmdbId, ids)))
		.all();
	return new Map(rows.map((r) => [r.tmdbId, { ...r, inWatchlist: !!r.inWatchlist }]));
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const empty = { q, configured: locals.tmdb !== null, error: null as string | null, movies: [], series: [] };
	if (!locals.tmdb || !q) return empty;

	let movieHits, tvHits;
	try {
		[movieHits, tvHits] = await Promise.all([locals.tmdb.searchMovie(q), locals.tmdb.searchTv(q)]);
	} catch (e) {
		console.error('TMDB search failed', e);
		return { ...empty, error: `TMDB search failed: ${errText(e)}` };
	}
	movieHits = movieHits.slice(0, MAX_PER_KIND);
	tvHits = tvHits.slice(0, MAX_PER_KIND);
	const inMovies = libraryState(locals.db, 'movie', movieHits.map((m) => m.id));
	const inSeries = libraryState(locals.db, 'series', tvHits.map((s) => s.id));
	const poster = (p: string | null) => (p ? TMDB_IMAGE_BASE + p : null);

	return {
		...empty,
		movies: movieHits.map((m) => ({
			tmdbId: m.id,
			kind: 'movie' as const,
			name: m.title,
			originalName: m.original_title,
			year: yearOf(m.release_date),
			posterUrl: poster(m.poster_path),
			library: inMovies.get(m.id) ?? null
		})),
		series: tvHits.map((s) => ({
			tmdbId: s.id,
			kind: 'series' as const,
			name: s.name,
			originalName: s.original_name,
			year: yearOf(s.first_air_date),
			posterUrl: poster(s.poster_path),
			library: inSeries.get(s.id) ?? null
		}))
	};
};

/** Parse tmdbId + kind, then add (or find) the title. TMDB failures → 502. */
async function withTitle<R>(
	request: Request,
	locals: App.Locals,
	run: (tmdb: TmdbApi, kind: Kind, tmdbId: number) => Promise<R>
) {
	return handleBadInput(async () => {
		const form = await request.formData();
		const tmdbId = intField(form, 'tmdbId');
		const kind = enumField(form, 'kind', ['movie', 'series'] as const);
		if (!locals.tmdb) return fail(503, { message: 'TMDB not configured' });
		try {
			return await run(locals.tmdb, kind, tmdbId);
		} catch (e) {
			console.error(`search action on ${kind} ${tmdbId} failed`, e);
			return fail(502, { message: `TMDB request failed: ${errText(e)}` });
		}
	});
}

export const actions: Actions = {
	/** Movie: add + log a watch. Series: add, then open its page to tick episodes. */
	watched: async ({ request, locals }) => {
		let seriesId: number | null = null;
		const result = await withTitle(request, locals, async (tmdb, kind, tmdbId) => {
			if (kind === 'series') {
				seriesId = await addSeries(locals.db, tmdb, tmdbId);
				return;
			}
			const id = await addMovie(locals.db, tmdb, tmdbId);
			markMovie(locals.db, id);
			return { ok: 'Marked watched' };
		});
		// Outside the try/catch above: redirect() works by throwing.
		if (seriesId !== null) redirect(303, `/title/${seriesId}`);
		return result;
	},

	watchlist: ({ request, locals }) =>
		withTitle(request, locals, async (tmdb, kind, tmdbId) => {
			const id = kind === 'movie' ? await addMovie(locals.db, tmdb, tmdbId) : await addSeries(locals.db, tmdb, tmdbId);
			addToWatchlist(locals.db, id);
			return { ok: 'Added to watchlist' };
		}),

	follow: ({ request, locals }) =>
		withTitle(request, locals, async (tmdb, kind, tmdbId) => {
			if (kind !== 'series') return fail(400, { message: 'Only series can be followed' });
			await addSeries(locals.db, tmdb, tmdbId, { follow: true });
			return { ok: 'Following' };
		})
};
