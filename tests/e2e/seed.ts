/**
 * Seeds a fresh e2e database (run by playwright.config.ts before the app starts).
 * Deletes DB_PATH (and its WAL files) first so every run starts from the same state:
 * one followed series "Harbor Lights" (fake TMDB 1001) with S1E1–E3 aired, nothing watched,
 * and S1E4 moved to airing in 5 days so the Upcoming page has something to show
 * (fixtures are static; a ↻ Refresh puts it back to 2099).
 * Plus four open import issues for the Fix imports screen, each with its raw watch rows:
 * a show (TVDB 900002 → fake TMDB 1002 "Dune: Sandwalkers"), a movie ("Dune Part One (2021)",
 * candidate TMDB 438631), an episode issue (Harbor Lights raw S2E5–E6 → S1E1–E2, offset -4)
 * and a movie issue with no candidates ("Lost Reel") to dismiss.
 */
import { rmSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { episode, importIssue, watch } from '../../src/lib/server/db/schema';
import { today } from '../../src/lib/server/time';
import { addSeries } from '../../src/lib/server/titles/service';
import { FakeTmdbClient } from '../../src/lib/server/tmdb/fake';

const path = process.env.DB_PATH;
if (!path) throw new Error('DB_PATH is required');
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });

const db = openDb(path);
const titleId = await addSeries(db, new FakeTmdbClient(), 1001, { follow: true });

const inFiveDays = new Date(`${today()}T00:00:00Z`);
inFiveDays.setUTCDate(inFiveDays.getUTCDate() + 5);
db.update(episode)
	.set({ airDate: inFiveDays.toISOString().slice(0, 10) })
	.where(and(eq(episode.titleId, titleId), eq(episode.seasonNumber, 1), eq(episode.episodeNumber, 4)))
	.run();
const at = '2024-02-01T20:00:00.000Z';
const createdAt = new Date().toISOString();
db.insert(watch)
	.values([
		{ watchedAt: at, source: 'tvtime1', importKey: 'e2e:show', rawTvdbSeriesId: 900002, rawSeason: 1, rawEpisode: 2, rawSeriesName: 'Dune Sandwalkers' },
		{ watchedAt: at, source: 'tvtime1', importKey: 'e2e:movie', rawMovieName: 'Dune Part One', rawMovieYear: 2021 },
		{ titleId, watchedAt: at, source: 'tvtime2', importKey: 'e2e:ep5', rawTvdbSeriesId: 900001, rawSeason: 2, rawEpisode: 5, rawSeriesName: 'Harbor Lights' },
		{ titleId, watchedAt: at, source: 'tvtime2', importKey: 'e2e:ep6', rawTvdbSeriesId: 900001, rawSeason: 2, rawEpisode: 6, rawSeriesName: 'Harbor Lights' }
	])
	.run();
db.insert(importIssue)
	.values([
		{
			kind: 'show',
			key: 'show:900002',
			label: 'Dune Sandwalkers (tvdb 900002)',
			metaJson: JSON.stringify({ tvdbId: 900002, name: 'Dune Sandwalkers', followed: true, archived: false, forLater: false }),
			createdAt
		},
		{
			kind: 'movie',
			key: 'movie:e2e-uuid',
			label: 'Dune Part One (2021)',
			candidatesJson: JSON.stringify([{ id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: null }]),
			metaJson: JSON.stringify({ uuid: 'e2e-uuid', name: 'Dune Part One', releaseYear: 2021, forLater: false }),
			createdAt
		},
		{
			kind: 'movie',
			key: 'movie:e2e-lost',
			label: 'Lost Reel (1999)',
			candidatesJson: '[]',
			metaJson: JSON.stringify({ uuid: 'e2e-lost', name: 'Lost Reel', releaseYear: 1999, forLater: false }),
			createdAt
		},
		{
			kind: 'episode',
			key: 'episode:900001:2',
			label: 'Harbor Lights S2 — 2 unmatched episodes',
			metaJson: JSON.stringify({ tvdbId: 900001, rawSeason: 2 }),
			createdAt
		}
	])
	.run();
db.$client.close();
console.log(`seeded ${path}`);
