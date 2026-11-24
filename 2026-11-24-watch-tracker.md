# Watch Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted, single-user TV Time replacement: track series/anime episodes, movies, 1–5 stars, watchlist and air dates, with both TV Time exports imported.

**Architecture:** One SvelteKit app (Node adapter) with all logic in plain TypeScript modules under `src/lib/server/` (testable without the UI), SQLite through Drizzle, TMDB as the only metadata source. A CLI script imports TV Time CSVs. Runs in Docker on the old PC, reached over Tailscale.

**Tech Stack:** SvelteKit 2 + Svelte 5, TypeScript, `@sveltejs/adapter-node`, `better-sqlite3` + `drizzle-orm` / `drizzle-kit`, `csv-parse`, Vitest, Playwright (one smoke test), Docker.

**Spec:** `docs/superpowers/specs/2026-11-24-watch-tracker-design.md`

## Global Constraints

- Single user, no login. Never expose ports beyond the tailnet; HTTPS via `tailscale serve`.
- DB is one SQLite file: `./data/tracker.db` (env `DB_PATH`, default `./data/tracker.db`).
- TMDB key from env `TMDB_API_KEY` (v3 key, `api_key` query param). Image base `https://image.tmdb.org/t/p/w342`.
- Stars: integer 1–5 or NULL, per movie and per series only (never per episode).
- Anime = series with TMDB genre id `16` (Animation) AND `origin_country` contains `JP`; user can override.
- "Aired" = `air_date` not null and `<= today` where today is computed in env `TZ` (default `Europe/Paris`).
- Up next: followed, non-archived series; next = first aired episode with season > 0 after the furthest watched (season, episode); earlier gaps ignored; season 0 excluded.
- Upcoming window: 30 days.
- Ticking an episode = one tap (form action, no confirm dialog).
- Never delete a `watch` row during sync or import. Never commit the real exports (`gdpr-data/` is gitignored); fixtures are small, anonymised copies.
- UI language: English.

## Review Focus

1. Re-running the importer must not duplicate watches → `watch.import_key` UNIQUE; test in Task 8.
2. Episodes with no `air_date` (TBA) must not appear in Up next or Upcoming → tests in Task 5.
3. TMDB renumbers/removes an episode that has watches → sync upserts and never deletes an episode with watches → test in Task 3.
4. TMDB error or HTTP 429 mid-sync → existing seasons/episodes untouched, error logged, other shows continue → test in Task 3 and Task 12.
5. Fully watched ended show, or show with no aired episodes → absent from Up next, no crash → tests in Task 5.

---

## File Structure

```
package.json, svelte.config.js, vite.config.ts, tsconfig.json, drizzle.config.ts, .gitignore, .env.example
drizzle/                         generated migrations
src/lib/server/db/schema.ts      all tables
src/lib/server/db/client.ts      openDb(path) -> Db (runs migrations)
src/lib/server/time.ts           today(tz) -> 'YYYY-MM-DD'
src/lib/server/tmdb/client.ts    TmdbClient (fetch injected)
src/lib/server/tmdb/anime.ts     isAnime(details)
src/lib/server/titles/service.ts add/update titles, stars, follow, archive, watchlist
src/lib/server/titles/sync.ts    syncSeries, syncAllDue
src/lib/server/watches/service.ts mark/unmark episode/season/up-to/movie
src/lib/server/queries/*.ts      upNext, upcoming, library
src/lib/server/import/parse.ts   CSV -> typed rows
src/lib/server/import/merge.ts   two exports -> ImportBundle
src/lib/server/import/resolve.ts ImportBundle + TMDB -> DB rows + issues
src/lib/server/import/fix.ts     manual fixes from Fix imports screen
src/lib/server/export.ts         exportAll(db) -> JSON
src/lib/server/scheduler.ts      daily sync loop
src/hooks.server.ts              open db, start scheduler
src/routes/...                   pages (Tasks 10–11)
scripts/import-tvtime.ts         CLI
tests/unit/**, tests/fixtures/tvtime/{export1,export2}/*.csv, tests/e2e/smoke.spec.ts
static/manifest.webmanifest, static/icon-192.png, static/icon-512.png
Dockerfile, docker-compose.yml, docs/INSTALL.md
```

