# Setting up the old PC as a Debian home server

This takes the old PC from blank (or Fedora) to running MyTV-Time on your tailnet. It ends with
the app open on your phone at `https://<machine>.<tailnet>.ts.net`. After that,
[INSTALL.md](INSTALL.md) takes over from step 7 (home screen, importing TV Time, backups).

What you end up with is Debian 13 "trixie" (the current stable release) with **no desktop**: just a
terminal, managed from your main computer over SSH. That keeps an old machine light, and there's
almost nothing to maintain. Security updates install themselves.

You need:
- a USB stick (1 GB or more; **it gets erased**)
- a network cable for the PC (simplest; Wi-Fi works but is fiddlier without a desktop)
- about 1 hour

> **Installing Debian erases the whole disk of the old PC**, Fedora included. Copy off anything you
> want to keep first.

---

## 1. Make the install USB stick (on your main computer)

1. Download the **netinst** image ("small installation image", `debian-13.x.x-amd64-netinst.iso`)
   from <https://www.debian.org/download>.
2. Write it to the USB stick:
   - Windows: **Rufus** (<https://rufus.ie>). Select the ISO, Start, and accept "DD mode" if asked.
   - macOS / Linux: **balenaEtcher** (<https://etcher.balena.io>).

## 2. Install Debian on the old PC

1. Plug in the USB stick and the network cable, then start the PC and open its boot menu. The key is
   usually **F12**, **F11**, **F8** or **Esc**, and it's shown briefly at power-on. Pick the USB stick.
2. Choose **Graphical install**. Then:
   - **Language / location / keyboard**: whatever suits you (French keyboard = "French").
   - **Hostname**: a plain name such as `homeserver`. This becomes the machine's name on your
     tailnet and in the app's address (`https://homeserver.<tailnet>.ts.net`). It also appears in
     public certificate logs, so don't put anything personal in it.
   - **Domain name**: leave empty.
   - **Root password**: **leave it empty** (press Continue twice). Debian then disables the root
     account and lets your own user run admin commands with `sudo`, which is what this guide assumes.
   - **Your name / username / password**: your normal account, e.g. `tnamaid`. Remember the password.
   - **Partitioning**: "Guided – use entire disk" → pick the disk → "All files in one partition" →
     "Finish partitioning and write changes" → **Yes**.
   - **Package manager**: pick a mirror in your country (e.g. `deb.debian.org`), with no proxy.
   - **Popularity contest**: your choice.
   - **Software selection**: this is the important screen.
     - **Untick** "Debian desktop environment" and "GNOME" (and any other desktop).
     - **Tick** "SSH server" and "standard system utilities".
   - **GRUB boot loader**: Yes, on the disk you installed to.
3. Remove the USB stick when it says the installation is complete. The PC reboots to a black screen
   with a `login:` prompt. That's expected: there's no desktop.

## 3. First login and basic setup

Log in at the PC's screen with your username and password, then:

```bash
# find the PC's local IP address (the "inet" on the line for your network card, e.g. 192.168.1.42)
ip -br a
```

From now on you can work from your main computer instead. Open a terminal there (PowerShell on
Windows) and run:

```bash
ssh tnamaid@192.168.1.42      # your username and the IP from above
```

Then, still in that SSH session:

```bash
# bring everything up to date
sudo apt update && sudo apt full-upgrade -y

# tools used below, plus automatic security updates
sudo apt install -y curl git ca-certificates unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # answer "Yes"
```

**If it's a laptop**, stop it from sleeping when the lid is closed:

```bash
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

**Recommended:** in the PC's BIOS/UEFI setup (usually **F2** or **Del** at power-on), look for a
setting like *"Restore on AC power loss"* / *"After power failure"* and set it to **Power On**.
Then the server comes back by itself after a power cut.

## 4. Install Docker

These are Docker's official steps for Debian, using their apt repository:

```bash
# Docker's signing key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Docker's package repository (picks up "trixie" automatically)
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# let your user run docker without sudo
sudo usermod -aG docker $USER
```

**Log out and back in** (type `exit`, then `ssh …` again) so the group change applies. Then check:

```bash
docker run --rm hello-world       # prints "Hello from Docker!"
docker compose version            # prints a version number
```

Docker starts automatically at boot, so there's nothing else to enable.

## 5. Install Tailscale and connect the PC

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

`tailscale up` prints a login link. Open it on any device, sign in to your Tailscale account
(create one at <https://tailscale.com> if needed, it's free for personal use), and approve the
machine.

Then, in the admin console:

1. **Machines** (<https://login.tailscale.com/admin/machines>): click the `…` next to the server and
   choose **Disable key expiry**. Otherwise the server drops off your tailnet every few months until
   you log it in again.
2. **DNS** (<https://login.tailscale.com/admin/dns>): make sure **MagicDNS** is on, and under
   **HTTPS Certificates** click **Enable HTTPS**. (Both are usually already on for new accounts.)

Also install Tailscale on your **phone** (App Store / Play Store) and on your **main computer**,
signed in with the same account.

> From now on you can SSH to the server from anywhere, using its tailnet name instead of the local IP:
> `ssh tnamaid@homeserver`

Find the app's future address:

```bash
tailscale status --json | grep -m1 DNSName
# → "DNSName": "homeserver.tail1234.ts.net."   → the address is https://homeserver.tail1234.ts.net
```

## 6. Download MyTV-Time and configure it

```bash
cd ~
git clone https://github.com/Tnamaid/MyTV-Time.git mytv-time
cd mytv-time
mkdir -p data gdpr-data
cp .env.example .env
nano .env
```

In `nano`, fill in:

```ini
TMDB_API_KEY=your-short-v3-api-key
ORIGIN=https://homeserver.tail1234.ts.net     # your address from step 5, no trailing slash
TZ=Europe/Paris
UID=1000                                       # the output of: id -u
GID=1000                                       # the output of: id -g
```

(Remove the `#` in front of `UID`/`GID`. Save with **Ctrl+O**, Enter, then quit with **Ctrl+X**.
The first user created on Debian is almost always 1000/1000, but check with `id -u` and `id -g`.)

## 7. Start the app

```bash
docker compose up -d --build
```

The first build takes a few minutes on an old PC. Then check it:

```bash
docker compose ps                                  # "app" should be "running" / "Up"
curl -s localhost:3000/ | grep -c "Up next"        # prints 1 (or more)
docker compose logs -f app                         # live logs; Ctrl+C to stop watching
```

It restarts automatically after a reboot or crash (`restart: unless-stopped`).

## 8. Publish it on your tailnet with HTTPS

```bash
sudo tailscale serve --bg 3000
```

It prints something like:

```
Available within your tailnet:
https://homeserver.tail1234.ts.net/
|-- proxy http://127.0.0.1:3000
```

If it prints a link asking you to enable HTTPS or Serve instead, open it, accept, and run the command
again. `--bg` makes it permanent: it survives reboots. You can check it any time with
`tailscale serve status`, and undo it with `sudo tailscale serve reset`.

Now, on your phone (with Tailscale connected), open **`https://homeserver.tail1234.ts.net`**.
You should see **Up next**. 🎉

> Always use that exact address. The address must match `ORIGIN` in `.env`, or buttons answer
> "403 Forbidden". That includes `http://localhost:3000` and the local IP: they won't work for buttons.

## 9. Next steps (in INSTALL.md)

- [7. Add it to your phone's home screen](INSTALL.md#7-add-it-to-your-phones-home-screen)
- [8. Import your TV Time history](INSTALL.md#8-import-your-tv-time-history). First copy your two
  export folders into `~/mytv-time/gdpr-data/` on the server. From a Windows computer on the
  tailnet, for example:
  ```powershell
  scp -r "C:\path\to\gdpr-data\gdpr-data 1" "C:\path\to\gdpr-data\gdpr-data 2" tnamaid@homeserver:~/mytv-time/gdpr-data/
  ```
- [9. Backups](INSTALL.md#9-backups)

## Everyday commands (cheat sheet)

| What | Command (in `~/mytv-time`) |
|---|---|
| Is it running? | `docker compose ps` |
| See the logs | `docker compose logs --tail 100 app` |
| Restart the app | `docker compose restart app` |
| Update MyTV-Time | `git pull && docker compose up -d --build` |
| Update Debian (security updates already run automatically) | `sudo apt update && sudo apt full-upgrade -y` |
| Reboot the server | `sudo reboot` |
| Shut it down | `sudo poweroff` |
