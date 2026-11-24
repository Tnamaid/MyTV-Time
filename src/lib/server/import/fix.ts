import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episode, importIssue, title, watch } from '../db/schema';
import { addMovie, addSeries, addToWatchlist, setArchived } from '../titles/service';
import { episodeIssueLabel, resolveEpisodes } from './link';
import type { MovieCandidate } from './movieMatch';
import type { ImportTmdb } from './resolve';

export type ImportIssue = {
	id: number;
	kind: 'show' | 'episode' | 'movie';
	key: string;
	label: string;
	candidates: MovieCandidate[] | null;
	meta: Record<string, unknown> | null;
	resolved: boolean;
	createdAt: string;
};

type ShowMeta = { tvdbId: number; name: string; followed: boolean; archived: boolean; forLater: boolean };
type MovieMeta = { uuid: string; name: string; releaseYear: number | null; forLater: boolean };
export type EpisodeMap = { targetSeason: number; offset: number };

const parse = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));

export function listOpenIssues(db: Db): ImportIssue[] {
	return db
		.select()
		.from(importIssue)
		.where(eq(importIssue.resolved, false))
		.orderBy(asc(importIssue.kind), asc(importIssue.label))
		.all()
		.map((r) => ({
			id: r.id,
			kind: r.kind,
			key: r.key,
			label: r.label,
			candidates: parse<MovieCandidate[]>(r.candidatesJson),
			meta: parse<Record<string, unknown>>(r.metaJson),
			resolved: r.resolved,
			createdAt: r.createdAt
		}));
}

function getIssue(db: Db, key: string, kind?: ImportIssue['kind']) {
	const row = db.select().from(importIssue).where(eq(importIssue.key, key)).get();
	if (!row || (kind && row.kind !== kind)) throw new Error(`Unknown ${kind ?? 'import'} issue: ${key}`);
	return row;
}

const resolveIssue = (db: Db, key: string) =>
	db.update(importIssue).set({ resolved: true }).where(eq(importIssue.key, key)).run();

export async function fixShow(db: Db, tmdb: ImportTmdb, issueKey: string, tmdbId: number): Promise<void> {
	const issue = getIssue(db, issueKey, 'show');
	const meta = parse<ShowMeta>(issue.metaJson);
	if (!meta) throw new Error(`Issue ${issueKey} has no meta`);

	// Async TMDB work first (addSeries syncs; episode resolution may fetch tvdb ids).
	const titleId = await addSeries(db, tmdb, tmdbId, { follow: meta.followed, tvdbId: meta.tvdbId });
	const pending = () =>
		db.select().from(watch).where(and(eq(watch.rawTvdbSeriesId, meta.tvdbId), isNull(watch.titleId))).all();
	const ws = pending();
	const linkable = ws.map((w) => ({
		w, tvdbEpisodeId: w.rawTvdbEpisodeId ?? -1, season: w.rawSeason ?? -1, episode: w.rawEpisode ?? -1
	}));
	const resolved = await resolveEpisodes(db, tmdb, titleId, linkable);

	db.transaction(() => {
		if (meta.archived) setArchived(db, titleId, true);
		if (meta.forLater) addToWatchlist(db, titleId);

		const unmatched = new Map<number, number>();
		for (const l of linkable) {
			const episodeId = resolved.ids.get(l) ?? null;
			db.update(watch).set({ titleId, episodeId }).where(eq(watch.id, l.w.id)).run();
			if (episodeId === null && l.w.rawSeason !== null) unmatched.set(l.w.rawSeason, (unmatched.get(l.w.rawSeason) ?? 0) + 1);
		}
		for (const [season, count] of unmatched) {
			db.insert(importIssue)
				.values({
					kind: 'episode',
					key: `episode:${meta.tvdbId}:${season}`,
					label: episodeIssueLabel(meta.name, meta.tvdbId, season, count, resolved.error),
					metaJson: JSON.stringify({ tvdbId: meta.tvdbId, rawSeason: season }),
					createdAt: new Date().toISOString()
				})
				.onConflictDoNothing({ target: importIssue.key })
				.run();
		}
		resolveIssue(db, issueKey);
	});
}