---

### Task 1: Scaffold, schema, DB client

**Files:** Create everything in the first line of File Structure, `src/lib/server/db/{schema,client}.ts`, `src/lib/server/time.ts`, `tests/unit/db.test.ts`, `tests/unit/time.test.ts`.

**Interfaces — Produces:**
- `type Db = BetterSQLite3Database<typeof schema>`; `openDb(path: string): Db` (runs migrations from `./drizzle`; `':memory:'` allowed).
- `today(tz?: string): string` → `'YYYY-MM-DD'`.
- Tables (all `id integer primary key autoincrement` unless noted; timestamps ISO-8601 UTC text):
  - `title`: kind `'movie'|'series'`, tmdb_id int (unique with kind), tvdb_id int null, name, original_name null, year int null, poster_path null, overview null, is_anime bool default false, is_anime_override bool null, status text null, stars int null CHECK 1–5, followed bool default false, archived bool default false, added_at, last_synced_at null.
  - `season`: title_id FK, number, name null, air_date null; unique(title_id, number).
  - `episode`: title_id FK, season_number, episode_number, tmdb_id null, tvdb_id null, name null, air_date null, runtime int null; unique(title_id, season_number, episode_number).
  - `watch`: title_id FK null, episode_id FK null, watched_at, source `'tvtime1'|'tvtime2'|'app'`, import_key text UNIQUE null, raw_tvdb_series_id int null, raw_tvdb_episode_id int null, raw_season int null, raw_episode int null, raw_series_name null, raw_movie_name null, raw_movie_year int null.
  - `watchlist`: title_id FK unique, added_at.
  - `import_issue`: kind `'show'|'episode'|'movie'`, key text unique (e.g. `show:79824`, `episode:79824:1`, `movie:<uuid>`), label, candidates_json null, resolved bool default false, created_at.

- [ ] **Step 1:** `npx sv create . --template minimal --types ts`, add adapter-node, better-sqlite3, drizzle-orm, drizzle-kit, csv-parse, vitest, @playwright/test, tsx. `git init`; `.gitignore` adds `data/`, `gdpr-data/`, `.env`.
- [ ] **Step 2: Failing tests**
```ts
test('openDb creates all tables', () => {
  const db = openDb(':memory:');
  const names = db.all<{name:string}>(sql`select name from sqlite_master where type='table'`).map(r=>r.name);
  for (const t of ['title','season','episode','watch','watchlist','import_issue']) expect(names).toContain(t);
});
test('stars outside 1..5 rejected', () => { /* insert stars=6 -> throws */ });
test('watch.import_key unique', () => { /* second insert same key -> throws */ });
test('today respects tz', () => {
  vi.setSystemTime(new Date('2026-11-24T23:30:00Z'));
  expect(today('Europe/Paris')).toBe('2026-11-25');
  expect(today('UTC')).toBe('2026-11-24');
});
```
- [ ] **Step 3:** Run `npx vitest run tests/unit` → FAIL.
- [ ] **Step 4:** Write schema, `npx drizzle-kit generate`, implement `openDb` (enables `foreign_keys`, WAL) and `today` (via `Intl.DateTimeFormat('en-CA',{timeZone})`).
- [ ] **Step 5:** `npx vitest run tests/unit` → PASS. Commit `feat: scaffold, schema, db client`.

### Task 2: TMDB client + anime rule

**Files:** Create `src/lib/server/tmdb/{client,anime}.ts`, `tests/unit/tmdb.test.ts`.

