# Terwo v1.9.0
**Ter**mux **W**eb **O**peration

Panel web ringan untuk mengelola Termux dari browser: **file manager**, **terminal**,
dan **info sistem**. Ditulis dari nol, kode bersih tanpa obfuscation. Dependency: `ws`,
`mysql2`, `pg` (dua terakhir hanya untuk menu Database).

UI memakai **Tailwind CSS v4** (hasil build, file `public/tailwind.css` sudah disertakan)
dan ikon **Lucide** lokal (`public/vendor/lucide.min.js`) — tidak ada CDN, tetap offline.
Developer yang mengubah tampilan bisa build ulang CSS dengan:

```bash
npm run build:css
```

(membutuhkan dev dependency `@tailwindcss/cli`; user akhir tidak perlu menjalankannya)

## Cara pasang di Termux

**Satu perintah (perlu repo GitHub dulu, lihat bawah):**
```bash
curl -sL https://raw.githubusercontent.com/GITHUB_USER/terwo/main/install.sh | bash
```

**Manual:**
```bash
pkg install nodejs -y
cd terwo
npm install
node panel.js
```

Lalu buka di browser: **http://127.0.0.1:8080**

Saat pertama dijalankan, panel membuat username + password acak dan
menampilkannya di terminal (gaya aaPanel). Login dengan keduanya, lalu
segera ganti lewat menu **Settings**.

## Pengaturan (opsional, via environment variable)

| Variable     | Default        | Keterangan                                              |
|--------------|----------------|----------------------------------------------------------|
| `PANEL_PORT` | `8080`         | Port yang dipakai                                         |
| `PANEL_HOST` | `127.0.0.1`    | Bind address. Default hanya localhost (paling aman)       |
| `PANEL_ROOT` | `$HOME`        | Direktori paling atas yang boleh diakses file manager     |

Contoh:

```bash
PANEL_PORT=9000 node panel.js
```

## Fitur

- **Login** — username + password (hash PBKDF2), session cookie HttpOnly.
- **Mode gelap/terang** — default gelap, toggle sun/moon di sidebar/topbar;
  pilihan tersimpan di browser (terminal selalu gelap).
- **Dashboard** — CPU, RAM, disk, baterai (via Termux:API), uptime, status website; auto-refresh 5 detik.
- **Settings** — ganti username/password, notifikasi Telegram, logout semua sesi.
- **File manager** — jelajahi folder, upload, download, buat folder/file,
  rename, hapus, edit file teks langsung di browser, zip/unzip, preview gambar.
- **Terminal** — emulator terminal beneran (xterm.js, 100% lokal tanpa CDN):
  klik kanan = paste, tombol ⧉ Paste (ramah HP), resize otomatis.
  Aplikasi interaktif seperti nano/htop/vim butuh node-pty (terinstall
  otomatis bila kompilasi berhasil; bila tidak, panel tetap jalan dengan
  mode pipe lama).
- **Website** — hosting mini untuk project Node.js, PHP, Static, dan Go:
  tambah website, start/stop/restart, lihat log, buka langsung dari nomor port.
  Termasuk **reverse proxy Nginx** (GUI): tambah/hapus proxy host, start/stop/reload nginx.
- **Database** — kelola MySQL & PostgreSQL: konek, browse database/tabel,
  jalankan SQL.
- **🏪 Store** — install 1-klik: nginx, nodejs, nvm, pm2,
  mysql (mariadb), postgresql, php, bun, redis, python, cronie, golang,
  9router, hermes, cloudflared, zip, unzip.
- **Cron** — jadwalkan perintah otomatis (crond), tambah/hapus/aktifkan job.
- **Backup** — backup folder (zip) & database (dump), download, restore, hapus.
- **Notifikasi Telegram** — kabari saat install selesai & website down/pulih.
- **Perintah bot Telegram** — bot bisa ditanya: `/help`, `/status`, `/ram`,
  `/cpu`, `/battery`, `/sites`. Hanya chat ID yang terdaftar yang dilayani
  (atur di Settings → Telegram, aktifkan "Balas perintah bot").
  Pakai polling `getUpdates` tiap 10 detik, tanpa webhook.
- **Info sistem** — hostname, uptime, memori, load average.
- **Ganti password** — dari tombol header atau menu Settings.

### Menu Website

Tab **🌐 Website** punya empat sub-tab:

- **Node.js** — daftarkan file entry (mis. `web/server.js`), panel menjalankan
  `node <file>` dengan environment variable `PORT` otomatis diisi nomor port
  yang kamu tentukan.
- **PHP** — daftarkan folder document root (mis. `web/blog`), panel menjalankan
  `php -S 127.0.0.1:PORT -t <folder>`. Butuh `pkg install php` dulu di Termux.
- **Static** — daftarkan folder (mis. `web/dist`), diserve via
  `python3 -m http.server`. Butuh `pkg install python` dulu.
- **Go** — daftarkan folder project Go (mis. `goapp`), panel menjalankan
  `go run .` dengan env `PORT` otomatis diisi. Butuh `pkg install golang` dulu.

