import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { episode } from '#lib/server/db/schema.ts';
import { handleBadInput, intField } from '#lib/server/forms.ts';
import { getUpNext } from '#lib/server/queries/upNext.ts';
import { today } from '#lib/server/time.ts';
import { TMDB_IMAGE_BASE } from '#lib/server/tmdb/client.ts';
import { markEpisode } from '#lib/server/watches/service.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	items: getUpNext(locals.db, today()).map((i) => ({
		...i,
		posterUrl: i.posterPath ? TMDB_IMAGE_BASE + i.posterPath : null
	}))
});

export const actions: Actions = {
	watch: ({ request, locals }) =>
		handleBadInput(async () => {
			const episodeId = intField(await request.formData(), 'episodeId');
			const exists = locals.db.select({ id: episode.id }).from(episode).where(eq(episode.id, episodeId)).get();
			if (!exists) return fail(404, { message: 'Episode not found' });
			markEpisode(locals.db, episodeId);
		})
};
