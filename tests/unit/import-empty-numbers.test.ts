import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { episode, importIssue, watch } from '../../src/lib/server/db/schema';
import { episodeIssueTarget, fixEpisodes, listOpenIssues, previewEpisodeMapping } from '../../src/lib/server/import/fix';
import { mergeExports } from '../../src/lib/server/import/merge';
import { parseExport } from '../../src/lib/server/import/parse';
import { formatSanity, runImport } from '../../src/lib/server/import/resolve';
import { ep, fakeTmdb, show } from './fakeTmdb';

// Real TV Time exports have watch rows with an empty s_no (and sometimes ep_no / ep_id / s_id).
const FIXTURE = 'tests/fixtures/tvtime/empty-numbers';

function emptyExport(): string {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	writeFileSync(join(dir, 'tracking-prod-records-v2.csv'), 'key,s_id,ep_id,s_no,ep_no,series_name,created_at\n');
	return dir;
}

// Breaking Bad: tvdb 81189 -> tmdb 9; S1E1-3 and S2E1-2, tvdb episode ids known to TMDB.
const tmdb = () =>
	fakeTmdb({
		tvdb: { 81189: 9 },
		shows: {
			9: show({
				id: 9, name: 'Breaking Bad', external_ids: { tvdb_id: 81189 },
				seasons: [1, 2].map((n) => ({ season_number: n, name: `Season ${n}`, air_date: '2008-01-20' }))
			})
		},
		seasons: { '9:1': { episodes: [ep(1, 1), ep(1, 2), ep(1, 3)] }, '9:2': { episodes: [ep(2, 1), ep(2, 2)] } },
		episodeTvdb: { '9:1:1': 349232, '9:1:2': 349235, '9:1:3': 349236, '9:2:1': 349238, '9:2:2': 349239 }
	});

const bundle = () => mergeExports(parseExport(FIXTURE, 'tvtime1'), parseExport(emptyExport(), 'tvtime2'));

test('parse: empty s_no/ep_no/ep_id become null instead of aborting; only rows without s_id are skipped', () => {
	const p = parseExport(FIXTURE, 'tvtime1');
	expect(p.rowStats).toEqual({ noShowId: 1, noEpisodeId: 1, noNumbers: 4 });
	expect(p.episodes).toHaveLength(6);
	expect(p.episodes[0]).toEqual({
		tvdbSeriesId: 81189, tvdbEpisodeId: 349235, season: null, episode: 2,
		seriesName: 'Breaking Bad', watchedAt: '2019-11-11T22:30:45Z', isRewatch: false
	});
	expect(p.episodes.find((e) => e.tvdbEpisodeId === 349238)).toMatchObject({ season: null, episode: null });
	expect(p.episodes.find((e) => e.tvdbEpisodeId === null)).toMatchObject({ season: 1, episode: 3 });
	expect(p.episodes.filter((e) => e.isRewatch)).toHaveLength(1);
});

test('parse: a non-empty s_no that is not a number still fails (shifted columns)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'tvt-'));
	writeFileSync(
		join(dir, 'tracking-prod-records-v2.csv'),
		'key,s_id,ep_id,s_no,ep_no,series_name,created_at\nwatch-1,1,1,Lost,1,X,2020-01-01 00:00:00\n'
	);
	expect(() => parseExport(dir, 'tvtime1')).toThrow(/line 2: column "s_no" is not an integer: "Lost"/);
});

test('import: rows without a season are linked by tvdb episode id, the rest go to Fix imports, nothing is lost', async () => {
	const db = openDb(':memory:');
	const r = await runImport(db, tmdb(), bundle(), { dryRun: false });
	expect(r).toMatchObject({ shows: 1, showsUnmatched: 0, episodeWatches: 6, episodeWatchesUnmatched: 1, skippedExisting: 0 });

	const ws = db.select().from(watch).all();
	expect(ws).toHaveLength(6); // every watch row with a show id is stored
	const linkedTo = (tvdbEp: number | null, at: string) => {
		const w = ws.find((x) => x.rawTvdbEpisodeId === tvdbEp && x.watchedAt.startsWith(at))!;
		if (w.episodeId === null) return null;
		const e = db.select().from(episode).where(eq(episode.id, w.episodeId)).get()!;
		return [e.seasonNumber, e.episodeNumber];
	};
	expect(linkedTo(349235, '2019-11-11')).toEqual([1, 2]); // no s_no
	expect(linkedTo(349235, '2022-04-01')).toEqual([1, 2]); // rewatch, no s_no
	expect(linkedTo(349238, '2019-11-20')).toEqual([2, 1]); // no s_no nor ep_no, other season
	expect(linkedTo(349232, '2019-11-10')).toEqual([1, 1]);
	expect(linkedTo(null, '2019-11-12')).toEqual([1, 3]); // no ep_id, by numbers
	expect(linkedTo(999001, '2019-12-01')).toBeNull();

	const lost = ws.find((x) => x.rawTvdbEpisodeId === 999001)!;
	expect(lost).toMatchObject({ rawSeason: null, rawEpisode: null, rawSeriesName: 'Breaking Bad' });
	expect(lost.titleId).not.toBeNull();

	const issues = listOpenIssues(db);
	expect(issues.map((i) => [i.kind, i.key, i.label])).toEqual([
		['episode', 'episode:81189:none', 'Breaking Bad no season number — 1 unmatched episode']
	]);
	expect(issues[0].meta).toEqual({ tvdbId: 81189, rawSeason: null });

	const text = formatSanity(r).join('\n');
	expect(text).toMatch(/without a season or episode number .*export 1: 4, export 2: 0/);
	expect(text).toMatch(/without an episode id .*export 1: 1, export 2: 0/);
	expect(text).toMatch(/without a show id .*export 1: 1, export 2: 0/);
});

