#!/usr/bin/env bash
# XboxPlay installer. Re-run to update.
#   curl -fsSL https://raw.githubusercontent.com/WastedPatriot/xboxplay/main/install.sh | bash
set -euo pipefail

REPO="${XBOXPLAY_REPO:-https://github.com/WastedPatriot/xboxplay.git}"
BRANCH="${XBOXPLAY_BRANCH:-main}"
APP="$HOME/xboxplay"
BIN="$HOME/.local/bin/xboxplay"
DESKTOP="$HOME/.local/share/applications/xboxplay.desktop"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }

need=()
command -v git >/dev/null || need+=(git)
command -v curl >/dev/null || need+=(curl)
if ! command -v node >/dev/null || ! command -v npm >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  need+=(nodejs npm)
fi
if [ ${#need[@]} -gt 0 ]; then
  say "Installing ${need[*]} (needs sudo)"
  sudo apt-get update -y && sudo apt-get install -y "${need[@]}"
fi

# Older versions of XboxPlay were not a git checkout; keep them aside.
if [ -d "$APP" ] && [ ! -d "$APP/.git" ]; then
  backup="$APP.old-$(date +%Y%m%d%H%M%S)"
  say "Moving old install to $backup"
  mv "$APP" "$backup"
fi

if [ -d "$APP/.git" ]; then
  say "Updating $APP"
  git -C "$APP" fetch --depth 1 origin "$BRANCH"
  git -C "$APP" checkout -q -B "$BRANCH" FETCH_HEAD
else
  say "Downloading XboxPlay"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi

cd "$APP"
say "Installing Electron (pinned, from package-lock.json)"
npm ci --no-fund --no-audit
# Some npm setups skip install scripts, which leaves Electron without its binary.
[ -x node_modules/electron/dist/electron ] || node node_modules/electron/install.js

# Chromium's sandbox needs chrome-sandbox to be root-owned and setuid. Fall back to --no-sandbox if that fails.
flags="--no-sandbox"
sb="$APP/node_modules/electron/dist/chrome-sandbox"
if [ -f "$sb" ] && sudo chown root:root "$sb" && sudo chmod 4755 "$sb"; then
  flags=""
else
  say "Could not set up the Chromium sandbox, running with --no-sandbox"
fi

mkdir -p "$(dirname "$BIN")" "$(dirname "$DESKTOP")"
cat > "$BIN" <<LAUNCHER
#!/usr/bin/env bash
exec "$APP/node_modules/electron/dist/electron" "$APP" $flags "\$@"
LAUNCHER
chmod +x "$BIN"

cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Name=XboxPlay
Comment=Xbox remote play and cloud gaming with keyboard and mouse
Exec=$BIN
Icon=$APP/assets/icon.png
Terminal=false
Categories=Game;
StartupWMClass=XboxPlay
ENTRY
if command -v update-desktop-database >/dev/null; then update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true; fi

say "Installed. Start it from your app menu or run: xboxplay"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "Note: add ~/.local/bin to your PATH to use the xboxplay command";; esac
if [ "${XBOXPLAY_NO_LAUNCH:-0}" != 1 ]; then
  nohup "$BIN" >/dev/null 2>&1 &
  disown
fi
