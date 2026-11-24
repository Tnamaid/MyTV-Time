import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseExport, toIso } from '../../src/lib/server/import/parse';

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
		createdAt: '2020-02-28T09:00:00Z',
		nbEpisodesSeen: 3
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

const V2_HEADER = 'key,s_id,ep_id,s_no,ep_no,series_name,created_at\n';

/** A temp export folder; the episode file (required) is created with just its header unless given. */
function tmpExport(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	writeFileSync(join(dir, 'tracking-prod-records-v2.csv'), V2_HEADER);
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
	return dir;
}

test('export folder with only the episode file yields an empty export', () => {
	const dir = tmpExport({});
	expect(parseExport(dir, 'tvtime2')).toEqual({ source: 'tvtime2', episodes: [], movies: [], shows: [], skippedRowsNoEpisodeId: 0 });
});

test('missing tracking-prod-records-v2.csv throws a clear error (wrong --dir)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	expect(() => parseExport(dir, 'tvtime1')).toThrow(
		`${join(dir, 'tracking-prod-records-v2.csv')} not found — is --dir pointing at the export folder?`
	);
});

test('missing required column throws naming file and column', () => {
	const dir = tmpExport({ 'followed_tv_show.csv': 'user_id,tv_show_id,tv_show_name,archived,created_at\n1,1,X,0,2020-01-01 00:00:00\n' });
	expect(() => parseExport(dir, 'tvtime1')).toThrow(/followed_tv_show\.csv.*active/);
});

test('ISO-looking created_at is normalised', () => {
	const dir = tmpExport({
		'tracking-prod-records.csv': 'uuid,type,entity_type,movie_name,release_date,created_at\nu1,watch,movie,M,2001-02-03,2020-01-02T03:04:05.123Z\n'
	});
	const r = parseExport(dir, 'tvtime1');
	expect(r.movies[0]).toMatchObject({ createdAt: '2020-01-02T03:04:05Z', releaseYear: 2001 });
});

test('show files: only tv_show_id + flag columns are required; name/created_at optional', () => {
	const dir = tmpExport({
		'followed_tv_show.csv': 'tv_show_id,active,archived\n10,1,0\n11,0,1\n',
		'user_tv_show_data.csv': 'tv_show_id,is_followed,is_favorited,nb_episodes_seen\n12,1,0,7\n',
		'user_show_special_status.csv': 'tv_show_id,status\n13,for_later\n'
	});
	const by = Object.fromEntries(parseExport(dir, 'tvtime1').shows.map((s) => [s.tvdbId, s]));
	expect(by[10]).toEqual({ tvdbId: 10, name: '', followed: true, archived: false, forLater: false, createdAt: null, nbEpisodesSeen: null });
	expect(by[11]).toMatchObject({ followed: false, archived: true });
	expect(by[12]).toMatchObject({ followed: true, nbEpisodesSeen: 7, createdAt: null });
	expect(by[13]).toMatchObject({ forLater: true, name: '' });
});

test('show files: blank created_at does not throw; earliest non-blank date kept', () => {
	const dir = tmpExport({
		'followed_tv_show.csv': 'tv_show_id,tv_show_name,active,archived,created_at\n10,X,1,0,\n',
		'user_tv_show_data.csv': 'tv_show_id,tv_show_name,is_followed,created_at,nb_episodes_seen\n10,,1,2021-05-05 10:00:00,\n'
	});
	const [s] = parseExport(dir, 'tvtime1').shows;
	expect(s).toMatchObject({ tvdbId: 10, name: 'X', createdAt: '2021-05-05T10:00:00Z', nbEpisodesSeen: null });
});

test('nb_episodes_seen is read from user_tv_show_data.csv (fixtures)', () => {
	const by = Object.fromEntries(e1.shows.map((s) => [s.tvdbId, s]));
	expect(by[78857].nbEpisodesSeen).toBe(3);
	expect(by[73739].nbEpisodesSeen).toBe(0);
	expect(by[81189].nbEpisodesSeen).toBeNull(); // only in followed_tv_show.csv
});