test('re-running the import adds nothing (rows without ep_id dedupe too)', async () => {
	const db = openDb(':memory:');
	await runImport(db, tmdb(), bundle(), { dryRun: false });
	const r = await runImport(db, tmdb(), bundle(), { dryRun: false });
	expect(r.skippedExisting).toBe(6);
	expect(db.select().from(watch).all()).toHaveLength(6);
	expect(db.select().from(importIssue).all()).toHaveLength(1);
});

test('--dry-run with empty s_no writes nothing', async () => {
	const db = openDb(':memory:');
	const r = await runImport(db, tmdb(), bundle(), { dryRun: true });
	expect(r.episodeWatches).toBe(6);
	expect(db.select().from(watch).all()).toEqual([]);
	expect(db.select().from(importIssue).all()).toEqual([]);
});

test('Fix imports: the "no season number" issue can be mapped by hand when it has an episode number', async () => {
	const db = openDb(':memory:');
	const t = fakeTmdb({}); // TMDB knows nothing at import time except the show
	Object.assign(t, { findByTvdb: tmdb().findByTvdb, getShow: tmdb().getShow, getSeason: tmdb().getSeason });
	await runImport(db, t, bundle(), { dryRun: false });
	// Without tvdb episode ids, the 2 S??E02 watches and the 2 S??E?? watches stay unlinked.
	const target = episodeIssueTarget(db, 'episode:81189:none')!;
	expect(target.rawSeason).toBeNull();
	const preview = previewEpisodeMapping(db, target.titleId, null, { targetSeason: 1, offset: 0 });
	expect(preview).toEqual([{ rawSeason: null, rawEpisode: 2, targetSeason: 1, targetEpisode: 2, targetName: 'E2' }]);
	expect(fixEpisodes(db, target.titleId, null, { targetSeason: 1, offset: 0 })).toEqual({ linked: 2, unlinked: 2 });
	// The watches with no episode number either stay listed (they can be dismissed); none is deleted.
	expect(db.select().from(watch).all()).toHaveLength(6);
	expect(listOpenIssues(db).map((i) => i.key)).toContain('episode:81189:none');
});

test('a watch without a season still gets the full sweep when another miss was linked in its own season', async () => {
	const t = fakeTmdb({
		tvdb: { 900: 9 },
		shows: { 9: show({ id: 9, name: 'Wide', external_ids: { tvdb_id: 900 }, seasons: [1, 2, 3].map((n) => ({ season_number: n, name: `S${n}`, air_date: null })) }) },
		seasons: Object.fromEntries([1, 2, 3].map((n) => [`9:${n}`, { episodes: [1, 2].map((i) => ep(n, i)) }])),
		episodeTvdb: { '9:2:2': 9202, '9:3:1': 9301 }
	});
	const row = (tvdbEpisodeId: number, season: number | null, e: number | null, at: string) => ({
		tvdbSeriesId: 900, tvdbEpisodeId, season, episode: e, seriesName: 'Wide', watchedAt: at, isRewatch: false,
		source: 'tvtime1' as const, importKey: `ep:${tvdbEpisodeId}:${at.slice(0, 16)}`
	});
	const db = openDb(':memory:');
	const r = await runImport(db, t, {
		shows: new Map(),
		episodeWatches: [row(9202, 2, 7, '2021-01-01T10:00:00Z'), row(9301, null, null, '2021-01-02T10:00:00Z')],
		movies: new Map()
	}, { dryRun: false });
	expect(r.episodeWatchesUnmatched).toBe(0);
	const w = db.select().from(watch).where(eq(watch.rawTvdbEpisodeId, 9301)).get()!;
	const e = db.select().from(episode).where(eq(episode.id, w.episodeId!)).get()!;
	expect([e.seasonNumber, e.episodeNumber]).toEqual([3, 1]);
});
