import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { episode, importIssue, title } from '#lib/server/db/schema.ts';
import { handleBadInput, intField, signedIntField, textField } from '#lib/server/forms.ts';
import {
	dismissIssue,
	episodeIssueTarget,
	fixEpisodes,
	fixMovie,
	fixShow,
	listOpenIssues,
	previewEpisodeMapping,
	type ImportIssue
} from '#lib/server/import/fix.ts';
import { TMDB_IMAGE_BASE } from '#lib/server/tmdb/client.ts';
import type { Actions, PageServerLoad } from './$types';

type Choice = { tmdbId: number; name: string; year: number | null; posterUrl: string | null };

const yearOf = (d: string | null | undefined) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const poster = (p: string | null) => (p ? TMDB_IMAGE_BASE + p : null);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const metaName = (i: ImportIssue) => (typeof i.meta?.name === 'string' ? i.meta.name : i.label);

export const load: PageServerLoad = async ({ locals, url }) => {
	const { db, tmdb } = locals;
	const issues = listOpenIssues(db);

	// Free TMDB search for one show/movie issue: ?issue=<key>&q=<query> (a GET form per issue).
	const searchKey = url.searchParams.get('issue');
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const searched = issues.find((i) => i.key === searchKey && i.kind !== 'episode');
	let search: { key: string; q: string; results: Choice[]; error: string | null } | null = null;
	if (searched && q && tmdb) {
		try {
			const results =
				searched.kind === 'show'
					? (await tmdb.searchTv(q)).map((s) => ({ tmdbId: s.id, name: s.name, year: yearOf(s.first_air_date), posterUrl: poster(s.poster_path) }))
					: (await tmdb.searchMovie(q)).map((m) => ({ tmdbId: m.id, name: m.title, year: yearOf(m.release_date), posterUrl: poster(m.poster_path) }));
			search = { key: searched.key, q, results: results.slice(0, 8), error: null };
		} catch (e) {
			console.error('fix-imports search failed', e);
			search = { key: searched.key, q, results: [], error: `TMDB search failed: ${errText(e)}` };
		}
	}
	const searchFor = (i: ImportIssue) => (search?.key === i.key ? search : null);

	return {
		tmdbConfigured: tmdb !== null,
		total: issues.length,
		shows: issues
			.filter((i) => i.kind === 'show')
			.map((i) => ({ key: i.key, label: i.label, query: metaName(i), search: searchFor(i) })),
		movies: issues
			.filter((i) => i.kind === 'movie')
			.map((i) => ({
				key: i.key,
				label: i.label,
				query: metaName(i),
				candidates: (i.candidates ?? []).map((c) => ({
					tmdbId: c.id,
					name: c.title,
					year: yearOf(c.release_date),
					posterUrl: poster(c.poster_path)
				})),
				search: searchFor(i)
			})),
		episodes: issues
			.filter((i) => i.kind === 'episode')
			.map((i) => {
				const target = episodeIssueTarget(db, i.key);
				const rawSeason = typeof i.meta?.rawSeason === 'number' ? i.meta.rawSeason : null; // null: no s_no
				if (!target) return { key: i.key, label: i.label, rawSeason, target: null };
				const t = db.select({ name: title.name }).from(title).where(eq(title.id, target.titleId)).get();
				const seasons = db
					.selectDistinct({ n: episode.seasonNumber })
					.from(episode)
					.where(eq(episode.titleId, target.titleId))
					.orderBy(asc(episode.seasonNumber))
					.all()
					.map((r) => r.n);
				// Watches with no season number start on the first regular season.
				const map = { targetSeason: target.rawSeason ?? seasons.find((n) => n > 0) ?? 1, offset: 0 };
				return {
					key: i.key,
					label: i.label,
					rawSeason,
					target: {
						titleId: target.titleId,
						name: t?.name ?? '',
						seasons,
						initialSeason: map.targetSeason,
						preview: previewEpisodeMapping(db, target.titleId, target.rawSeason, map)
					}
				};
			})
	};
};

/** The open issue named by the form's `key`, if it has the expected kind. */
function openIssue(locals: App.Locals, key: string, kind: ImportIssue['kind']) {
	return locals.db
		.select({ key: importIssue.key, label: importIssue.label })
		.from(importIssue)
		.where(and(eq(importIssue.key, key), eq(importIssue.kind, kind), eq(importIssue.resolved, false)))
		.get();
}

/** fixShow / fixMovie: both pick a TMDB id for an open issue and need TMDB. */
const pick = (kind: 'show' | 'movie') =>
	(async ({ request, locals }) =>
		handleBadInput(async () => {
			const form = await request.formData();
			const key = textField(form, 'key');
			const tmdbId = intField(form, 'tmdbId');
			const issue = openIssue(locals, key, kind);
			if (!issue) return fail(404, { message: 'Issue not found (already fixed?)' });
			if (!locals.tmdb) return fail(503, { message: 'TMDB not configured' });
			try {
				await (kind === 'show' ? fixShow : fixMovie)(locals.db, locals.tmdb, key, tmdbId);
			} catch (e) {
				console.error(`fix ${key} → ${tmdbId} failed`, e);
				return fail(502, { message: `Fix failed: ${errText(e)}` });
			}
			return { ok: `Fixed: ${issue.label}` };
		})) satisfies Actions[string];

export const actions: Actions = {
	fixShow: pick('show'),
	fixMovie: pick('movie'),

	fixEpisodes: ({ request, locals }) =>
		handleBadInput(async () => {
			const form = await request.formData();
			const key = textField(form, 'key');
			const map = { targetSeason: intField(form, 'season'), offset: signedIntField(form, 'offset') };
			const target = episodeIssueTarget(locals.db, key);
			if (!target) return fail(404, { message: 'Issue not found, or its show is not in the library yet' });
			const { linked, unlinked } = fixEpisodes(locals.db, target.titleId, target.rawSeason, map);
			const w = (n: number) => `${n} watch${n === 1 ? '' : 'es'}`;
			return { ok: `Linked ${w(linked)}${unlinked ? `; ${w(unlinked)} still unmatched` : ''}.` };
		}),

	dismiss: ({ request, locals }) =>
		handleBadInput(async () => {
			const key = textField(await request.formData(), 'key');
			const exists = locals.db
				.select({ id: importIssue.id })
				.from(importIssue)
				.where(and(eq(importIssue.key, key), eq(importIssue.resolved, false)))
				.get();
			if (!exists) return fail(404, { message: 'Issue not found (already fixed?)' });
			dismissIssue(locals.db, key);
			return { ok: 'Dismissed.' };
		})
};
