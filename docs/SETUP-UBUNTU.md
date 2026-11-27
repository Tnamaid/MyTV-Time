# MyTV-Time — Ubuntu home server setup

Written 2026-11-25 for Ubuntu Desktop 26.04 LTS. For a server without a desktop, see [SETUP-DEBIAN.md](SETUP-DEBIAN.md).

## Overview

At the end, your old PC runs Ubuntu 26.04 LTS, Docker and Tailscale, and MyTV-Time opens on your phone at a private `https://…ts.net` address, installed like an app. Ubuntu 26.04 gets security updates until April 2031.

What you need:

- A USB stick of **8 GB or more**. It will be erased.
- Another computer to make the USB stick (a Windows PC is fine).
- The old PC plugged into power, ideally with a network cable. Wi-Fi works too.
- Your TMDB **API Key** (the short v3 one).
- A Tailscale account (free) and the Tailscale app on your phone.
- Your two TV Time export folders.

Time: about 2 hours, mostly waiting for downloads and the install.

**Warning:** installing Ubuntu erases everything on the old PC. Copy anything you want to keep first.

Commands in grey boxes go in the **Terminal** app (Ctrl+Alt+T). Paste with **Ctrl+Shift+V**. When `sudo` asks for a password, type your Ubuntu password: nothing shows while you type, which is normal.

## 1. Make the Ubuntu USB stick

Do this on your other computer (Windows here).

