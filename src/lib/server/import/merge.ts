import type { EpisodeWatchRow, ParsedExport } from './parse';

type Source = 'tvtime1' | 'tvtime2';
export type ImportShow = {
	tvdbId: number;
	name: string;
	followed: boolean;
	archived: boolean;
	forLater: boolean;
	/** TV Time's nb_episodes_seen (max across both exports), null/absent when unknown. Sanity check only. */
	nbEpisodesSeen?: number | null;
};
export type ImportEpisodeWatch = EpisodeWatchRow & { source: Source; importKey: string };
export type ImportMovieWatch = { at: string; source: Source; importKey: string };
export type ImportMovie = {
	uuid: string;
	name: string;
	releaseYear: number | null;
	watches: ImportMovieWatch[];
	forLater: boolean;
};
export type ImportBundle = {
	shows: Map<number, ImportShow>;
	episodeWatches: ImportEpisodeWatch[];
	movies: Map<string, ImportMovie>;
	/** Per export: watch rows dropped by the parser for lack of an ep_id (reported, never imported). */
	skippedRowsNoEpisodeId?: Record<Source, number>;
};

const minute = (iso: string) => iso.slice(0, 16);
const byTimeThenKey = (a: { at: string; importKey: string }, b: { at: string; importKey: string }) =>
	a.at < b.at ? -1 : a.at > b.at ? 1 : a.importKey < b.importKey ? -1 : a.importKey > b.importKey ? 1 : 0;

/**
 * Union of two TV Time exports. Pure and deterministic: precedence and
 * first-seen order depend on each export's `source`, not argument position
 * (tvtime1 is processed first, tvtime2 values win).
 */
export function mergeExports(a: ParsedExport, b: ParsedExport): ImportBundle {
	const ordered = [a, b].sort((x, y) => (x.source < y.source ? -1 : x.source > y.source ? 1 : 0));

	const shows = new Map<number, ImportShow>();
	for (const exp of ordered) {
		for (const s of exp.shows) {
			// tvtime2 flags win; but keep a known name and the larger nb_episodes_seen.
			const prev = shows.get(s.tvdbId);
			const seen = [prev?.nbEpisodesSeen, s.nbEpisodesSeen].filter((n): n is number => typeof n === 'number');
			shows.set(s.tvdbId, {
				tvdbId: s.tvdbId,
				name: s.name || prev?.name || '',
				followed: s.followed,
				archived: s.archived,
				forLater: s.forLater,
				nbEpisodesSeen: seen.length ? Math.max(...seen) : null
			});
		}
	}

	const seen = new Set<string>();
	const tagged: (ImportEpisodeWatch & { at: string })[] = [];
	for (const exp of ordered) {
		for (const e of exp.episodes) {
			const importKey = `ep:${e.tvdbEpisodeId}:${minute(e.watchedAt)}`;
			if (seen.has(importKey)) continue;
			seen.add(importKey);
			tagged.push({ ...e, source: exp.source, importKey, at: e.watchedAt });
			const known = shows.get(e.tvdbSeriesId);
			if (!known) {
				shows.set(e.tvdbSeriesId, {
					tvdbId: e.tvdbSeriesId, name: e.seriesName, followed: false, archived: false, forLater: false, nbEpisodesSeen: null
				});
			} else if (!known.name && e.seriesName) {
				known.name = e.seriesName; // show files had no tv_show_name
			}
		}
	}
	tagged.sort(byTimeThenKey);
	const episodeWatches: ImportEpisodeWatch[] = tagged.map(({ at: _at, ...rest }) => rest);

	const movies = new Map<string, ImportMovie>();
	const toWatch = new Set<string>();
	const movieKeys = new Set<string>();
	for (const exp of ordered) {
		for (const m of exp.movies) {
			let cur = movies.get(m.uuid);
			if (!cur) {
				cur = { uuid: m.uuid, name: m.name, releaseYear: m.releaseYear, watches: [], forLater: false };
				movies.set(m.uuid, cur);
			} else {
				if (m.name) cur.name = m.name;
				if (m.releaseYear !== null) cur.releaseYear = m.releaseYear;
			}
			if (m.type === 'towatch') {
				toWatch.add(m.uuid);
				continue;
			}
			const importKey = `mv:${m.uuid}:${minute(m.createdAt)}`;
			if (movieKeys.has(importKey)) continue;
			movieKeys.add(importKey);
			cur.watches.push({ at: m.createdAt, source: exp.source, importKey });
		}
	}
	for (const m of movies.values()) {
		m.watches.sort(byTimeThenKey);
		m.forLater = toWatch.has(m.uuid) && m.watches.length === 0;
	}

	const skippedRowsNoEpisodeId = { tvtime1: 0, tvtime2: 0 };
	for (const exp of ordered) skippedRowsNoEpisodeId[exp.source] += exp.skippedRowsNoEpisodeId;

	return { shows, episodeWatches, movies, skippedRowsNoEpisodeId };
}
