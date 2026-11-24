# Installing MyTV-Time on your PC

This guide puts MyTV-Time on an always-on PC (Windows or Linux) and makes it reachable from your
phone, privately, through Tailscale. Nothing is opened to the internet: the app only listens on the
PC itself, and Tailscale gives it an HTTPS address that only your own devices can reach.

You will:

1. Install Docker
2. Install Tailscale (PC and phone) and get the app's address
3. Download MyTV-Time
4. Get a TMDB API key
5. Create the `.env` settings file
6. Start the app
7. Add it to your phone's home screen
8. Import your TV Time history
9. Set up backups

Plus: [updating](#updating), [restoring a backup](#restoring-a-backup) and [troubleshooting](#troubleshooting).

Commands in grey boxes are typed in a terminal: **PowerShell** on Windows (Start menu → "PowerShell"),
**Terminal** on Linux. Lines starting with `#` are comments; you don't type them.

---

## 1. Install Docker

Docker runs the app in a self-contained box, so you don't have to install Node.js or anything else.

**Windows 10/11**

1. Open PowerShell **as administrator** (right-click → "Run as administrator") and run:
   ```powershell
   wsl --install
   ```
   Restart the PC when it asks.
2. Download and install **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>.
   Keep the default "Use WSL 2" option.
3. Open Docker Desktop → **Settings → General** → tick **"Start Docker Desktop when you sign in to
   your computer"**. This is what brings the app back after a reboot.
4. Also install **Git for Windows** (<https://git-scm.com/download/win>, all defaults) — used to
   download and update MyTV-Time.

**Linux (Debian/Ubuntu)**

Follow <https://docs.docker.com/engine/install/> for your distribution (the "apt repository" method),
then:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # then log out and back in, so you can run docker without sudo
sudo apt install git
```

Check it works: `docker compose version` should print a version number.

> The PC must stay on (and not go to sleep) for the app and its hourly air-date sync to work.
> On Windows: Settings → System → Power → set "Sleep" to **Never** when plugged in.

## 2. Install Tailscale and get the app's address

Tailscale is a private network between your own devices ("tailnet"). Free for personal use.

1. Create an account at <https://tailscale.com> and install Tailscale **on the PC**
   (<https://tailscale.com/download>) and **on your phone** (App Store / Play Store). Sign in with the
   same account on both.
2. In the Tailscale admin console (<https://login.tailscale.com/admin/dns>), make sure **MagicDNS**
   is on and **HTTPS Certificates** is enabled.
3. On the PC, run:
   ```bash
   tailscale serve --bg 3000
   ```
   (On Linux, prefix with `sudo`. If it prints a link asking you to enable HTTPS, open it, accept, and
   run the command again.)

   It prints the app's address, something like:
   ```
   Available within your tailnet:
   https://my-pc.tail1234.ts.net/
   |-- proxy http://127.0.0.1:3000
   ```
   **Write this address down** — `https://my-pc.tail1234.ts.net` (without the final `/`). You need it in
   step 5. This setting survives reboots; you only do it once.

To see it again later: `tailscale serve status`.

## 3. Download MyTV-Time

Choose a folder that is **not** synced by OneDrive/Dropbox (a sync tool copying the live database
while the app writes to it can corrupt it — backups to OneDrive are covered in step 9).

```bash
# Windows example: C:\mytv-time      Linux example: ~/mytv-time
cd C:\
git clone <your repository URL> mytv-time
cd mytv-time
```

All the following commands are run **inside this `mytv-time` folder**.

## 4. Get a TMDB API key

TMDB (The Movie Database) provides the titles, posters and air dates.

1. Create a free account at <https://www.themoviedb.org/signup>.
2. Go to **Settings → API** (<https://www.themoviedb.org/settings/api>) and request an API key
   ("Developer", personal/non-commercial use). The form asks for an app name and URL; anything
   reasonable is fine (e.g. "MyTV-Time", "http://localhost").
3. Copy the **API Key** (the short one, 32 characters — not the long "Read Access Token").

## 5. Create the `.env` settings file

Copy the example file:

```bash
# Windows (PowerShell)
copy .env.example .env
# Linux
cp .env.example .env
```

Open `.env` in a text editor (Windows: `notepad .env`; Linux: `nano .env`) and fill it in:

```ini
TMDB_API_KEY=0123456789abcdef0123456789abcdef
ORIGIN=https://my-pc.tail1234.ts.net
TZ=Europe/Paris
```

- **`TMDB_API_KEY`** — the key from step 4.
- **`ORIGIN`** — **required.** The exact address from step 2: starts with `https://`, no `/` at the
  end. For security, the app refuses button clicks and forms (error **403**) unless the page was
  opened at exactly this address. That means you must always open the app at
  `https://my-pc.tail1234.ts.net` — also on the PC itself — and **not** at `http://localhost:3000`
  (pages would display there, but buttons would fail).
- **`TZ`** — your time zone; it decides what "today" is (what has aired, what's up next).
  Keep `Europe/Paris` unless you move.

Leave `DB_PATH` commented out: with Docker the database is always `data/tracker.db` in this folder.

## 6. Start the app

Also create the folder for your TV Time exports (used in step 8):

```bash
mkdir gdpr-data
docker compose up -d
```

The first start builds the app and takes a few minutes. When it's done:

```bash
docker compose ps        # STATUS should say "Up"
docker compose logs app  # should end with "Listening on http://0.0.0.0:3000"
```

Open **`https://my-pc.tail1234.ts.net`** (your address) in a browser: you should see the
**Up next** page (empty for now).

The app restarts by itself after a crash or a reboot (`restart: unless-stopped`). It checks TMDB for
new episodes and air dates of the shows you follow once shortly after it starts and then every hour
(each show at most once every 20 hours). You can see this in `docker compose logs app` as `[sync]`
lines; a TMDB error on one show is logged and that show's data is left as it was.

To stop the app: `docker compose stop`. To start it again: `docker compose start`.

## 7. Add it to your phone's home screen

Make sure Tailscale is connected on the phone, then open your address
(`https://my-pc.tail1234.ts.net`):

- **iPhone (Safari):** Share button → **Add to Home Screen** → Add.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

It then opens full-screen like an app. It needs the connection to your PC (there is no offline mode):
if it doesn't load, check that Tailscale is on, on the phone, and that the PC is awake.

## 8. Import your TV Time history

You need your two TV Time GDPR exports (the unzipped folders). Put them inside the `gdpr-data`
folder of the project, named exactly like this:

```
mytv-time/
  gdpr-data/
    gdpr-data 1/     <- first export (contains the .csv files)
    gdpr-data 2/     <- second export
```

The container sees this folder (read-only) as `/gdpr-data`.

**First, a dry run** — it reads everything and looks every title up on TMDB, but writes nothing.
It can take several minutes (hundreds of TMDB lookups).

```bash
docker compose exec app npm run import -- --dir1 "/gdpr-data/gdpr-data 1" --dir2 "/gdpr-data/gdpr-data 2" --dry-run
```

It ends with `DRY RUN — nothing was written.`, a table of counts and a sanity check. The counts
are **totals: matched + unmatched**; the `…Unmatched` line next to each says how many of them still
need a hand in Fix imports.

| Line                      | Meaning                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `shows`                   | Shows found in the exports (matched + unmatched)                                |
| `showsUnmatched`          | Of those, shows not matched to TMDB automatically (you fix them afterwards)     |
| `episodeWatches`          | Episode "watched" records found (linked + not yet linked)                       |
| `episodeWatchesUnmatched` | Of those, watches kept but not yet linked to a TMDB episode                     |
| `movies`                  | Movies found (matched + unmatched)                                              |
| `moviesUnmatched`         | Of those, movies not matched to TMDB automatically                              |
| `watchlist`               | "For later" items added to your watchlist                                       |
| `skippedExisting`         | Watches already imported by a previous run (0 the first time)                   |

What to expect from your exports: roughly **237 shows**, **9,000 episode watches** and **340 movies**.
A handful of unmatched entries is normal. If the totals are far off, stop here and report it rather
than importing.

Then the **sanity check** compares the import with TV Time's own numbers, to catch lost history
before you trust it:

```
Sanity check against TV Time:
  Watch rows without an episode id (cannot be imported): export 1: 0, export 2: 3
  Episodes seen according to TV Time (nb_episodes_seen): 8,912
  Distinct episodes imported for those shows:            8,905
  Shows with fewer imported episodes than TV Time counted: 2
    Some Show (tvdb 123456): 40 imported, TV Time says 45
    …
```

- **Watch rows without an episode id** — rows of TV Time's watch file that name no episode, per
  export. They can't be imported. A few is normal; hundreds means the export is not what the
  importer expects — report it.
- **Episodes seen according to TV Time** — the sum of each show's `nb_episodes_seen` (from
  `user_tv_show_data.csv`; the larger of the two exports per show). If your export has no such
  column, the line says the totals can't be cross-checked.
- **Distinct episodes imported** — for those same shows, how many different episodes have at least
  one watch in the import (rewatches count once). It should be close to the line above.
- **Shows with fewer imported episodes** — up to 10 shows where the import has fewer episodes than
  TV Time counted, biggest gap first (the count says how many there are in all). Each one means TV
  Time's counter is higher than the watches its export lists for that show. Check those shows in
  the app after the import; if history is clearly missing, report it before relying on the import.

If the dry run stops with an error instead:

- `TMDB rejected the API key` — fix `TMDB_API_KEY` in `.env`, then `docker compose up -d` and retry.
- `Could not reach TMDB, even after retries` — the internet connection dropped for more than a few
  seconds (each request is retried 3 times). Nothing was written; just run the command again.
- `…/tracking-prod-records-v2.csv not found — is --dir pointing at the export folder?` — the folder
  given to `--dir1`/`--dir2` is not the unzipped export (the one that directly contains the `.csv`
  files). Check the folder names in `gdpr-data`.
- `<file>.csv: missing required column "<name>"` (or `line <n>: row is too short`,
  `not an integer`, `Unrecognised date`) — the
  importer was built and tested against made-up sample files shaped like a TV Time export, and your
  real export differs somewhere. The message names the file and the column: please report that
  message (nothing was written to the database).

**Then the real import** — the same command without `--dry-run`:

```bash
docker compose exec app npm run import -- --dir1 "/gdpr-data/gdpr-data 1" --dir2 "/gdpr-data/gdpr-data 2"
```

It ends with `Import complete.` and the same table and sanity check. It's safe to run again:
already-imported watches are skipped (counted in `skippedExisting`), and a re-run only **adds**
history — it doesn't change shows and movies that are already in the app (followed, archived,
watchlist stay as you set them). Avoid using the app while an import is running.

**Finally, fix what didn't match:** in the app, go to **Settings → Fix imports** (`/fix-imports`).
Each unmatched show, movie or episode is listed there; pick the right TMDB title (or dismiss it).
Your watches are kept either way — nothing is thrown away.

## 9. Backups

Everything (your watches, ratings, watchlist) is in one file: `data/tracker.db` in the project
folder. Back it up regularly.

### Option A — simple: stop, copy, start

```bash
docker compose stop
# copy the whole "data" folder somewhere safe (e.g. into OneDrive)
docker compose start
```

Copy the whole `data` folder, not just `tracker.db`: it may also contain `tracker.db-wal` /
`tracker.db-shm` files that hold recent changes.

### Option B — automatic, while the app keeps running

The app has a safe online backup command (it uses SQLite's backup feature, so the copy is
consistent even if you're using the app at that moment):

```bash
docker compose exec -T app npm run backup -- /data/backups/
```

This writes `data/backups/tracker-YYYY-MM-DD.db` in the project folder (one file per day; running it
twice the same day overwrites that day's file). A backup file is a complete database on its own.

**Windows — nightly copy to OneDrive with Task Scheduler**

1. Save this as `C:\mytv-time\backup.ps1` (adjust the two paths at the top if yours differ):
   ```powershell
   $project = "C:\mytv-time"
   $target  = "$env:OneDrive\MyTV-Time backups"

   Set-Location $project
   docker compose exec -T app npm run backup -- /data/backups/
   if ($LASTEXITCODE -ne 0) { exit 1 }
   New-Item -ItemType Directory -Force -Path $target | Out-Null
   $latest = Get-ChildItem "$project\data\backups\tracker-*.db" | Sort-Object LastWriteTime | Select-Object -Last 1
   Copy-Item $latest.FullName $target -Force
   # keep 30 days, locally and in OneDrive
   Get-ChildItem "$project\data\backups\tracker-*.db", "$target\tracker-*.db" |
     Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
   ```
2. Open **Task Scheduler** → **Create Basic Task…** → name "MyTV-Time backup" → **Daily**, e.g. 03:30
   → **Start a program**:
   - Program: `powershell.exe`
   - Arguments: `-NoProfile -ExecutionPolicy Bypass -File C:\mytv-time\backup.ps1`
3. Right-click the task → **Run** once, and check a `tracker-….db` file appears in OneDrive.

**Linux — nightly with cron**

Run `crontab -e` and add (adjust paths; `~/OneDrive` = any folder synced by your cloud client):

```cron
30 3 * * * cd $HOME/mytv-time && docker compose exec -T app npm run backup -- /data/backups/ && cp data/backups/tracker-$(date -u +\%F).db $HOME/OneDrive/mytv-time/ && find data/backups -name 'tracker-*.db' -mtime +30 -delete
```

(If you have the `sqlite3` tool installed, `sqlite3 data/tracker.db ".backup backup.db"` does the same
as the backup command.)

## Restoring a backup

```bash
docker compose stop
# Windows: delete data\tracker.db-wal and data\tracker.db-shm if they exist, then
copy "C:\path\to\tracker-2026-11-24.db" data\tracker.db
# Linux:
rm -f data/tracker.db-wal data/tracker.db-shm
cp /path/to/tracker-2026-11-24.db data/tracker.db
docker compose start
```

## Updating

Back up first (step 9), then in the project folder:

```bash
git pull
docker compose up -d --build
```

Your data in `data/` is kept; any database changes needed by the new version are applied
automatically when it starts.

## Troubleshooting

- **Buttons do nothing / "403" / "Cross-site POST form submissions are forbidden"** — you opened the
  app at a different address than `ORIGIN` (e.g. `http://localhost:3000`, or the PC's IP). Use the
  `https://….ts.net` address exactly as written in `.env`. After changing `.env`, run
  `docker compose up -d` to apply it.
- **Search says TMDB isn't configured / no new episodes appear** — check `TMDB_API_KEY` in `.env`,
  then `docker compose up -d`. Look at `docker compose logs app` for `[sync]` lines.
- **The phone can't reach the app** — Tailscale must be connected on the phone; the PC must be on and
  awake; `docker compose ps` must show the app "Up"; `tailscale serve status` must show the proxy to
  `http://127.0.0.1:3000`.
- **"port is already allocated"** on start — something else on the PC uses port 3000. Change the
  first `3000` in `docker-compose.yml` (`"127.0.0.1:3001:3000"`) and run `tailscale serve --bg 3001`.
- **Windows: "database is locked" or "disk I/O error" in the logs** — move the project into the WSL
  Linux filesystem (in the Ubuntu app: `git clone … ~/mytv-time`, copy `data/` and `.env` across,
  and run the `docker compose` commands from there).
- **See what the app is doing:** `docker compose logs -f app` (Ctrl+C to stop watching).
