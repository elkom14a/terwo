#!/bin/bash
# ============================================================
# Terwo — one-line installer
#
# Usage (in Termux):
#   curl -sL https://raw.githubusercontent.com/elkom14a/terwo/main/install.sh | bash
#
# After install, the panel runs in the background via PM2
# (like aaPanel) — no need to keep a terminal open.
# The panel binds to 0.0.0.0: reachable from other PCs/phones
# on the same network.
# Make sure to set a strong password & only use it on trusted WiFi.
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
  echo "[1/5] Node.js already installed: $(node -v)"
else
  echo "[1/5] Installing Node.js & git..."
  pkg update -y
  pkg install -y nodejs git
fi
if ! command -v git >/dev/null 2>&1; then
  echo "[1/5] Installing git..."
  pkg install -y git
fi

# 2. Download / update panel
echo "[2/5] Downloading panel from GitHub..."
if [ -d "$TARGET_DIR/.git" ]; then
  echo "      Folder exists, updating to latest version..."
  git -C "$TARGET_DIR" pull --ff-only || true
elif [ -d "$TARGET_DIR" ]; then
  echo "      Folder $TARGET_DIR exists (not a git repo), using it as-is."
else
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

# 3. Dependencies
echo "[3/5] Installing dependencies (npm install)..."
cd "$TARGET_DIR"
npm install --no-audit --no-fund

# 4. PM2 (process manager — keeps it running in background)
echo "[4/5] Setting up PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "      Installing PM2..."
  npm install -g pm2
fi

# 5. Run in background + save process list
#     (PANEL_HOST=0.0.0.0 = reachable from other PCs/phones on the LAN)
echo "[5/5] Starting Terwo in background..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
PANEL_HOST=0.0.0.0 pm2 start panel.js --name "$APP_NAME"
pm2 save >/dev/null

echo ""
echo "=== Terwo is now running in the background! ==="
echo ""
# Show the credential box from logs (only appears on first install)
sleep 2
CREDS=$(pm2 logs "$APP_NAME" --lines 60 --nostream 2>/dev/null | grep -A7 "initial access" | head -9 || true)
if [ -n "$CREDS" ]; then
  echo "$CREDS"
  echo ""
fi
echo "Open on this phone  : http://127.0.0.1:8080"
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p')
[ -n "$LAN_IP" ] && echo "Open from other PCs : http://$LAN_IP:8080"
echo ""
echo "Useful commands:"
echo "  pm2 logs terwo     # view panel logs"
echo "  pm2 restart terwo  # restart panel"
echo "  pm2 stop terwo     # stop panel"
echo ""
echo "To auto-start on every phone reboot: install the Termux:Boot app,"
echo "then create ~/.termux/boot/terwo.sh containing:"
echo "  #!/data/data/com.termux/files/usr/bin/sh"
echo "  export PATH=\$PATH:/data/data/com.termux/files/usr/bin"
echo "  termux-wake-lock"
echo "  pm2 resurrect"
echo "Don't forget: chmod +x ~/.termux/boot/terwo.sh"
