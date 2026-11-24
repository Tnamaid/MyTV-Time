import { error, json } from '@sveltejs/kit';
import { episodeIssueTarget, previewEpisodeMapping } from '#lib/server/import/fix.ts';
import type { RequestHandler } from './$types';

/**
 * Live preview for an episode issue: GET ?key=<issue key>&season=<n>&offset=<±n>
 * → the first 3 raw episodes and where that mapping would send them. Read-only.
 */
export const GET: RequestHandler = ({ locals, url }) => {
	const p = url.searchParams;
	const key = p.get('key') ?? '';
	const season = p.get('season') ?? '';
	const offset = p.get('offset') ?? '';
	if (!key || key.length > 200 || !/^\d{1,4}$/.test(season) || !/^-?\d{1,6}$/.test(offset))
		error(400, 'key, season (≥ 0) and offset (integer) are required');
	const target = episodeIssueTarget(locals.db, key);
	if (!target) error(404, 'Issue not found, or its show is not in the library yet');
	return json(
		previewEpisodeMapping(locals.db, target.titleId, target.rawSeason, {
			targetSeason: Number(season),
			offset: Number(offset)
		})
	);
};
