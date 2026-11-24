import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

export type UpcomingItem = {
	titleId: number;
	name: string;
	episodeId: number;
	season: number;
	episode: number;
	episodeName: string | null;
	airDate: string;
};

/** Add days to a 'YYYY-MM-DD' string using UTC date math. */
function addDays(dateStr: string, days: number): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Episodes airing in (today, today + days] for followed, non-archived series; specials excluded. */
export function getUpcoming(db: Db, todayStr: string, days = 30): UpcomingItem[] {
	const end = addDays(todayStr, days);
	return db.all<UpcomingItem>(sql`
		SELECT t.id AS titleId, t.name AS name, e.id AS episodeId,
			e.season_number AS season, e.episode_number AS episode,
			e.name AS episodeName, e.air_date AS airDate
		FROM episode e JOIN title t ON t.id = e.title_id
		WHERE t.kind = 'series' AND t.followed = 1 AND t.archived = 0
			AND e.season_number > 0
			AND e.air_date IS NOT NULL AND e.air_date > ${todayStr} AND e.air_date <= ${end}
		ORDER BY e.air_date, t.name COLLATE NOCASE, e.season_number, e.episode_number
	`);
}
