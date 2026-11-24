import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

export type UpNextItem = {
	titleId: number;
	name: string;
	posterPath: string | null;
	episodeId: number;
	season: number;
	episode: number;
	episodeName: string | null;
	airDate: string;
	remainingAired: number;
	lastWatchedAt: string | null;
};

type Row = {
	titleId: number;
	name: string;
	posterPath: string | null;
	episodeId: number | null;
	season: number | null;
	episode: number | null;
	episodeName: string | null;
	airDate: string | null;
	remainingAired: number;
	lastWatchedAt: string | null;
};

/**
 * Followed, non-archived series with an aired next episode: the first season>0 episode
 * strictly after the furthest watched (season, episode). Earlier gaps are ignored.
 */
export function getUpNext(db: Db, todayStr: string): UpNextItem[] {
	const rows = db.all<Row>(sql`
		WITH furthest AS (
			SELECT e.title_id AS title_id, MAX(e.season_number * 100000 + e.episode_number) AS k
			FROM watch w JOIN episode e ON e.id = w.episode_id
			WHERE e.season_number > 0
			GROUP BY e.title_id
		),
		base AS (
			SELECT t.id AS title_id, t.name AS name, t.poster_path AS poster_path,
				COALESCE(f.k, 0) AS k,
				(SELECT MAX(w.watched_at) FROM watch w WHERE w.title_id = t.id) AS last_watched_at
			FROM title t LEFT JOIN furthest f ON f.title_id = t.id
			WHERE t.kind = 'series' AND t.followed = 1 AND t.archived = 0
		)
		SELECT b.title_id AS titleId, b.name AS name, b.poster_path AS posterPath,
			n.id AS episodeId, n.season_number AS season, n.episode_number AS episode,
			n.name AS episodeName, n.air_date AS airDate,
			(SELECT COUNT(*) FROM episode r
				WHERE r.title_id = b.title_id AND r.season_number > 0
					AND r.season_number * 100000 + r.episode_number > b.k
					AND r.air_date IS NOT NULL AND r.air_date <= ${todayStr}) AS remainingAired,
			b.last_watched_at AS lastWatchedAt
		FROM base b
		JOIN episode n ON n.id = (
			SELECT x.id FROM episode x
			WHERE x.title_id = b.title_id AND x.season_number > 0
				AND x.season_number * 100000 + x.episode_number > b.k
			ORDER BY x.season_number, x.episode_number LIMIT 1)
		WHERE n.air_date IS NOT NULL AND n.air_date <= ${todayStr}
		ORDER BY b.last_watched_at IS NULL, b.last_watched_at DESC, b.name COLLATE NOCASE
	`);
	return rows.map((r) => ({
		titleId: r.titleId,
		name: r.name,
		posterPath: r.posterPath,
		episodeId: r.episodeId!,
		season: r.season!,
		episode: r.episode!,
		episodeName: r.episodeName,
		airDate: r.airDate!,
		remainingAired: r.remainingAired,
		lastWatchedAt: r.lastWatchedAt
	}));
}
