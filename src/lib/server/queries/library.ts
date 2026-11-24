import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';

export type LibraryFilter = {
	q?: string;
	kind?: 'movie' | 'series' | 'anime';
	stars?: number;
	followed?: boolean;
	archived?: boolean;
	sort?: 'name' | 'lastWatched' | 'stars';
};

export type LibraryItem = {
	titleId: number;
	kind: 'movie' | 'series';
	name: string;
	year: number | null;
	posterPath: string | null;
	stars: number | null;
	isAnime: boolean;
	watchCount: number;
	lastWatchedAt: string | null;
};

type Row = Omit<LibraryItem, 'isAnime'> & { isAnime: number };

export function searchLibrary(db: Db, f: LibraryFilter = {}): LibraryItem[] {
	const conds: SQL[] = [sql`1 = 1`];
	if (f.q) {
		const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		conds.push(sql`(t.name LIKE ${like} ESCAPE '\\' OR t.original_name LIKE ${like} ESCAPE '\\')`);
	}
	if (f.kind === 'movie') conds.push(sql`t.kind = 'movie'`);
	else if (f.kind === 'series') conds.push(sql`t.kind = 'series'`);
	else if (f.kind === 'anime')
		conds.push(sql`t.kind = 'series' AND COALESCE(t.is_anime_override, t.is_anime) = 1`);
	if (f.stars !== undefined) conds.push(sql`t.stars = ${f.stars}`);
	if (f.followed !== undefined) conds.push(sql`t.followed = ${f.followed ? 1 : 0}`);
	if (f.archived !== undefined) conds.push(sql`t.archived = ${f.archived ? 1 : 0}`);

	const name = sql`t.name COLLATE NOCASE`;
	const order =
		f.sort === 'lastWatched'
			? sql`lastWatchedAt IS NULL, lastWatchedAt DESC, ${name}`
			: f.sort === 'stars'
				? sql`t.stars IS NULL, t.stars DESC, ${name}`
				: name;

	const rows = db.all<Row>(sql`
		SELECT t.id AS titleId, t.kind AS kind, t.name AS name, t.year AS year,
			t.poster_path AS posterPath, t.stars AS stars,
			COALESCE(t.is_anime_override, t.is_anime) AS isAnime,
			(SELECT COUNT(*) FROM watch w WHERE w.title_id = t.id) AS watchCount,
			(SELECT MAX(w.watched_at) FROM watch w WHERE w.title_id = t.id) AS lastWatchedAt
		FROM title t
		WHERE ${sql.join(conds, sql` AND `)}
		ORDER BY ${order}
	`);
	return rows.map((r) => ({ ...r, isAnime: !!r.isAnime }));
}
