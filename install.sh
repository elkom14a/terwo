#!/bin/bash
# ============================================================
# Terwo — installer satu perintah
#
# Cara pakai (di Termux):
#   curl -sL https://raw.githubusercontent.com/GITHUB_USER/terwo/main/install.sh | bash
#
# Ganti GITHUB_USER di bawah dengan username GitHub kamu
# sebelum push repo ini ke GitHub.
# ============================================================
set -e

GITHUB_USER="elkom14a"
REPO_URL="${PANEL_REPO_URL:-https://github.com/${GITHUB_USER}/terwo.git}"
TARGET_DIR="${PANEL_DIR:-$HOME/terwo}"

echo "=== Terwo — installer ==="
echo ""

# 1. Node.js & git
if command -v node >/dev/null 2>&1; then
  echo "[1/4] Node.js sudah ada: $(node -v)"
else
  echo "[1/4] Install Node.js & git..."
  pkg update -y
  pkg install -y nodejs git
fi
if ! command -v git >/dev/null 2>&1; then
  echo "[1/4] Install git..."
  pkg install -y git
fi

# 2. Download panel
echo "[2/4] Download panel dari GitHub..."
if [ -d "$TARGET_DIR/.git" ]; then
  echo "      Folder sudah ada, update ke versi terbaru..."
  git -C "$TARGET_DIR" pull --ff-only || true
elif [ -d "$TARGET_DIR" ]; then
  echo "      Folder $TARGET_DIR sudah ada (bukan git repo), pakai yang ada."
else
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

# 3. Dependencies
echo "[3/4] Install dependencies (npm install)..."
cd "$TARGET_DIR"
npm install --no-audit --no-fund

# 4. Selesai
echo ""
echo "[4/4] Selesai!"
echo ""
echo "Jalankan panel dengan:"
echo "  cd $TARGET_DIR && node panel.js"
echo ""
echo "Lalu buka di browser: http://127.0.0.1:8080"
echo "(Username & password acak muncul di terminal saat pertama dijalankan)"