**Interfaces — Produces:**
- `class TmdbClient { constructor(apiKey: string, fetchFn = fetch) }` with:
  - `findByTvdb(tvdbId: number): Promise<number | null>` → `GET /3/find/{id}?external_source=tvdb_id`, first `tv_results[0].id`.
  - `getShow(id): Promise<ShowDetails>` (`/3/tv/{id}`: name, original_name, first_air_date, poster_path, overview, status, genres, origin_country, seasons[{season_number,name,air_date}], external_ids via `append_to_response=external_ids`).
  - `getSeason(showId, n): Promise<SeasonDetails>` (episodes[{episode_number, season_number, id, name, air_date, runtime}]).
  - `getEpisodeExternalIds(showId, s, e): Promise<{tvdb_id: number|null}>`.
  - `searchMovie(query, year?)`, `searchTv(query)`, `getMovie(id)` (`MovieDetails`: title, original_title, release_date, poster_path, overview, genres).
  - `class TmdbError extends Error { status: number }`. On 429: wait `Retry-After` seconds (default 2), retry up to 3 times, then throw.
- `isAnime(d: {genres:{id:number}[], origin_country?: string[]}): boolean`.

- [ ] **Step 1: Failing tests** (fake `fetchFn` returning canned JSON):
  - `findByTvdb(79824)` builds URL containing `/3/find/79824` and `external_source=tvdb_id`, returns `tv_results[0].id`; returns `null` on empty.
  - 429 then 200 → resolves; 429 ×4 → rejects `TmdbError` with status 429.
  - 500 → rejects `TmdbError` status 500.
  - `isAnime({genres:[{id:16}],origin_country:['JP']})` true; `['US']` false; JP without 16 false.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: tmdb client`.

### Task 3: Titles service + series sync

**Files:** Create `src/lib/server/titles/{service,sync}.ts`, `tests/unit/titles.test.ts`, `tests/unit/sync.test.ts`.

**Interfaces — Consumes:** `Db`, `TmdbClient`, `isAnime`. **Produces:**
- `addSeries(db, tmdb, tmdbId, opts?: {follow?: boolean, tvdbId?: number}): Promise<number>` (title id; idempotent on tmdb_id; calls `syncSeries`).
- `addMovie(db, tmdb, tmdbId): Promise<number>` (idempotent).
- `setStars(db, titleId, stars: 1|2|3|4|5|null)`, `setFollowed(db, titleId, b)`, `setArchived(db, titleId, b)`, `setAnimeOverride(db, titleId, b|null)`, `addToWatchlist(db, titleId)`, `removeFromWatchlist(db, titleId)`.
- `syncSeries(db, tmdb, titleId): Promise<void>` — refresh title fields, upsert seasons and episodes keyed by (title_id, season, episode); delete an episode that TMDB no longer lists **only if** it has no watches.
- `syncAllDue(db, tmdb, now = new Date()): Promise<{ok: number, failed: {titleId: number, error: string}[]}>` — followed, non-archived series with `status` not in (`Ended`,`Canceled`) and `last_synced_at` older than 20 h or null; one at a time; a failure is recorded and the loop continues.

- [ ] **Step 1: Failing tests** (in-memory db, fake TmdbClient object):
  - `addSeries` twice → one row; seasons/episodes inserted; `is_anime` true for anime fixture.
  - `setStars(…, 6 as any)` throws; `setStars(…, null)` clears.
  - Sync where TMDB drops S1E3: if S1E3 has a watch → still present; if not → removed.
  - Sync where `getSeason` throws `TmdbError(500)` → previous episodes unchanged, `syncAllDue` returns it in `failed` and still syncs the next show.
  - Ended show not selected by `syncAllDue`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (each show's sync in one transaction). **Step 4:** PASS. **Step 5:** Commit `feat: titles service and sync`.

### Task 4: Watch service

**Files:** Create `src/lib/server/watches/service.ts`, `tests/unit/watches.test.ts`.

**Interfaces — Produces:**
- `markEpisode(db, episodeId, at = new Date())`, `unmarkEpisode(db, episodeId)` (deletes **app-made latest** watch of that episode; if only imported watches remain, deletes the latest one — user intent wins).
- `markSeason(db, titleId, season, at?)` and `markUpTo(db, episodeId, at?)` — mark every aired, not-yet-watched episode (season > 0 for markUpTo; across earlier seasons too) ; never adds a second watch to already-watched episodes.
- `markMovie(db, titleId, at?)` (always adds a row: rewatch), `unmarkMovieLatest(db, titleId)`.
- `isWatched(db, episodeId): boolean`.

- [ ] **Step 1: Failing tests:** markUpTo(S2E3) on fresh show marks S1 all + S2E1–3, skips S0 and unaired; calling again adds nothing; markMovie twice → 2 rows; unmarkEpisode removes one row.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: watch service`.

