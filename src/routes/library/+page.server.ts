import { searchLibrary, type LibraryFilter } from '#lib/server/queries/library.ts';
import { TMDB_IMAGE_BASE } from '#lib/server/tmdb/client.ts';
import type { PageServerLoad } from './$types';

const KINDS = ['movie', 'series', 'anime'] as const;
const SORTS = ['name', 'lastWatched', 'stars'] as const;

/** `value` if it is one of `allowed`, else undefined (GET pages ignore bad params). */
function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
	return (allowed as readonly (string | null)[]).includes(value) ? (value as T) : undefined;
}

const bool = (v: string | null) => (v === '1' ? true : v === '0' ? false : undefined);

export const load: PageServerLoad = ({ locals, url }) => {
	const p = url.searchParams;
	const stars = p.get('stars');
	const filter: LibraryFilter = {
		q: p.get('q')?.trim().slice(0, 200) || undefined,
		kind: pick(p.get('kind'), KINDS),
		stars: stars && /^[1-5]$/.test(stars) ? Number(stars) : undefined,
		followed: bool(p.get('followed')),
		archived: bool(p.get('archived')),
		sort: pick(p.get('sort'), SORTS)
	};
	const items = searchLibrary(locals.db, filter).map((i) => ({
		...i,
		posterUrl: i.posterPath ? TMDB_IMAGE_BASE + i.posterPath : null
	}));
	return {
		// Normalised back to strings so the form shows exactly what was applied.
		filter: {
			q: filter.q ?? '',
			kind: filter.kind ?? '',
			stars: filter.stars ? String(filter.stars) : '',
			followed: filter.followed === undefined ? '' : filter.followed ? '1' : '0',
			archived: filter.archived === undefined ? '' : filter.archived ? '1' : '0',
			sort: filter.sort ?? 'name'
		},
		items
	};
};
