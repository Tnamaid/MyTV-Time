/**
 * Seeds a fresh e2e database (run by playwright.config.ts before the app starts).
 * Deletes DB_PATH (and its WAL files) first so every run starts from the same state:
 * one followed series "Harbor Lights" (fake TMDB 1001) with S1E1–E3 aired, nothing watched,
 * and S1E4 moved to airing in 5 days so the Upcoming page has something to show
 * (fixtures are static; a ↻ Refresh puts it back to 2099).
 */
import { rmSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { episode } from '../../src/lib/server/db/schema';
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
db.$client.close();
console.log(`seeded ${path}`);
