CREATE TABLE `episode` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`tmdb_id` integer,
	`tvdb_id` integer,
	`name` text,
	`air_date` text,
	`runtime` integer,
	FOREIGN KEY (`title_id`) REFERENCES `title`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_title_season_episode_unique` ON `episode` (`title_id`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE TABLE `import_issue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`candidates_json` text,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_issue_key_unique` ON `import_issue` (`key`);--> statement-breakpoint
CREATE TABLE `season` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text,
	`air_date` text,
	FOREIGN KEY (`title_id`) REFERENCES `title`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_title_id_number_unique` ON `season` (`title_id`,`number`);--> statement-breakpoint
CREATE TABLE `title` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`tvdb_id` integer,
	`name` text NOT NULL,
	`original_name` text,
	`year` integer,
	`poster_path` text,
	`overview` text,
	`is_anime` integer DEFAULT false NOT NULL,
	`is_anime_override` integer,
	`status` text,
	`stars` integer,
	`followed` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`added_at` text NOT NULL,
	`last_synced_at` text,
	CONSTRAINT "title_stars_check" CHECK("title"."stars" IS NULL OR ("title"."stars" BETWEEN 1 AND 5))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `title_kind_tmdb_id_unique` ON `title` (`kind`,`tmdb_id`);--> statement-breakpoint
CREATE TABLE `watch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer,
	`episode_id` integer,
	`watched_at` text NOT NULL,
	`source` text NOT NULL,
	`import_key` text,
	`raw_tvdb_series_id` integer,
	`raw_tvdb_episode_id` integer,
	`raw_season` integer,
	`raw_episode` integer,
	`raw_series_name` text,
	`raw_movie_name` text,
	`raw_movie_year` integer,
	FOREIGN KEY (`title_id`) REFERENCES `title`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episode`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_import_key_unique` ON `watch` (`import_key`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `title`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_title_id_unique` ON `watchlist` (`title_id`);