Setiap website bisa di-start/stop/restart, log-nya bisa dilihat live dari
panel, dan nomor port-nya bisa diklik untuk langsung membuka websitenya.

## Database

Menu **🗄️ Database** punya dua sub-tab: **MySQL** dan **PostgreSQL**.

1. Isi Host, Port, User, Password, dan Database (opsional).
2. Klik **🔌 Test Koneksi** untuk cek koneksi, lalu **💾 Simpan & Konek**.
3. Setelah terkoneksi, pilih database di panel kiri untuk melihat tabelnya,
   klik tabel untuk melihat isinya (50 baris pertama), atau tulis SQL sendiri
   lalu klik **▶️ Jalankan**.
Catatan:

- Install dulu server databasenya lewat menu **🏪 Store**.
- **MariaDB**: pertama kali jalankan `mysql_install_db` sekali, lalu
  `mysqld_safe &`. Default user `root` tanpa password di localhost.
- **PostgreSQL**: pertama kali `initdb -D $PREFIX/var/lib/postgresql`,
  lalu `pg_ctl -D $PREFIX/var/lib/postgresql -l logfile start`.
  User default = nama user Termux (lihat hasil `whoami`), password kosong.

## 🏪 Store

Menu **🏪 Store** menampilkan kartu 26 paket: nginx, nodejs, nvm, pm2,
mysql (mariadb), postgresql, php, bun, redis, python, cronie, golang,
9router, hermes, cloudflared, zip, unzip, openssh, termux-api, git,
tmux, composer, sqlite, ffmpeg, yt-dlp, rsync. Klik **Install** dan
log instalasi tampil live di popup.

Catatan: fitur zip/unzip di file manager dan backup folder membutuhkan
paket `zip`/`unzip` — install 1-klik dari Store bila belum ada.
## Panduan Termux (tanpa systemd)

Panel ini memang dirancang untuk Termux: tidak ada `systemctl`, semua servis
dijalankan langsung sebagai proses. Konsekuensinya:

**Database dinyalakan manual** (sekali saja tiap HP reboot):

```bash
# MariaDB (pertama kali: mysql_install_db)
mysqld_safe &

# PostgreSQL (pertama kali: initdb -D $PREFIX/var/lib/postgresql)
pg_ctl -D $PREFIX/var/lib/postgresql -l logfile start

# Redis
redis-server --daemonize yes
```

**Panel auto-start saat HP reboot** — install aplikasi Termux:Boot, lalu buat
file `~/.termux/boot/start-panel.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/terwo
node panel.js
```

Jangan lupa `chmod +x ~/.termux/boot/start-panel.sh`.

**Tips lain:**

- Widget baterai di Dashboard butuh aplikasi **Termux:API** + `pkg install termux-api`.
- Agar Android tidak mematikan panel/website saat layar mati: jalankan
  `termux-wake-lock`, dan matikan battery optimization untuk aplikasi Termux.
- Port di bawah 1024 tidak bisa dipakai tanpa root — panel menolaknya otomatis.
- Paket `bun` dan `nvm` di Store kemungkinan gagal di Termux
  (tidak ada build resmi yang cocok); kegagalannya tampil di log, panel tetap jalan.
- Mau akses panel dari HP/laptop lain dalam satu WiFi?
  `PANEL_HOST=0.0.0.0 node panel.js` — tapi pastikan password sudah diganti
  yang kuat, dan jangan lakukan ini di WiFi publik.

## Catatan keamanan — baca dulu

1. **Jangan expose panel ini langsung ke internet publik.** Default-nya hanya
   bisa diakses dari perangkat itu sendiri (`127.0.0.1`), dan itu disengaja.
2. Kalau butuh akses dari luar, pakai jalur yang aman: SSH tunnel
   (`ssh -L 8080:localhost:8080 ...`) atau Cloudflare Tunnel yang diproteksi
   Cloudflare Access — jangan bind `0.0.0.0` polos.
3. File manager dibatasi di dalam `PANEL_ROOT` (default `$HOME`) — tidak bisa
   keluar dari direktori itu.
4. Username + password awal yang tercetak di terminal hanya muncul sekali. Kalau hilang,
   hapus file `~/.termux-panel/config.json` lalu jalankan ulang untuk membuat
   kredensial baru.

## Pasang repo ke GitHub (untuk one-liner install)

One-liner `curl ... | bash` di atas butuh `install.sh` yang ter-host di GitHub.
Langkahnya sekali saja:

```bash
# 1. Bikin repo public baru di github.com/new, namanya: terwo
# 2. Di Termux (dari folder hasil extract ZIP ini):
nano install.sh   # ganti GITHUB_USER="GANTI-USERNAME" dengan username GitHub kamu
git init
git add .
git commit -m "v1.9.0"
git branch -M main
git remote add origin https://github.com/USERNAME-KAMU/terwo.git
git push -u origin main
```

Setelah itu one-liner-nya aktif:
```bash
curl -sL https://raw.githubusercontent.com/USERNAME-KAMU/terwo/main/install.sh | bash
```
