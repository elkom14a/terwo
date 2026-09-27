#!/bin/bash
# ============================================================
# Terwo — installer satu perintah
#
# Cara pakai (di Termux):
#   curl -sL https://raw.githubusercontent.com/elkom14a/terwo/main/install.sh | bash
#
# Setelah install, panel langsung jalan di background via PM2
# (seperti aaPanel) — tidak perlu terminal tetap terbuka.
# ============================================================
set -e

GITHUB_USER="elkom14a"
REPO_URL="${PANEL_REPO_URL:-https://github.com/${GITHUB_USER}/terwo.git}"
TARGET_DIR="${PANEL_DIR:-$HOME/terwo}"
APP_NAME="terwo"

echo "=== Terwo — installer ==="
echo ""

# 1. Node.js & git
if command -v node >/dev/null 2>&1; then
  echo "[1/5] Node.js sudah ada: $(node -v)"
else
  echo "[1/5] Install Node.js & git..."
  pkg update -y
  pkg install -y nodejs git
fi
if ! command -v git >/dev/null 2>&1; then
  echo "[1/5] Install git..."
  pkg install -y git
fi

# 2. Download / update panel
echo "[2/5] Download panel dari GitHub..."
if [ -d "$TARGET_DIR/.git" ]; then
  echo "      Folder sudah ada, update ke versi terbaru..."
  git -C "$TARGET_DIR" pull --ff-only || true
elif [ -d "$TARGET_DIR" ]; then
  echo "      Folder $TARGET_DIR sudah ada (bukan git repo), pakai yang ada."
else
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

# 3. Dependencies
echo "[3/5] Install dependencies (npm install)..."
cd "$TARGET_DIR"
npm install --no-audit --no-fund

# 4. PM2 (process manager — biar jalan di background)
echo "[4/5] Siapkan PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "      Install PM2..."
  npm install -g pm2
fi

# 5. Jalankan di background + simpan daftar proses
echo "[5/5] Jalankan Terwo di background..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save >/dev/null

echo ""
echo "=== Terwo sudah jalan di background! ==="
echo ""
# Tampilkan box kredensial dari log (hanya muncul saat install pertama)
sleep 2
CREDS=$(pm2 logs "$APP_NAME" --lines 60 --nostream 2>/dev/null | grep -A7 "akses awal" | head -9 || true)
if [ -n "$CREDS" ]; then
  echo "$CREDS"
  echo ""
fi
echo "Buka di browser: http://127.0.0.1:8080"
echo ""
echo "Perintah berguna:"
echo "  pm2 logs terwo     # lihat log panel"
echo "  pm2 restart terwo  # restart panel"
echo "  pm2 stop terwo     # hentikan panel"
echo ""
echo "Agar otomatis jalan tiap HP reboot: install aplikasi Termux:Boot,"
echo "lalu buat file ~/.termux/boot/terwo.sh berisi:"
echo "  #!/data/data/com.termux/files/usr/bin/sh"
echo "  export PATH=\$PATH:/data/data/com.termux/files/usr/bin"
echo "  termux-wake-lock"
echo "  pm2 resurrect"
echo "Jangan lupa: chmod +x ~/.termux/boot/terwo.sh"