/** Raw-episode -> target-episode lookup for a title's unlinked watches in one raw season. */
function unlinkedRaw(db: Db, titleId: number, rawSeason: number) {
	return db
		.select()
		.from(watch)
		.where(and(eq(watch.titleId, titleId), eq(watch.rawSeason, rawSeason), isNull(watch.episodeId)))
		.all();
}

export function fixEpisodes(
	db: Db,
	titleId: number,
	rawSeason: number,
	map: EpisodeMap
): { linked: number; unlinked: number } {
	return db.transaction(() => {
		const byNumber = new Map(
			db
				.select({ id: episode.id, n: episode.episodeNumber })
				.from(episode)
				.where(and(eq(episode.titleId, titleId), eq(episode.seasonNumber, map.targetSeason)))
				.all()
				.map((e) => [e.n, e.id])
		);
		const ws = unlinkedRaw(db, titleId, rawSeason);
		let linked = 0;
		for (const w of ws) {
			if (w.rawEpisode === null) continue;
			const id = byNumber.get(w.rawEpisode + map.offset);
			if (id === undefined) continue;
			db.update(watch).set({ episodeId: id }).where(eq(watch.id, w.id)).run();
			linked++;
		}
		const unlinked = ws.length - linked;
		if (unlinked === 0) {
			const t = db.select({ tvdbId: title.tvdbId }).from(title).where(eq(title.id, titleId)).get();
			const tvdbId = t?.tvdbId ?? ws.find((w) => w.rawTvdbSeriesId !== null)?.rawTvdbSeriesId ?? null;
			if (tvdbId !== null) resolveIssue(db, `episode:${tvdbId}:${rawSeason}`);
		}
		return { linked, unlinked };
	});
}

export type EpisodePreview = {
	rawSeason: number;
	rawEpisode: number;
	targetSeason: number;
	targetEpisode: number;
	targetName: string | null;
};

/** Read-only: the first `limit` distinct raw episodes (by number) and where `map` would send them. */
export function previewEpisodeMapping(
	db: Db,
	titleId: number,
	rawSeason: number,
	map: EpisodeMap,
	limit = 3
): EpisodePreview[] {
	const raws = [...new Set(unlinkedRaw(db, titleId, rawSeason).flatMap((w) => (w.rawEpisode === null ? [] : [w.rawEpisode])))]
		.sort((a, b) => a - b)
		.slice(0, limit);
	if (!raws.length) return [];
	const targets = db
		.select({ n: episode.episodeNumber, name: episode.name })
		.from(episode)
		.where(
			and(
				eq(episode.titleId, titleId),
				eq(episode.seasonNumber, map.targetSeason),
				inArray(episode.episodeNumber, raws.map((r) => r + map.offset))
			)
		)
		.all();
	const names = new Map(targets.map((t) => [t.n, t.name]));
	return raws.map((rawEpisode) => ({
		rawSeason,
		rawEpisode,
		targetSeason: map.targetSeason,
		targetEpisode: rawEpisode + map.offset,
		targetName: names.get(rawEpisode + map.offset) ?? null
	}));
}

export async function fixMovie(db: Db, tmdb: ImportTmdb, issueKey: string, tmdbId: number): Promise<void> {
	const issue = getIssue(db, issueKey, 'movie');
	const meta = parse<MovieMeta>(issue.metaJson);
	if (!meta) throw new Error(`Issue ${issueKey} has no meta`);
	const titleId = await addMovie(db, tmdb, tmdbId);
	db.transaction(() => {
		db.update(watch)
			.set({ titleId })
			.where(
				and(
					isNull(watch.titleId),
					isNull(watch.episodeId),
					eq(watch.rawMovieName, meta.name),
					meta.releaseYear === null ? isNull(watch.rawMovieYear) : eq(watch.rawMovieYear, meta.releaseYear)
				)
			)
			.run();
		if (meta.forLater) addToWatchlist(db, titleId);
		resolveIssue(db, issueKey);
	});
}

export function dismissIssue(db: Db, issueKey: string): void {
	getIssue(db, issueKey);
	resolveIssue(db, issueKey);
}
