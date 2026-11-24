import { getUpcoming } from '#lib/server/queries/upcoming.ts';
import { today } from '#lib/server/time.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const t = today();
	return { today: t, items: getUpcoming(locals.db, t, 30) };
};