### Task 5: Queries — Up next, Upcoming, Library

**Files:** Create `src/lib/server/queries/{upNext,upcoming,library}.ts`, `tests/unit/queries.test.ts`.

**Interfaces — Produces:**
- `getUpNext(db, todayStr): UpNextItem[]` where `UpNextItem = {titleId, name, posterPath, episodeId, season, episode, episodeName, airDate, remainingAired: number, lastWatchedAt: string|null}`; sorted by `lastWatchedAt` desc nulls last.
- `getUpcoming(db, todayStr, days = 30): UpcomingItem[]` (`{titleId, name, episodeId, season, episode, episodeName, airDate}`; `airDate > today` and `<= today+days`, followed non-archived series, sorted by date).
- `searchLibrary(db, f: {q?: string, kind?: 'movie'|'series'|'anime', stars?: number, followed?: boolean, archived?: boolean, sort?: 'name'|'lastWatched'|'stars'}): LibraryItem[]` (`{titleId, kind, name, year, posterPath, stars, isAnime, watchCount, lastWatchedAt}`; `q` matches name or original_name, case-insensitive; anime = effective flag `coalesce(is_anime_override, is_anime)`).

- [ ] **Step 1: Failing tests:**
  - Watched S1E1–E5 and S1E2 missing (gap) → next is S1E6, not S1E2.
  - Next episode with `air_date` null → show absent; future air_date → absent from Up next, present in Upcoming if ≤ 30 days.
  - All aired watched, show ended → absent. No watches at all, followed → S1E1.
  - Archived or unfollowed → absent from both.
  - Watch only on S0E1 → next is S1E1.
  - `searchLibrary({kind:'anime'})` respects override; `q:'naru'` finds "Naruto".
- [ ] **Steps 2–5:** FAIL → implement (SQL, max (season*100000+episode) for furthest) → PASS → commit `feat: queries`.

### Task 6: Import — parse CSVs

**Files:** Create `src/lib/server/import/parse.ts`, `tests/fixtures/tvtime/export1/*.csv`, `tests/fixtures/tvtime/export2/*.csv`, `tests/unit/import-parse.test.ts`.

Fixtures: copy header + 5–15 real rows from each of `tracking-prod-records-v2.csv`, `tracking-prod-records.csv`, `followed_tv_show.csv`, `user_tv_show_data.csv`, `user_show_special_status.csv` (export 2 has no special-status file — parser must accept a missing file). Replace `user_id` with `1`/`2`. Keep export 1's padded headers as-is. Include: one `rewatch-` row, one movie `watch`, one movie `towatch`, one show `for_later`, Naruto (tvdb 78857) in both exports.

