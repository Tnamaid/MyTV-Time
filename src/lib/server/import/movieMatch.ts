import type { MovieSearchResult } from '../tmdb/client';
import { yearOf } from '../titles/sync';

export type MovieCandidate = Pick<MovieSearchResult, 'id' | 'title' | 'release_date' | 'poster_path'>;

const MAX_CANDIDATES = 5;

/** lowercase, NFKD + strip diacritics, drop punctuation/symbols, collapse whitespace, trim. */
export function normaliseTitle(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[\p{P}\p{S}]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Auto-match only when exactly one result has the same normalised title and
 * (if the TV Time year is known) the same release year. Otherwise returns
 * up to 5 candidates, exact-title results first, then TMDB relevance order.
 */
export function pickMovie(
	name: string,
	releaseYear: number | null,
	results: MovieSearchResult[]
): { match: MovieSearchResult | null; candidates: MovieCandidate[] } {
	const want = normaliseTitle(name);
	const sameTitle = (r: MovieSearchResult) => normaliseTitle(r.title) === want;
	const hits = results.filter(
		(r) => sameTitle(r) && (releaseYear === null || yearOf(r.release_date) === releaseYear)
	);
	if (hits.length === 1) return { match: hits[0], candidates: [] };
	const ordered = [...results.filter(sameTitle), ...results.filter((r) => !sameTitle(r))];
	return {
		match: null,
		candidates: ordered
			.slice(0, MAX_CANDIDATES)
			.map(({ id, title, release_date, poster_path }) => ({ id, title, release_date, poster_path }))
	};
}
