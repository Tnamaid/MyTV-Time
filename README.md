# MyTV-Time
I want to make my own self hosted repertory of the movies, series and anime I watched with my score one to 5 stars. The baseline is TV-time which has been dicontinued.

MyTV-Time is a small private web app, installable on your phone's home screen: track the series,
anime and movies you watch, rate them (1–5 stars), see what's up next and what airs soon (episode
data from [TMDB](https://www.themoviedb.org/)), and import your history from TV Time's GDPR export.
It runs on your own PC with Docker and is reached from your phone through Tailscale; your data is a
single SQLite file.

**Install:** see [docs/INSTALL.md](docs/INSTALL.md). Setting up a dedicated Debian home server from scratch: [docs/SETUP-DEBIAN.md](docs/SETUP-DEBIAN.md).

**Develop:** `npm ci`, then `npm run dev`; tests: `npm test` (unit) and `npm run test:e2e` (Playwright).
