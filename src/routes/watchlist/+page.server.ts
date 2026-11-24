import { fail } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '#lib/server/db/client.ts';
import { title, watchlist } from '#lib/server/db/schema.ts';
import { handleBadInput, intField } from '#lib/server/forms.ts';
import { TMDB_IMAGE_BASE } from '#lib/server/tmdb/client.ts';
import { removeFromWatchlist } from '#lib/server/titles/service.ts';
import { markMovie } from '#lib/server/watches/service.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	items: locals.db
		.select({
			titleId: title.id,
			kind: title.kind,
			name: title.name,
			year: title.year,
			posterPath: title.posterPath,
			isAnime: sql<number>`coalesce(${title.isAnimeOverride}, ${title.isAnime})`,
			addedAt: watchlist.addedAt
		})
		.from(watchlist)
		.innerJoin(title, eq(title.id, watchlist.titleId))
		.orderBy(desc(watchlist.addedAt), desc(watchlist.id))
		.all()
		.map((i) => ({
			...i,
			isAnime: i.kind === 'series' && !!i.isAnime,
			posterUrl: i.posterPath ? TMDB_IMAGE_BASE + i.posterPath : null
		}))
});

/** A title id from the form that is on the watchlist. */
function listed(db: Db, form: FormData) {
	const titleId = intField(form, 'titleId');
	return db
		.select({ id: title.id, kind: title.kind })
		.from(watchlist)
		.innerJoin(title, eq(title.id, watchlist.titleId))
		.where(eq(watchlist.titleId, titleId))
		.get();
}

export const actions: Actions = {
	remove: ({ request, locals }) =>
		handleBadInput(async () => {
			const t = listed(locals.db, await request.formData());
			if (!t) return fail(404, { message: 'Not on the watchlist' });
			removeFromWatchlist(locals.db, t.id);
		}),

	/** Movies only: log a watch and take it off the list (it has been watched). */
	watched: ({ request, locals }) =>
		handleBadInput(async () => {
			const t = listed(locals.db, await request.formData());
			if (!t) return fail(404, { message: 'Not on the watchlist' });
			if (t.kind !== 'movie') return fail(400, { message: 'Only movies can be marked watched here' });
			locals.db.transaction(() => {
				markMovie(locals.db, t.id);
				removeFromWatchlist(locals.db, t.id);
			});
		})
};
