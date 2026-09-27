# Terwo v1.13.0
**Ter**mux **W**eb **O**peration

A lightweight web panel to manage Termux from your browser: **file manager**,
**terminal**, and **system info**. Written from scratch, clean code with no
obfuscation. Dependencies: `ws`, `mysql2`, `pg` (the last two only for the
Database menu).

The UI uses **Tailwind CSS v4** (built output, `public/tailwind.css` is included)
and local **Lucide** icons (`public/vendor/lucide.min.js`) — no CDN, fully
offline. Developers who change the look can rebuild the CSS with:

```bash
npm run build:css
```

(requires the dev dependency `@tailwindcss/cli`; end users never need to run it)

## Install on Termux

**One line:**
```bash
curl -sL https://raw.githubusercontent.com/elkom14a/terwo/main/install.sh | bash
```
The installer automatically: checks Node.js → clones the repo → `npm install` →
installs **PM2** → the panel **starts running in the background right away**
(like aaPanel) → `pm2 save`.
The panel binds to `0.0.0.0` so it is reachable from other PCs/phones on the
same network. No need to keep a terminal open.

**Manual:**
```bash
pkg install nodejs -y
cd terwo
npm install
npm install -g pm2
PANEL_HOST=0.0.0.0 pm2 start panel.js --name terwo
pm2 save
```

Then open in your browser: **http://127.0.0.1:8080** (or the phone's IP from another device)

On first run, the panel generates a random username + password and prints them
to the log (`pm2 logs terwo --nostream | grep -A7 "initial access"`).
Log in with them, then change them immediately via the **Settings** menu.

### Manage the panel (PM2)

```bash
pm2 logs terwo     # view panel logs
pm2 restart terwo  # restart panel
pm2 stop terwo     # stop panel
pm2 list           # check status
```

## Settings (optional, via environment variables)

| Variable     | Default        | Description                                        |
|--------------|----------------|----------------------------------------------------|
| `PANEL_PORT` | `8080`         | Port to use                                        |
| `PANEL_HOST` | `127.0.0.1`    | Bind address (installer overrides to `0.0.0.0`)    |
| `PANEL_ROOT` | `$HOME`        | Top directory the file manager may access          |

Example:

```bash
PANEL_PORT=9000 node panel.js
```

## Features

- **Clean URL slugs** — every page has its own slug: `/login`, `/dashboard`,
  `/website`, `/database`, `/files`, `/cron`, `/backup`, `/settings`,
  `/terminal`, `/store`. No `.html` extensions anywhere (old `.html` URLs
  redirect to the new slugs).
- **Login** — username + password (PBKDF2 hash), HttpOnly session cookie.
- **Dark/light mode** — dark by default, icon-only sun/moon toggle in the
  sidebar header; choice is stored in the browser (terminal is always dark).
  aaPanel-style look: neutral dark surfaces with a green accent.
- **Dashboard** — CPU, RAM, disk, battery (via Termux:API), uptime, website
  status; auto-refreshes every 5 seconds.
- **Settings** — change username/password, Telegram notifications, log out all sessions.
  All destructive actions (logout, delete file/website/proxy/cron job/backup,
  restore backup) ask for confirmation in a styled modal dialog.
- **File manager** — browse folders, upload, download, create folders/files,
  rename, delete, edit text files right in the browser, zip/unzip, image preview.
- **Terminal** — a real terminal emulator (xterm.js, 100% local, no CDN):
  right-click = paste, ⧉ Paste button (mobile-friendly), auto-resize.
  Interactive apps like nano/htop/vim need node-pty (auto-installed if
  compilation succeeds; otherwise the panel keeps working with the legacy
  pipe mode).
- **Website** — mini hosting for Node.js, PHP, Static, and Go projects:
  add websites, start/stop/restart, view logs, open directly from the port number.
  Includes a **Nginx reverse proxy** GUI: add/remove proxy hosts, start/stop/reload nginx.
- **Database** — manage MySQL & PostgreSQL: connect, browse databases/tables,
  run SQL.
- **🏪 Store** — 1-click install: nginx, nodejs, nvm, pm2,
  mysql (mariadb), postgresql, php, bun, redis, python, cronie, golang,
  9router, hermes, cloudflared, zip, unzip, openssh, termux-api, git,
  tmux, composer, sqlite, ffmpeg, yt-dlp, rsync.
- **Cron** — schedule commands automatically (crond), add/remove/enable jobs.
- **Backup** — backup folders (zip) & databases (dump), download, restore, delete.
- **Telegram notifications** — get notified when an install finishes & when a
  website goes down/recovers.
- **Telegram bot commands** — ask the bot: `/help`, `/status`, `/ram`,
  `/cpu`, `/battery`, `/sites`. Only the registered chat ID is served
  (set it in Settings → Telegram, enable "Reply to bot commands").
  Uses `getUpdates` polling every 10 seconds, no webhook.