1. Download **Ubuntu Desktop 26.04.1 LTS** (64-bit, about 6 GB) from [ubuntu.com/download/desktop](https://ubuntu.com/download/desktop).
2. Download and run **[Rufus](https://rufus.ie)** (or [balenaEtcher](https://etcher.balena.io)).
3. In Rufus: pick your USB stick under *Device*, click *SELECT* and choose the `.iso` you downloaded, leave the rest as is, click *START*. Accept the "ISO image mode" default if it asks.
4. Wait until it says *READY*, then eject the stick.

## 2. Install Ubuntu on the old PC

1. Plug the USB stick into the old PC and turn it on. Straight away, tap the **boot menu key** a few times: usually **F12** (Dell, Lenovo, Acer), **F9** (HP), **F11** (MSI), **F8** or **Esc** (Asus). Pick the USB stick.
   - If the key doesn't work, the old system will start as usual. Open the BIOS (often **F2** or **Del**) and put USB first in the boot order.
2. In the Ubuntu menu, choose **Try or Install Ubuntu**.
3. In the installer:
   - Language and keyboard: your choice (French keyboard if that's what you have).
   - Network: connect to Wi-Fi if there's no cable.
   - **Install Ubuntu** → **Interactive installation** → **Default selection** of apps.
   - Tick **Install third-party software** (drivers for graphics and Wi-Fi).
   - Disk: **Erase disk and install Ubuntu**. This is where the old system is removed. Skip encryption: with it, the PC would wait for a password at every reboot and the app would stay down.
   - Your account: a name, a computer name (for example `homeserver`; this becomes part of your app address) and a password you won't forget. Keep **Require my password to log in**.
   - Time zone: Paris.
4. When it finishes, click **Restart now** and remove the USB stick when asked.
5. Log in, then bring everything up to date:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git curl
```

Then restart once more (top-right menu → Power → Restart).

## 3. Make it an always-on server

A desktop PC goes to sleep by default. A server must not.

1. **Settings → Power**: set *Automatic Suspend* to **Off**, and *Screen Blank* to whatever you like (a blank screen is fine).
2. Block sleep completely, including at the login screen, which otherwise suspends the PC after about 20 minutes:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

3. **Security updates** are installed automatically by Ubuntu (*unattended-upgrades*). Ubuntu 26.04 no longer has the *Software & Updates* window, so check once in the Terminal. This should show both lines ending in `"1"`:

   ```bash
   cat /etc/apt/apt.conf.d/20auto-upgrades
   systemctl is-enabled unattended-upgrades
   ```

   The second command should print `enabled`. If the file is missing, a line shows `"0"`, or it prints `disabled`, run `sudo dpkg-reconfigure -plow unattended-upgrades`, answer **Yes**, and check again.
4. **After a power cut** the PC should turn itself back on. This is a BIOS setting: restart, press **F2** or **Del**, and look under *Power* for **Restore on AC Power Loss** (or *AC Recovery*, *After Power Failure*). Set it to **Power On**. Not every old PC has it.

You don't need to stay logged in. Docker and Tailscale run as system services and start at boot, before anyone logs in.

## 4. Install Docker

Use Docker's own repository, not the `docker.io` package from Ubuntu, so you get current versions and the `docker compose` command.

1. Add Docker's repository:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
```

2. Install it:

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

3. Let your user run Docker without `sudo`, then **log out and back in** (or restart) for it to take effect:

```bash
sudo usermod -aG docker $USER
```

4. Check it works. It should print *Hello from Docker!*:

```bash
docker run --rm hello-world
```

Docker starts by itself at every boot.

## 5. Install Tailscale and get the app's address

Tailscale is a private network between your own devices. The app is only reachable through it, never from the open internet.

1. Create a free account at [tailscale.com](https://tailscale.com). Install the **Tailscale** app on your phone and sign in with the same account.
2. On the old PC, install Tailscale and connect it:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

`tailscale up` prints a link. Open it (in Firefox on the PC, or type it on your phone) and approve the PC.

3. In the [Tailscale admin console → DNS](https://login.tailscale.com/admin/dns), check that **MagicDNS** is on, and click **Enable HTTPS** under *HTTPS Certificates*.
4. Publish the app's port to your tailnet over HTTPS. This keeps working after reboots:

```bash
sudo tailscale serve --bg 3000
```

If it prints a link asking to enable HTTPS, open it, accept, and run the command again. It then prints your app's address, for example:

```
Available within your tailnet:
https://homeserver.tail1234.ts.net/
|-- proxy http://127.0.0.1:3000
```

**Write that address down without the final `/`** (`https://homeserver.tail1234.ts.net`). It goes into the settings file in the next step. Nothing answers on it yet: the app isn't running.

To see it again later: `tailscale serve status`.

## 6. Download and start MyTV-Time

1. Download the app into your home folder:

```bash
cd ~
git clone https://github.com/Tnamaid/MyTV-Time.git mytv-time
cd mytv-time
```

2. Create the settings file from the example and open it in the text editor:

```bash
cp .env.example .env
gnome-text-editor .env
```

Fill in these lines, then save:

| Setting | What to put |
| --- | --- |
| `TMDB_API_KEY=` | Your TMDB **API Key** (the short one) |
| `ORIGIN=` | Your address from step 5, e.g. `https://homeserver.tail1234.ts.net` |
| `TZ=` | Leave `Europe/Paris` |
| `UID=` and `GID=` | Remove the `#` in front of both. Keep `1000`, unless `id -u` and `id -g` in the Terminal print something else |

`.env` holds your key: never share it or commit it to Git (it is already ignored).

3. Create the two folders, then build and start the app. The first start takes a few minutes:

```bash
mkdir -p data gdpr-data
docker compose up -d
```

4. Check it is running:

```bash
docker compose ps          # STATUS: Up
docker compose logs app    # ends with "Listening on http://0.0.0.0:3000"
```

5. In Firefox on the PC, open **your address** (`https://homeserver.…ts.net`), not `localhost:3000`. You should see the empty **Up next** page.

The app restarts by itself after a crash or a reboot, and refreshes air dates of the shows you follow every day.

## 7. Put it on your phone

1. Turn **Tailscale on** in the phone app.
2. Open your address (`https://homeserver.…ts.net`) in the phone's browser.
3. Add it to the home screen:
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** or **Install app**.

It now opens full-screen like an app. It needs Tailscale on and the PC running: there's no offline mode.

## 8. Import your TV Time history

1. Copy your two unzipped TV Time exports onto the old PC (a USB stick is simplest) and put them in `~/mytv-time/gdpr-data`, named exactly:

```
mytv-time/gdpr-data/gdpr-data 1/   <- first export (the folder with the .csv files)
mytv-time/gdpr-data/gdpr-data 2/   <- second export
```

2. **Dry run first.** It reads everything and looks titles up on TMDB, but writes nothing. Expect several minutes:

```bash
cd ~/mytv-time
docker compose exec app npm run import -- --dir1 "/gdpr-data/gdpr-data 1" --dir2 "/gdpr-data/gdpr-data 2" --dry-run
```

It ends with `DRY RUN — nothing was written.`, a table of counts and a sanity check. Expect roughly **237 shows, 9,000 episode watches and 340 movies**; a handful unmatched is normal. If it stops with an error, or the numbers are far off, stop and report the output before going further: the importer was tested on made-up files, so a column name in a real export may differ. [INSTALL.md](INSTALL.md) step 8 explains every line and error.

3. **Real import:** the same command without `--dry-run`. It ends with `Import complete.` Don't use the app while it runs.
4. **Fix what didn't match:** in the app, **Settings → Fix imports**. Pick the right TMDB title for each item, or dismiss it. Your watches are kept either way.

The import is safe to re-run: it skips what's already there and doesn't change shows you've edited in the app.

## 9. Everyday care

**Reboot test (do it once).** Restart the PC and don't log in. After a minute, open the app on your phone. If it loads, the server comes back on its own.

**Backups.** Everything you track lives in one file, `~/mytv-time/data/tracker.db`. Make a safe copy any time, even while the app is in use:

```bash
cd ~/mytv-time && docker compose exec -T app npm run backup -- /data/backups/
```

That writes `data/backups/tracker-YYYY-MM-DD.db`. Copy those files off the PC now and then (USB stick, cloud). For a nightly automatic copy, see *Backups* in [INSTALL.md](INSTALL.md). Settings → *Download export* also gives you everything as one JSON file.

**Updating Ubuntu.** Security updates install themselves. Accept the *Software Updater* prompts when you're at the PC, and restart when it asks.

**Updating the app.** Back up first, then:

```bash
cd ~/mytv-time && git pull && docker compose up -d --build
```

**When something goes wrong:**

| Symptom | Fix |
| --- | --- |
| Buttons do nothing, or "403" | You opened the app at another address than `ORIGIN`. Use the exact `https://…ts.net` address in `.env`. After editing `.env`, run `docker compose up -d`. |
| Phone can't reach the app | Tailscale on, on the phone; PC on; `docker compose ps` shows *Up*; `tailscale serve status` shows the proxy to `http://127.0.0.1:3000`. |
| "permission denied" or "readonly database" in the logs | Run `sudo chown -R "$(id -u):$(id -g)" data`, then `docker compose up -d`. |
| Search says TMDB isn't configured | Check `TMDB_API_KEY` in `.env`, then `docker compose up -d`. |
| `docker: permission denied` | You haven't logged out and back in since step 4.3. |
| Anything else | `docker compose logs -f app` shows what the app is doing (Ctrl+C to stop). |

## Sources

- [Download Ubuntu Desktop](https://ubuntu.com/download/desktop) and [Ubuntu 26.04 LTS release notes](https://documentation.ubuntu.com/release-notes/26.04/) (support until April 2031)
- [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)
