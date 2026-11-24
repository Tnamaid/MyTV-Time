import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parseExport, type EpisodeWatchRow, type MovieRow, type ParsedExport, type ShowStatusRow } from '../../src/lib/server/import/parse';
import { mergeExports } from '../../src/lib/server/import/merge';

const ep = (id: number, at: string, over: Partial<EpisodeWatchRow> = {}): EpisodeWatchRow => ({
	tvdbSeriesId: 1, tvdbEpisodeId: id, season: 1, episode: 1, seriesName: 'Naruto', watchedAt: at, isRewatch: false, ...over
});
const mv = (uuid: string, type: MovieRow['type'], at: string, over: Partial<MovieRow> = {}): MovieRow => ({
	uuid, name: 'Movie', releaseYear: 2000, createdAt: at, type, ...over
});
const show = (id: number, over: Partial<ShowStatusRow> = {}): ShowStatusRow => ({
	tvdbId: id, name: 'Naruto', followed: false, archived: false, forLater: false, createdAt: '2020-01-01T00:00:00Z', ...over
});
const exp = (source: 'tvtime1' | 'tvtime2', p: Partial<ParsedExport> = {}): ParsedExport => ({
	source, episodes: [], movies: [], shows: [], ...p
});

describe('mergeExports', () => {
	it('dedupes same episode at same minute', () => {
		const a = exp('tvtime1', { episodes: [ep(10, '2020-01-01T10:00:05Z')] });
		const b = exp('tvtime2', { episodes: [ep(10, '2020-01-01T10:00:50Z')] });
		const r = mergeExports(a, b);
		expect(r.episodeWatches).toHaveLength(1);
		expect(r.episodeWatches[0].importKey).toBe('ep:10:2020-01-01T10:00');
		expect(r.episodeWatches[0].source).toBe('tvtime1');
	});
	it('keeps rewatches at a different time', () => {
		const a = exp('tvtime1', { episodes: [ep(10, '2020-01-01T10:00:00Z')] });
		const b = exp('tvtime2', { episodes: [ep(10, '2021-05-01T10:00:00Z', { isRewatch: true })] });
		expect(mergeExports(a, b).episodeWatches).toHaveLength(2);
	});
	it('tvtime2 show status wins regardless of argument order', () => {
		const a = exp('tvtime1', { shows: [show(1, { followed: true, archived: false })] });
		const b = exp('tvtime2', { shows: [show(1, { followed: false, archived: true, forLater: true })] });
		for (const r of [mergeExports(a, b), mergeExports(b, a)]) {
			expect(r.shows.get(1)).toEqual({ tvdbId: 1, name: 'Naruto', followed: false, archived: true, forLater: true });
		}
	});
	it('adds show seen only in watches with followed=false', () => {
		const r = mergeExports(exp('tvtime1', { episodes: [ep(10, '2020-01-01T10:00:00Z', { tvdbSeriesId: 77, seriesName: 'Lost' })] }), exp('tvtime2'));
		expect(r.shows.get(77)).toEqual({ tvdbId: 77, name: 'Lost', followed: false, archived: false, forLater: false });
	});
	it('movie in both with different dates -> 2 watches; tvtime2 name wins', () => {
		const a = exp('tvtime1', { movies: [mv('m', 'watch', '2020-01-01T10:00:00Z', { name: 'Old', releaseYear: null })] });
		const b = exp('tvtime2', { movies: [mv('m', 'rewatch', '2021-01-01T10:00:00Z', { name: 'New', releaseYear: 1999 })] });
		for (const r of [mergeExports(a, b), mergeExports(b, a)]) {
			const m = r.movies.get('m')!;
			expect(m.watches.map((w) => w.importKey)).toEqual(['mv:m:2020-01-01T10:00', 'mv:m:2021-01-01T10:00']);
			expect(m.name).toBe('New');
			expect(m.releaseYear).toBe(1999);
			expect(m.forLater).toBe(false);
		}
	});
	it('towatch-only movie is forLater with no watches; towatch+watch is not', () => {
		const a = exp('tvtime1', { movies: [mv('x', 'towatch', '2020-01-01T10:00:00Z'), mv('y', 'towatch', '2020-01-01T10:00:00Z')] });
		const b = exp('tvtime2', { movies: [mv('y', 'watch', '2021-01-01T10:00:00Z')] });
		const r = mergeExports(a, b);
		expect(r.movies.get('x')).toMatchObject({ forLater: true, watches: [] });
		expect(r.movies.get('y')).toMatchObject({ forLater: false });
		expect(r.movies.get('y')!.watches).toHaveLength(1);
	});
	it('is deterministic and re-merge yields identical keys (fixtures)', () => {
		const dir = (n: string) => join(__dirname, '../fixtures/tvtime', n);
		const run = () => mergeExports(parseExport(dir('export1'), 'tvtime1'), parseExport(dir('export2'), 'tvtime2'));
		const r1 = run();
		const r2 = run();
		const keys = (r: ReturnType<typeof run>) => [
			...r.episodeWatches.map((w) => w.importKey),
			...[...r.movies.values()].flatMap((m) => m.watches.map((w) => w.importKey))
		];
		expect(keys(r1)).toEqual(keys(r2));
		expect(new Set(keys(r1)).size).toBe(keys(r1).length);
		const sorted = [...r1.episodeWatches].sort((p, q) => p.watchedAt.localeCompare(q.watchedAt) || p.importKey.localeCompare(q.importKey));
		expect(r1.episodeWatches).toEqual(sorted);
	});
});
