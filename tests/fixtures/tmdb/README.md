# Fake TMDB fixtures

Read by `src/lib/server/tmdb/fake.ts` when the app runs with `TMDB_FAKE=1` (e2e tests).

- `tv/<tmdbId>.json` — `ShowDetails` (getShow; `external_ids.tvdb_id` drives findByTvdb)
- `tv/<tmdbId>-season-<n>.json` — `SeasonDetails` (getSeason)
- `movie/<tmdbId>.json` — `MovieDetails` (getMovie)

searchMovie / searchTv match the query case-insensitively against the titles of
these files. getEpisodeExternalIds always answers `{ tvdb_id: null }`.
Data is invented; posters are null so tests never hit the network.

Titles: tv 1001 "Harbor Lights" (seeded, followed), tv 1002 "Dune: Sandwalkers" (target of the
seeded show import issue, tvdb 900002), movie 438631 "Dune" (search "Dune" finds both kinds).
