import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseExport } from '../../src/lib/server/import/parse';

const e1 = parseExport('tests/fixtures/tvtime/export1', 'tvtime1');
const e2 = parseExport('tests/fixtures/tvtime/export2', 'tvtime2');

test('export1 episodes: counts, padded headers, rewatch flag, ISO dates', () => {
	expect(e1.source).toBe('tvtime1');
	expect(e1.episodes).toHaveLength(5);
	expect(e1.episodes[0]).toEqual({
		tvdbSeriesId: 78857,
		tvdbEpisodeId: 136001,
		season: 1,
		episode: 1,
		seriesName: 'Naruto',
		watchedAt: '2020-03-01T20:15:30Z',
		isRewatch: false
	});
	const rewatches = e1.episodes.filter((e) => e.isRewatch);
	expect(rewatches).toHaveLength(1);
	expect(rewatches[0].tvdbEpisodeId).toBe(136001);
	expect(rewatches[0].watchedAt).toBe('2021-06-05T18:45:10Z');
});

test('export2 episodes: different column order', () => {
	expect(e2.source).toBe('tvtime2');
	expect(e2.episodes).toHaveLength(3);
	expect(e2.episodes[0]).toEqual({
		tvdbSeriesId: 78857,
		tvdbEpisodeId: 136003,
		season: 1,
		episode: 3,
		seriesName: 'Naruto',
		watchedAt: '2023-01-10T19:00:00Z',
		isRewatch: false
	});
	expect(e2.episodes.some((e) => e.isRewatch)).toBe(false);
});

test('ignores non watch/rewatch keys and rows without ep_id', () => {
	expect(e1.episodes.map((e) => e.tvdbEpisodeId)).not.toContain(999999);
	expect(e1.episodes.every((e) => Number.isInteger(e.tvdbEpisodeId))).toBe(true);
});

test('Naruto appears in both exports', () => {
	expect(e1.episodes.some((e) => e.tvdbSeriesId === 78857)).toBe(true);
	expect(e2.episodes.some((e) => e.tvdbSeriesId === 78857)).toBe(true);
	expect(e1.shows.some((s) => s.tvdbId === 78857)).toBe(true);
	expect(e2.shows.some((s) => s.tvdbId === 78857)).toBe(true);
});

test('movies: only movie rows, follow ignored, 0001 year null', () => {
	expect(e1.movies).toHaveLength(4);
	expect(e1.movies.map((m) => m.type)).toEqual(['watch', 'towatch', 'rewatch', 'watch']);
	expect(e1.movies[0]).toEqual({
		uuid: 'a1b2c3d4-0001',
		name: 'Inception',
		releaseYear: 2010,
		createdAt: '2021-01-02T20:00:00Z',
		type: 'watch'
	});
	expect(e1.movies[3].releaseYear).toBeNull();
	expect(e2.movies).toHaveLength(2);
	expect(e2.movies[0].releaseYear).toBe(1999);
	expect(e2.movies[1]).toMatchObject({ type: 'towatch', releaseYear: null });
});

test('shows export1: merged statuses', () => {
	expect(e1.shows).toHaveLength(5);
	const by = Object.fromEntries(e1.shows.map((s) => [s.tvdbId, s]));
	expect(by[78857]).toEqual({
		tvdbId: 78857,
		name: 'Naruto',
		followed: true,
		archived: false,
		forLater: false,
		createdAt: '2020-02-28T09:00:00Z'
	});
	expect(by[81189]).toMatchObject({ followed: false, archived: true, forLater: false });
	expect(by[334824]).toMatchObject({ followed: true, archived: false, createdAt: '2020-05-01T08:00:00Z' });
	expect(by[73739]).toMatchObject({ name: 'Lost', followed: false, forLater: true, createdAt: '2018-01-01T00:00:00Z' });
	expect(by[371980]).toMatchObject({ name: 'Severance', forLater: true });
});

test('shows export2: missing special-status file is fine', () => {
	expect(e2.shows).toHaveLength(3);
	const by = Object.fromEntries(e2.shows.map((s) => [s.tvdbId, s]));
	expect(by[78857]).toMatchObject({ followed: true, createdAt: '2023-01-04T09:00:00Z' });
	expect(by[269613]).toMatchObject({ name: 'Fargo', followed: false, forLater: false });
	expect(e2.shows.every((s) => !s.forLater)).toBe(true);
});

test('completely empty dir yields empty export', () => {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	expect(parseExport(dir, 'tvtime2')).toEqual({ source: 'tvtime2', episodes: [], movies: [], shows: [] });
});

test('missing required column throws naming file and column', () => {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	writeFileSync(join(dir, 'followed_tv_show.csv'), 'user_id,tv_show_id,tv_show_name,archived,created_at\n1,1,X,0,2020-01-01 00:00:00\n');
	expect(() => parseExport(dir, 'tvtime1')).toThrow(/followed_tv_show\.csv.*active/);
});

test('ISO-looking created_at is normalised', () => {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	writeFileSync(
		join(dir, 'tracking-prod-records.csv'),
		'uuid,type,entity_type,movie_name,release_date,created_at\nu1,watch,movie,M,2001-02-03,2020-01-02T03:04:05.123Z\n'
	);
	const r = parseExport(dir, 'tvtime1');
	expect(r.movies[0]).toMatchObject({ createdAt: '2020-01-02T03:04:05Z', releaseYear: 2001 });
});
