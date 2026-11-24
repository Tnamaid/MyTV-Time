import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });

export const title = sqliteTable(
	'title',
	{
		id: id(),
		kind: text('kind', { enum: ['movie', 'series'] }).notNull(),
		tmdbId: integer('tmdb_id').notNull(),
		tvdbId: integer('tvdb_id'),
		name: text('name').notNull(),
		originalName: text('original_name'),
		year: integer('year'),
		posterPath: text('poster_path'),
		overview: text('overview'),
		isAnime: integer('is_anime', { mode: 'boolean' }).notNull().default(false),
		isAnimeOverride: integer('is_anime_override', { mode: 'boolean' }),
		status: text('status'),
		stars: integer('stars'),
		followed: integer('followed', { mode: 'boolean' }).notNull().default(false),
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
		addedAt: text('added_at').notNull(),
		lastSyncedAt: text('last_synced_at')
	},
	(t) => [
		unique('title_kind_tmdb_id_unique').on(t.kind, t.tmdbId),
		check('title_stars_check', sql`${t.stars} IS NULL OR (${t.stars} BETWEEN 1 AND 5)`)
	]
);

export const season = sqliteTable(
	'season',
	{
		id: id(),
		titleId: integer('title_id')
			.notNull()
			.references(() => title.id),
		number: integer('number').notNull(),
		name: text('name'),
		airDate: text('air_date')
	},
	(t) => [unique('season_title_id_number_unique').on(t.titleId, t.number)]
);

export const episode = sqliteTable(
	'episode',
	{
		id: id(),
		titleId: integer('title_id')
			.notNull()
			.references(() => title.id),
		seasonNumber: integer('season_number').notNull(),
		episodeNumber: integer('episode_number').notNull(),
		tmdbId: integer('tmdb_id'),
		tvdbId: integer('tvdb_id'),
		name: text('name'),
		airDate: text('air_date'),
		runtime: integer('runtime')
	},
	(t) => [
		unique('episode_title_season_episode_unique').on(t.titleId, t.seasonNumber, t.episodeNumber)
	]
);

export const watch = sqliteTable('watch', {
	id: id(),
	titleId: integer('title_id').references(() => title.id),
	episodeId: integer('episode_id').references(() => episode.id),
	watchedAt: text('watched_at').notNull(),
	source: text('source', { enum: ['tvtime1', 'tvtime2', 'app'] }).notNull(),
	importKey: text('import_key').unique(),
	rawTvdbSeriesId: integer('raw_tvdb_series_id'),
	rawTvdbEpisodeId: integer('raw_tvdb_episode_id'),
	rawSeason: integer('raw_season'),
	rawEpisode: integer('raw_episode'),
	rawSeriesName: text('raw_series_name'),
	rawMovieName: text('raw_movie_name'),
	rawMovieYear: integer('raw_movie_year')
}, (t) => [
	index('watch_title_id_idx').on(t.titleId),
	index('watch_episode_id_idx').on(t.episodeId)
]);

export const watchlist = sqliteTable('watchlist', {
	id: id(),
	titleId: integer('title_id')
		.notNull()
		.unique()
		.references(() => title.id),
	addedAt: text('added_at').notNull()
});

export const importIssue = sqliteTable('import_issue', {
	id: id(),
	kind: text('kind', { enum: ['show', 'episode', 'movie'] }).notNull(),
	key: text('key').notNull().unique(),
	label: text('label').notNull(),
	candidatesJson: text('candidates_json'),
	/** TV Time state of the unmatched item (flags etc.) so a later resolution can apply it. */
	metaJson: text('meta_json'),
	resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull()
});