test('watch/rewatch rows without ep_id are counted, not silently dropped', () => {
	expect(e1.skippedRowsNoEpisodeId).toBe(1); // watch-999999; the follow- row is not a watch
	expect(e2.skippedRowsNoEpisodeId).toBe(0);
});

test('short row (missing a required field) -> error naming file and line', () => {
	const dir = tmpExport({
		'tracking-prod-records-v2.csv': V2_HEADER + 'watch-1,1,1,1,1,A,2020-01-01 00:00:00\nwatch-2,1,2,1\n'
	});
	expect(() => parseExport(dir, 'tvtime1')).toThrow(/tracking-prod-records-v2\.csv line 3: .*"ep_no"/);
});

test('short row is fine when only optional trailing columns are missing', () => {
	const dir = tmpExport({
		'tracking-prod-records-v2.csv': 'key,s_id,ep_id,s_no,ep_no,series_name,created_at,updated_at\nwatch-1,1,1,1,1,A,2020-01-01 00:00:00\n'
	});
	expect(parseExport(dir, 'tvtime1').episodes).toHaveLength(1);
});

test('row with more fields than the header -> error naming file and line (no column shift)', () => {
	const dir = tmpExport({
		'tracking-prod-records-v2.csv': V2_HEADER + 'watch-1,1,1,1,1,Love, Death,2020-01-01 00:00:00\n'
	});
	expect(() => parseExport(dir, 'tvtime1')).toThrow(/tracking-prod-records-v2\.csv.*line 2/);
});

test('non-integer field error names file and line', () => {
	const dir = tmpExport({ 'tracking-prod-records-v2.csv': V2_HEADER + 'watch-1,1,x,1,1,A,2020-01-01 00:00:00\n' });
	expect(() => parseExport(dir, 'tvtime1')).toThrow('tracking-prod-records-v2.csv line 2: column "ep_id" is not an integer: "x"');
});

test('unparseable date in a file -> error naming the value and file', () => {
	const dir = tmpExport({ 'tracking-prod-records-v2.csv': V2_HEADER + 'watch-1,1,1,1,1,A,yesterday\n' });
	expect(() => parseExport(dir, 'tvtime1')).toThrow('Unrecognised date "yesterday" in tracking-prod-records-v2.csv');
});

describe('toIso', () => {
	test.each([
		['2020-01-02 03:04:05', '2020-01-02T03:04:05Z'],
		['2020-01-02 03:04:05.678', '2020-01-02T03:04:05Z'],
		['2020-01-02T03:04:05', '2020-01-02T03:04:05Z'],
		['2020-01-02T03:04:05.123456', '2020-01-02T03:04:05Z'],
		['2020-01-02T03:04:05Z', '2020-01-02T03:04:05Z'],
		['2020-01-02T03:04:05.9Z', '2020-01-02T03:04:05Z'],
		['2020-01-02T03:04:05+00:00', '2020-01-02T03:04:05Z'],
		['2020-01-02 03:04:05.1+00:00', '2020-01-02T03:04:05Z'],
		// other offsets are converted to UTC
		['2020-01-02T03:04:05+02:00', '2020-01-02T01:04:05Z'],
		['2020-01-01T22:30:00-05:00', '2020-01-02T03:30:00Z'],
		['2020-01-02 03:04:05+0530', '2020-01-01T21:34:05Z'],
		['2020-01-02T03:04:05.250+01', '2020-01-02T02:04:05Z']
	])('%s -> %s', (input, out) => {
		expect(toIso(input, 'f.csv')).toBe(out);
	});

	test.each(['', 'yesterday', '2020-01-02', '2020-13-02 00:00:00', '2020-02-30 00:00:00', '2020-01-02 25:00:00', '2020-01-02T03:04:05 PST', '2020-01-02T03:04:05+2'])(
		'rejects %j',
		(input) => {
			expect(() => toIso(input, 'f.csv')).toThrow(`Unrecognised date "${input}" in f.csv`);
		}
	);
});
