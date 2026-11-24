# Watch Tracker — Design

Date: 2026-11-24
Status: approved

## Intent

TV Time (the owner's show/movie tracker) has been discontinued. The owner wants their own self-hosted replacement: a personal record of every movie, series and anime they have watched, with their own 1–5 star score, episode-by-episode tracking, automatic air dates for upcoming episodes, and a watchlist. Their full TV Time history (two GDPR exports) must come along.

Single user. Runs on an old PC at home. Used on a phone (quick ticking/adding from the couch) and on a PC (browsing, searching).

## Goals

- **Series & anime tracking**: tick episodes as watched (one, a whole season, or "everything up to here"); see per show what the next unwatched episode is.
- **Air dates**: the app pulls episode lists and air dates automatically and shows what is coming soon (an "Upcoming" view), plus which followed shows have new unwatched episodes ("Up next").
- **Movies**: mark watched, with the watch date. Rewatches allowed.
- **Stars**: 1–5 stars per movie and per show (not per episode). Optional — unrated is fine.
- **Watchlist**: "want to watch later" list for movies and shows.
- **Search**: search own library (title, type, stars, status); search TMDB to add new titles.
- **Anime**: treated as a series, carrying an "anime" tag (auto-set from TMDB: Animation genre + Japanese origin; editable). Filterable.
- **Import**: one-time import of both TV Time exports, merged, with all watch dates kept.
- **Phone and PC**: one responsive web app, installable on the phone home screen (PWA).

## Non-goals

- Multiple users, accounts, social features, comments, friends, emotions/votes.
- Per-episode ratings.
- Streaming-availability ("where to watch").
- Push notifications (may come later; not in v1).
- Offline mode on the phone (needs network to reach the old PC).

## Anti-goals (would be a failure even if it works)

- Losing or mangling TV Time history (watch dates, which episodes).
- Data stuck in a format the owner can't back up or get out — the database must be one file that's easy to copy.
- Exposing the app on the open internet.
- Clunky on a phone: ticking an episode must be one tap.

## Constraints

- Hardware: an old PC (OS unknown — Windows or Linux). Runs via Docker so it is the same either way.
- Remote access: Tailscale. No ports opened to the internet. No app-level login needed in v1 (the tailnet is the gate). HTTPS (needed for PWA install) via `tailscale serve` *(designer's call; it puts the machine's tailnet hostname in public certificate logs, nothing else is exposed)*.
- Metadata source: TMDB API (free; the owner registers for an API key, stored in an env var).
- Owner speaks French and English; UI language English for v1 (owner's call to change).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Ready-made self-hosted tracker (Yamtrack, Ryot) + custom import | Fastest, but not theirs, UI unlike TV Time, still needs a custom TV Time importer fighting another app's format. |
| **B** | **Own app: SvelteKit + SQLite (chosen)** | One language front and back, smooth phone/PWA feel, single DB file. More work than A. |
| C | Own app: Python FastAPI + server-rendered pages | Python nice for import, but phone UX clunkier unless adding a JS frontend → two languages. |

Owner picked **B**.

## Decided design

### Stack
- SvelteKit (Node adapter), TypeScript.
- SQLite via a light query layer (builder's choice: Drizzle or better-sqlite3 directly) with migrations.
- Docker image + `docker-compose.yml`; DB file on a mounted volume (`./data/tracker.db`).
- PWA manifest + icons so it installs to the phone home screen.

### Data model (sketch — builder refines)
- `title` — id, kind (`movie` | `series`), tmdb_id, tvdb_id (nullable), name, original_name, year, poster_path, overview, is_anime, status (series: returning/ended), stars (1–5, nullable), followed (bool), archived (bool), added_at, last_synced_at.
- `season` — title_id, number, name, air_date.
- `episode` — title_id, season_number, episode_number, tmdb_id, tvdb_id (nullable), name, air_date, runtime.
- `watch` — id, title_id (nullable until an unmapped show is fixed), episode_id (nullable for movies and unmapped episodes), watched_at, source (`tvtime1` | `tvtime2` | `app`), plus raw TV Time fields for imported rows (see import). Multiple rows = rewatches.
- `watchlist` — title_id, added_at.
- `import_issue` — rows from TV Time that could not be matched, for manual fix.

### Screens
- **Up next** (home, phone-first): followed shows with unwatched aired episodes, next episode card with one-tap "watched". "Next" = the first aired episode after the furthest watched one (by season, then episode); earlier gaps are ignored, like TV Time *(owner's choice)*. Season 0 (specials) is excluded.
- **Upcoming**: episodes airing in the next ~30 days for followed shows, by date.
- **Library**: all titles, filter by movie/series/anime, stars, followed/archived; sort by name, last watched, stars.
- **Title page**: poster, stars widget, follow/archive, watchlist toggle; for series, seasons with episode checklists ("mark season", "mark up to here").
- **Watchlist**.
- **Search/add**: TMDB search → add as watched, to watchlist, or follow.

### Air-date sync
- Background job inside the app process: daily refresh of followed, non-ended series from TMDB (seasons + episodes + air dates). Manual "refresh" button per show.
- Rate-limit friendly (TMDB ~40 req/s ceiling; stay far below).

### TV Time import (one-time CLI script, re-runnable)
Source files (per export folder):
- Episode watches: `tracking-prod-records-v2.csv` — rows with `key` starting `watch-`/`rewatch-`, columns `s_id` (TheTVDB series id), `ep_id` (TheTVDB episode id), `s_no`, `ep_no`, `created_at` (watch date), `series_name`. Header has padded whitespace in export 1; trim keys/values.
- Movie watches / watchlist / follows: `tracking-prod-records.csv` — `type` in (`watch`, `rewatch`, `towatch`, `follow`), `entity_type=movie`, `movie_name`, `release_date`, `created_at`. No external movie id; TV Time `uuid` is stable across both accounts.
- Show watchlist: `user_show_special_status.csv` — columns `tv_show_id` (TheTVDB id), `status` (`for_later`), `tv_show_name`, `created_at`; plus `towatch` rows in `tracking-prod-records.csv`.
- Followed/archived shows: `followed_tv_show.csv` — `tv_show_id` (TheTVDB), `active` (1 = followed), `archived` (1 = archived), `created_at`; `user_tv_show_data.csv` — `tv_show_id`, `is_followed`, `is_favorited`, `nb_episodes_seen` (use as a sanity check against imported watch counts).
- Column order differs between the two exports; always read by header name.
- The real exports live on the owner's PC (`gdpr-data/gdpr-data 1` and `gdpr-data 2`); copies are available to the builder for fixtures. Never commit them (they contain personal data); build small anonymised fixtures from them.
- Ignore: tokens, devices, IPs, comments, emotions, notifications, badges, ratings/votes (they are emoji-style vote codes, not stars).

Rules:
- Two exports are two different TV Time accounts (2020–2022 and 2021–2026), overlapping. Merge as union.
- Dedupe episode watches by (tvdb episode id, watched_at to the minute); keep rewatches as extra `watch` rows.
- Series: map TheTVDB id → TMDB id via TMDB `/find/{tvdb_id}?external_source=tvdb_id`; then match episodes by season/episode number (fallback: TMDB episode external ids).
- Movies: match by TMDB search on title + release year; exact single hit → auto; otherwise → `import_issue` for a manual pick in a small "Fix imports" screen.
- Unmapped series or episodes (TVDB id not found via `/find`, or numbering differs — common for anime absolute numbering and specials): never dropped. The `watch` row keeps raw TV Time fields (`tvdb_series_id`, `tvdb_episode_id`, `season`, `episode`, `series_name`) and a nullable `episode_id`; an `import_issue` is created. The "Fix imports" screen covers shows (pick the right TMDB show) and episodes (re-map by offset/season), then re-links the watches. *(Designer's call: losing history is an anti-goal.)*
- Dry-run mode printing counts (shows, episodes, movies, watchlist, unmatched) before writing.
- Expected scale: ~237 shows, ~9,000 episode watches, ~340 movies, ~50 watchlist items.

### Backup
- DB is one file in `./data`. Document a simple copy-based backup (e.g. scheduled copy to another disk/OneDrive). Export-to-CSV/JSON button in settings.

## Left to the builder
- ORM/query layer choice, component library/styling, exact layout.
- Sync scheduler implementation.
- Test strategy (importer logic must be well-tested against sample rows from the real exports).
- Install docs for Docker + Tailscale on the old PC.