**Interfaces — Produces:**
```ts
type EpisodeWatchRow = { tvdbSeriesId: number; tvdbEpisodeId: number; season: number; episode: number; seriesName: string; watchedAt: string; isRewatch: boolean };
type MovieRow = { uuid: string; name: string; releaseYear: number | null; createdAt: string; type: 'watch'|'rewatch'|'towatch' };
type ShowStatusRow = { tvdbId: number; name: string; followed: boolean; archived: boolean; forLater: boolean; createdAt: string };
type ParsedExport = { source: 'tvtime1'|'tvtime2'; episodes: EpisodeWatchRow[]; movies: MovieRow[]; shows: ShowStatusRow[] };
parseExport(dir: string, source: 'tvtime1'|'tvtime2'): ParsedExport
```
Rules: read by header name after trimming keys and values; episode rows = v2 rows whose `key` starts `watch-` or `rewatch-` and have `ep_id`; `release_date` `0001-01-01…` → null year; `created_at` `'YYYY-MM-DD HH:MM:SS'` → ISO UTC `'YYYY-MM-DDTHH:MM:SSZ'`; movie `follow` rows ignored; `followed` = `active=1` or `is_followed=1`.

- [ ] **Step 1: Failing tests:** counts per fixture; padded header in export1 parsed; rewatch flagged; `0001` year → null; missing special-status file OK; dates converted.
- [ ] **Steps 2–5:** FAIL → implement with `csv-parse/sync` → PASS → commit `feat: tvtime parser`.

### Task 7: Import — merge two exports

**Files:** Create `src/lib/server/import/merge.ts`, `tests/unit/import-merge.test.ts`.

**Interfaces — Consumes:** `ParsedExport`. **Produces:**
```ts
type ImportBundle = {
  shows: Map<number, { tvdbId: number; name: string; followed: boolean; archived: boolean; forLater: boolean }>;
  episodeWatches: (EpisodeWatchRow & { source: 'tvtime1'|'tvtime2'; importKey: string })[];
  movies: Map<string, { uuid: string; name: string; releaseYear: number|null; watches: { at: string; source: …; importKey: string }[]; forLater: boolean }>;
};
mergeExports(a: ParsedExport, b: ParsedExport): ImportBundle
```
Rules: episode importKey `ep:{tvdbEpisodeId}:{watchedAt to minute}`; movie importKey `mv:{uuid}:{at to minute}`; dedupe by key; show status: if a show is in both, export 2 (`tvtime2`) values win; every show seen in watches but not in status files is added with followed=false; a movie with only `towatch` → `forLater=true`, no watches.