- **System info** — hostname, uptime, memory, load average.

### Website menu

The **🌐 Website** tab has four sub-tabs:

- **Node.js** — register an entry file (e.g. `web/server.js`); the panel runs
  `node <file>` with the `PORT` environment variable auto-filled with the port
  you specify.
- **PHP** — register a document-root folder (e.g. `web/blog`); the panel runs
  `php -S 127.0.0.1:PORT -t <folder>`. Needs `pkg install php` first on Termux.
- **Static** — register a folder (e.g. `web/dist`), served via
  `python3 -m http.server`. Needs `pkg install python` first.
- **Go** — register a Go project folder (e.g. `goapp`); the panel runs
  `go run .` with the `PORT` env auto-filled. Needs `pkg install golang` first.

Each website can be started/stopped/restarted, its logs viewed live from the
panel, and its port number clicked to open the website directly.

## Database

The **🗄️ Database** menu has two sub-tabs: **MySQL** and **PostgreSQL**.

1. Fill in Host, Port, User, Password, and Database (optional).
2. Click **🔌 Test Connection** to check, then **💾 Save & Connect**.
3. Once connected, pick a database in the left panel to see its tables,
   click a table to see its contents (first 50 rows), or write your own SQL
   and click **▶️ Run**.

Notes:

- Install the database server first via the **🏪 Store** menu.
- **MariaDB**: first time, run `mysql_install_db` once, then `mysqld_safe &`.
  Default user `root` with no password on localhost.
- **PostgreSQL**: first time, `initdb -D $PREFIX/var/lib/postgresql`,
  then `pg_ctl -D $PREFIX/var/lib/postgresql -l logfile start`.
  Default user = your Termux username (see `whoami` output), empty password.

## 🏪 Store

The **🏪 Store** menu shows cards for 26 packages: nginx, nodejs, nvm, pm2,
mysql (mariadb), postgresql, php, bun, redis, python, cronie, golang,
9router, hermes, cloudflared, zip, unzip, openssh, termux-api, git,
tmux, composer, sqlite, ffmpeg, yt-dlp, rsync. Click **Install** and the
installation log streams live in a popup.

Note: the zip/unzip features in the file manager and folder backup need the
`zip`/`unzip` packages — 1-click install them from the Store if missing.

## Termux guide (no systemd)

This panel is designed for Termux: no `systemctl`, every service runs directly
as a process. Consequences:

**Databases are started manually** (once per phone reboot):

```bash
# MariaDB (first time: mysql_install_db)
mysqld_safe &

# PostgreSQL (first time: initdb -D $PREFIX/var/lib/postgresql)
pg_ctl -D $PREFIX/var/lib/postgresql -l logfile start

# Redis
redis-server --daemonize yes
```

**Auto-start the panel on phone reboot** — install the Termux:Boot app, then
create `~/.termux/boot/terwo.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/sh
export PATH=$PATH:/data/data/com.termux/files/usr/bin
termux-wake-lock
pm2 resurrect
```

Don't forget `chmod +x ~/.termux/boot/terwo.sh`.
(The installer already ran `pm2 save`, so `pm2 resurrect` brings the panel
back automatically.)

**Other tips:**

- The battery widget on the Dashboard needs the **Termux:API** app + `pkg install termux-api`.
- To stop Android from killing the panel/websites when the screen is off: run
  `termux-wake-lock`, and disable battery optimization for the Termux app.
- Ports below 1024 cannot be used without root — the panel rejects them automatically.
- The `bun` and `nvm` packages in the Store may fail on Termux
  (no matching official builds); failures show in the log, the panel keeps running.
- The panel already binds to `0.0.0.0` (reachable across the LAN). To lock it
  back to localhost only: `pm2 delete terwo && pm2 start panel.js --name terwo && pm2 save`.

## Security notes — read first

1. **Do not expose this panel directly to the public internet.** The installer
   binds the panel to `0.0.0.0` so it is reachable across the LAN (other
   PCs/phones) — so make sure the password is changed to a strong one, and
   only run it on WiFi you trust. Don't do this on public/busy office WiFi.
2. If you need access from outside, use a safe path: an SSH tunnel
   (`ssh -L 8080:localhost:8080 ...`) or a Cloudflare Tunnel protected by
   Cloudflare Access — not a bare `0.0.0.0` bind.
3. The file manager is restricted to `PANEL_ROOT` (default `$HOME`) — it cannot
   escape that directory.
4. The initial username + password printed in the terminal only appear once.
   If you lose them, delete `~/.termux-panel/config.json` and run again to
   generate new credentials.

## Update from GitHub

Official repo: **https://github.com/elkom14a/terwo**. To update to the latest version:

```bash
cd ~/terwo
git pull --ff-only
npm install --no-audit --no-fund
pm2 restart terwo
```
