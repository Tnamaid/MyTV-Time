import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDb } from '../../src/lib/server/db/client';
import { title, watch } from '../../src/lib/server/db/schema';

const newTitle = (over: Partial<typeof title.$inferInsert> = {}) => ({
	kind: 'series' as const,
	tmdbId: 1,
	name: 'Show',
	addedAt: '2026-11-24T00:00:00Z',
	...over
});

test('openDb creates all tables', () => {
	const db = openDb(':memory:');
	const names = db
		.all<{ name: string }>(sql`select name from sqlite_master where type='table'`)
		.map((r) => r.name);
	for (const t of ['title', 'season', 'episode', 'watch', 'watchlist', 'import_issue'])
		expect(names).toContain(t);
});

test('stars outside 1..5 rejected', () => {
	const db = openDb(':memory:');
	expect(() => db.insert(title).values(newTitle({ stars: 6 })).run()).toThrow();
	expect(() => db.insert(title).values(newTitle({ stars: 0 })).run()).toThrow();
	db.insert(title).values(newTitle({ stars: 5 })).run();
});

test('title (kind, tmdb_id) is unique and defaults apply', () => {
	const db = openDb(':memory:');
	db.insert(title).values(newTitle()).run();
	const row = db.select().from(title).get()!;
	expect(row.isAnime).toBe(false);
	expect(row.followed).toBe(false);
	expect(row.archived).toBe(false);
	expect(() => db.insert(title).values(newTitle()).run()).toThrow();
	db.insert(title).values(newTitle({ kind: 'movie' })).run();
});

test('watch.import_key unique', () => {
	const db = openDb(':memory:');
	const w = { watchedAt: '2026-11-24T00:00:00Z', source: 'tvtime1' as const, importKey: 'k1' };
	db.insert(watch).values(w).run();
	expect(() => db.insert(watch).values(w).run()).toThrow();
});

test('foreign keys enforced', () => {
	const db = openDb(':memory:');
	expect(() =>
		db
			.insert(watch)
			.values({ titleId: 999, watchedAt: '2026-11-24T00:00:00Z', source: 'app' })
			.run()
	).toThrow();
});

test('openDb creates missing parent directory for file paths', () => {
	const dir = mkdtempSync(join(tmpdir(), 'mytv-'));
	try {
		const db = openDb(join(dir, 'nested', 'tracker.db'));
		expect(db.select().from(title).all()).toEqual([]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('watch.title_id and watch.episode_id are indexed (Up next / Library scans)', () => {
	const db = openDb(':memory:');
	const idx = db
		.all<{ name: string; tbl_name: string }>(sql`select name, tbl_name from sqlite_master where type='index'`)
		.filter((r) => r.tbl_name === 'watch')
		.map((r) => r.name);
	expect(idx).toContain('watch_title_id_idx');
	expect(idx).toContain('watch_episode_id_idx');
	const plan = db
		.all<{ detail: string }>(sql`explain query plan select id from watch where episode_id = 1`)
		.map((r) => r.detail)
		.join(' ');
	expect(plan).toContain('watch_episode_id_idx');
});