- [ ] **Step 1: Failing tests:** same episode/time in both → 1 row; rewatch with different time → kept; Naruto status taken from export 2; movie in both with different dates → 2 watches.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: merge exports`.

### Task 8: Import — resolve against TMDB, write, CLI

**Files:** Create `src/lib/server/import/resolve.ts`, `scripts/import-tvtime.ts`, `tests/unit/import-resolve.test.ts`. Add `"import": "tsx scripts/import-tvtime.ts"` to package.json.

**Interfaces — Consumes:** `ImportBundle`, `TmdbClient`, `addSeries`, `addMovie`, `addToWatchlist`. **Produces:**
- `type ImportReport = { shows: number; showsUnmatched: number; episodeWatches: number; episodeWatchesUnmatched: number; movies: number; moviesUnmatched: number; watchlist: number; skippedExisting: number }`.
- `runImport(db, tmdb, bundle, { dryRun: boolean }): Promise<ImportReport>`.
- CLI: `npm run import -- --dir1 <path> --dir2 <path> [--dry-run]`; prints the report as a table; exits 1 if TMDB key missing.

Rules: series via `findByTvdb` → `addSeries({follow, tvdbId})`; null → `import_issue` kind `show` and its watches stored with `title_id` null + raw fields. Episode match by (season, episode) in synced episodes; else, if TMDB episode lookup per season finds a matching `tvdb_id`, use it; else `episode_id` null + one `import_issue` kind `episode` per (show, raw season). Movies: `searchMovie(name, year)`, auto only when exactly one result has normalised title (lowercase, strip punctuation) equal to name and release year equal; else `import_issue` kind `movie` with up to 5 candidates in `candidates_json`, watches stored with raw_movie_name/year. Archived → `setArchived`. forLater → watchlist. Insert watches with `INSERT … ON CONFLICT(import_key) DO NOTHING` and count skips. Dry run: TMDB lookups allowed, wrapped in a transaction that is rolled back.

- [ ] **Step 1: Failing tests** (fake TMDB):
  - Running `runImport` twice → second report `skippedExisting` equals first total, row count unchanged. *(Review Focus 1)*
  - Unknown tvdb id → issue created, watches kept with raw fields, `title_id` null.
  - Ambiguous movie (2 results same title/year) → issue with 2 candidates.
  - `dryRun:true` → report non-zero, DB tables empty after.
  - Archived and for_later flags applied.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Dry-run against real exports (needs `TMDB_API_KEY`): `npm run import -- --dir1 "gdpr-data/gdpr-data 1" --dir2 "gdpr-data/gdpr-data 2" --dry-run`. Expected: shows ≈ 237, episode watches ≈ 9,000, movies ≈ 340; record unmatched counts in the commit message. Commit `feat: tvtime import`.

### Task 9: Fix-imports service

**Files:** Create `src/lib/server/import/fix.ts`, `tests/unit/import-fix.test.ts`.

**Interfaces — Produces:**
- `listOpenIssues(db): ImportIssue[]`.
- `fixShow(db, tmdb, issueKey, tmdbId): Promise<void>` — `addSeries`, set `title_id` on watches with that `raw_tvdb_series_id`, then auto-link episodes by raw (season, episode); leftovers become `episode` issues; resolve the show issue.
- `fixEpisodes(db, titleId, rawSeason, map: { targetSeason: number; offset: number }): { linked: number; unlinked: number }` — for watches with that title and `raw_season`, link to episode (`targetSeason`, `raw_episode + offset`); resolves the issue when `unlinked = 0`.
- `fixMovie(db, tmdb, issueKey, tmdbId): Promise<void>` — `addMovie`, link watches by `raw_movie_name`+`raw_movie_year`, resolve.
- `dismissIssue(db, issueKey)` — mark resolved, watches untouched.

- [ ] **Step 1: Failing tests:** anime absolute numbering: raw S1E30 with map `{targetSeason:2, offset:-25}` links to S2E5; fixShow relinks watches; dismiss keeps watches.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: import fixes`.

### Task 10: UI — shell, Up next, Upcoming, Title page

**Files:** Create `src/hooks.server.ts` (open db once, expose `event.locals.db`, `locals.tmdb`), `src/app.d.ts` locals types, `src/routes/+layout.svelte` (bottom tab bar on < 768 px: Up next, Upcoming, Library, Watchlist, Search; side nav on wider), `src/routes/+page.{server.ts,svelte}`, `src/routes/upcoming/+page.*`, `src/routes/title/[id]/+page.*`, `src/lib/components/{Stars,PosterCard,EpisodeRow}.svelte`, `tests/e2e/smoke.spec.ts`, `playwright.config.ts`.

**Interfaces — Consumes:** Tasks 3–5 functions. Form actions: `?/watch` (episodeId) on `/`; on `/title/[id]`: `?/stars`, `?/follow`, `?/archive`, `?/watchlist`, `?/anime`, `?/markEpisode`, `?/unmarkEpisode`, `?/markSeason`, `?/markUpTo`, `?/markMovie`, `?/refresh`. All actions use `use:enhance` so the list updates without full reload.

Behaviour: Up next card = poster, show name, `S02E05 · name`, `+N more` when `remainingAired > 1`, one big "✓" button. Stars component: tapping the current value clears it. Season accordion; each episode row has a checkbox and a "up to here" menu item; unaired rows greyed with date.

- [ ] **Step 1: Failing e2e** (`DB_PATH` temp file seeded with one followed series S1E1–E3 aired, TMDB stub env `TMDB_FAKE=1` returning fixtures): open `/` at 390×844 viewport, see `S01E01`, tap ✓, see `S01E02`.
- [ ] **Step 2:** `npx playwright test` → FAIL.
- [ ] **Step 3:** Implement pages; add `TMDB_FAKE` switch in hooks that loads a fake client from `tests/fixtures/tmdb/`.
- [ ] **Step 4:** `npx playwright test` and `npm run check` → PASS.
- [ ] **Step 5:** Commit `feat: up next, upcoming, title page`.

