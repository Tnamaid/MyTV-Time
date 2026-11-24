import type { Db } from './db/client';
import { episode, importIssue, season, title, watch, watchlist } from './db/schema';

export type Export = {
	exportedAt: string;
	titles: (typeof title.$inferSelect)[];
	seasons: (typeof season.$inferSelect)[];
	episodes: (typeof episode.$inferSelect)[];
	watches: (typeof watch.$inferSelect)[];
	watchlist: (typeof watchlist.$inferSelect)[];
	/** Open and resolved TV Time import issues (with their raw meta), for a complete backup. */
	importIssues: (typeof importIssue.$inferSelect)[];
};

/** Every row of every table as plain objects, ordered by id, read in one consistent snapshot. */
export function exportAll(db: Db): Export {
	return db.transaction((tx) => ({
		exportedAt: new Date().toISOString(),
		titles: tx.select().from(title).orderBy(title.id).all(),
		seasons: tx.select().from(season).orderBy(season.id).all(),
		episodes: tx.select().from(episode).orderBy(episode.id).all(),
		watches: tx.select().from(watch).orderBy(watch.id).all(),
		watchlist: tx.select().from(watchlist).orderBy(watchlist.id).all(),
		importIssues: tx.select().from(importIssue).orderBy(importIssue.id).all()
	}));
}