### Task 11: UI — Library, Watchlist, Search/add, Fix imports, Settings

**Files:** Create `src/routes/library/+page.*`, `src/routes/watchlist/+page.*`, `src/routes/search/+page.*`, `src/routes/fix-imports/+page.*`, `src/routes/settings/+page.*`, `src/routes/settings/export/+server.ts`, `src/lib/server/export.ts`, `tests/unit/export.test.ts`; extend `tests/e2e/smoke.spec.ts`.

**Interfaces — Produces:** `exportAll(db): { exportedAt: string; titles: …; seasons: …; episodes: …; watches: …; watchlist: … }`; `GET /settings/export` returns it as `watch-tracker-export-YYYY-MM-DD.json` attachment.

Behaviour: Library filters bound to URL query params (`?q=&kind=&stars=&sort=`) so a search on the PC is bookmarkable. Search page queries TMDB (movie + tv) with three buttons per result: "Watched" (movie → `addMovie`+`markMovie`; series → `addSeries` then go to title page), "Watchlist", "Follow" (series only). Fix imports lists open issues grouped by kind: show/movie issues offer TMDB candidates + free search; episode issues offer target season + offset with a live preview of the first 3 mappings; "Dismiss".

- [ ] **Step 1: Failing tests:** `exportAll` round-trips row counts; e2e: search "Dune" (fake TMDB) → Watchlist → appears on `/watchlist`.
- [ ] **Steps 2–4:** FAIL → implement → `npx vitest run && npx playwright test && npm run check` PASS.
- [ ] **Step 5:** Commit `feat: library, watchlist, search, fix imports, export`.

### Task 12: Scheduler, PWA, Docker, install docs

**Files:** Create `src/lib/server/scheduler.ts`, `tests/unit/scheduler.test.ts`, `static/manifest.webmanifest`, `static/icon-192.png`, `static/icon-512.png`, `src/service-worker.ts` (minimal: install/activate only, no offline cache — offline is a non-goal), `Dockerfile`, `docker-compose.yml`, `.env.example`, `docs/INSTALL.md`; modify `src/hooks.server.ts`, `src/app.html` (manifest link, theme-color, apple-touch-icon).

**Interfaces — Produces:** `startScheduler(db, tmdb, { intervalMs = 3_600_000, log = console }): () => void` — every hour calls `syncAllDue` (which itself only picks shows older than 20 h); never overlaps runs; logs `failed` entries; returns stop fn. Not started when `TMDB_FAKE=1` or in tests.

- [ ] **Step 1: Failing test** (fake timers): two ticks while first run still pending → `syncAllDue` called once; a rejected run is logged and the next tick runs. *(Review Focus 4)*
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Dockerfile: multi-stage `node:22-bookworm-slim`, `npm ci && npm run build`, run `node build` with `migrations` copied, `DB_PATH=/data/tracker.db`, port 3000. Compose: volume `./data:/data`, `env_file: .env`, `restart: unless-stopped`, port bound to `127.0.0.1:3000` only.
- [ ] **Step 6:** `docker compose up --build -d` then `curl -s localhost:3000/ | grep -q "Up next"` → exit 0.
- [ ] **Step 7:** `docs/INSTALL.md`: install Docker (Windows: Docker Desktop + WSL2; Linux: docker engine), get TMDB key, `.env`, `docker compose up -d`, Tailscale install on PC and phone, `tailscale serve --bg 3000`, open `https://<machine>.<tailnet>.ts.net` on phone → "Add to Home Screen", run importer (`docker compose exec app npm run import -- …`, dry run first), backup (copy `data/tracker.db` while app stopped or use `sqlite3 .backup`; e.g. nightly copy to OneDrive).
- [ ] **Step 8:** Commit `feat: scheduler, pwa, docker, install docs`.
