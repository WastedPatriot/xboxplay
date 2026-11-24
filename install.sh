#!/usr/bin/env bash
# XboxPlay installer. Safe to run again: it refreshes the same files and will not add a second menu entry or panel launcher.
# From a checkout:  ./install.sh
# From the web:     curl -fsSL https://raw.githubusercontent.com/WastedPatriot/xboxplay/main/install.sh | bash
set -euo pipefail
CDPATH=

REPO="${XBOXPLAY_REPO:-https://github.com/WastedPatriot/xboxplay.git}"
BRANCH="${XBOXPLAY_BRANCH:-main}"
BIN="$HOME/.local/bin/xboxplay"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP="$DESKTOP_DIR/XboxPlay.desktop"
STAMP_DIR="$HOME/.local/share/xboxplay"
ICON_SIZES="16 32 48 64 128 256 512"
MATE_ID="xboxplay"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }

# First quoted token in a dconf string list, e.g. ['top', 'bottom'] -> top
first_id() {
  local raw="$1" body first
  body="${raw#@as }"
  body="${body#[}"
  body="${body%]}"
  first="${body%%,*}"
  first="${first//[[:space:]]/}"
  first="${first//\'/}"
  printf '%s' "$first"
}

# True when 'id' is its own quoted entry, not a prefix of another id.
list_has_id() {
  local cur="$1" id="$2"
  case "$cur" in
    *"'$id']"*|*"'$id',"*|*"'$id' ,"*) return 0 ;;
    *) return 1 ;;
  esac
}

append_id() {
  local cur="$1" id="$2" body
  body="${cur#@as }"
  if [ -z "$body" ] || [ "$body" = "[]" ]; then
    printf "['%s']" "$id"
    return
  fi
  body="${body%]}"
  printf "%s, '%s']" "$body" "$id"
}

# Only used when a command is actually missing. The install itself stays in the home directory.
pm_install() {
  if command -v apt-get >/dev/null 2>&1; then
    say "Missing $*. Installing them with apt needs sudo."
    sudo apt-get update -y
    sudo apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    say "Missing $*. Installing them with dnf needs sudo."
    sudo dnf install -y "$@"
  elif command -v pacman >/dev/null 2>&1; then
    say "Missing $*. Installing them with pacman needs sudo."
    sudo pacman -Sy --needed --noconfirm "$@"
  elif command -v zypper >/dev/null 2>&1; then
    say "Missing $*. Installing them with zypper needs sudo."
    sudo zypper --non-interactive install "$@"
  else
    warn "Missing $*. This script knows apt, dnf, pacman, and zypper. Install them yourself, then run it again."
    exit 1
  fi
}

need_cmd() {
  local missing=()
  if [ "${1:-}" = "clone" ]; then
    command -v git >/dev/null 2>&1 || missing+=(git)
    command -v curl >/dev/null 2>&1 || missing+=(curl)
  fi
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    missing+=(nodejs npm)
  elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
    missing+=(nodejs npm)
  fi
  if [ "${#missing[@]}" -gt 0 ]; then
    pm_install "${missing[@]}"
  fi
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 18 ] && [ "$major" -lt 22 ]; then
      warn "Node $major is older than 22. Electron 45 expects Node 22. If npm ci fails, install Node 22 and run this again."
    fi
  fi
}

write_launcher() {
  local flags="$1"
  mkdir -p "$(dirname "$BIN")"
  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail'
    printf 'APP=%q\n' "$APP"
    printf 'SANDBOX_FLAG=%q\n' "$flags"
    cat <<'EOF'
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --controller)
      if [ $# -lt 2 ]; then
        echo "xboxplay: --controller needs auto, wired, bluetooth, or keyboard" >&2
        exit 2
      fi
      case "$2" in
        auto|wired|usb|bluetooth|bt|keyboard|keys) export XBOXPLAY_CONTROLLER="$2" ;;
        *) echo "xboxplay: unknown controller '$2'" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --controller=*)
      export XBOXPLAY_CONTROLLER="${1#--controller=}"
      shift
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done
export CHROME_DESKTOP="${CHROME_DESKTOP:-XboxPlay.desktop}"
if [ -n "$SANDBOX_FLAG" ]; then
  exec "$APP/node_modules/electron/dist/electron" "$APP" "$SANDBOX_FLAG" "${args[@]}"
fi
exec "$APP/node_modules/electron/dist/electron" "$APP" "${args[@]}"
EOF
  } > "$BIN"
  chmod +x "$BIN"
}

install_icons() {
  local size from dir
  for size in $ICON_SIZES; do
    from=""
    if [ -f "$APP/assets/icons/${size}x${size}.png" ]; then
      from="$APP/assets/icons/${size}x${size}.png"
    elif [ "$size" = "256" ] && [ -f "$APP/assets/icon.png" ]; then
      from="$APP/assets/icon.png"
    fi
    if [ -n "$from" ]; then
      dir="$HOME/.local/share/icons/hicolor/${size}x${size}/apps"
      mkdir -p "$dir"
      cp "$from" "$dir/xboxplay.png"
    fi
  done
}

write_desktop() {
  mkdir -p "$DESKTOP_DIR"
  install_icons
  local icon_line=""
  if [ -f "$HOME/.local/share/icons/hicolor/256x256/apps/xboxplay.png" ]; then
    icon_line="Icon=xboxplay"
  else
    warn "assets/icon.png is missing, so the menu entry has no icon."
  fi
  {
    printf '%s\n' '[Desktop Entry]' 'Version=1.0' 'Type=Application' 'Name=XboxPlay'
    printf '%s\n' 'GenericName=Xbox remote play' 'Comment=Xbox remote play and cloud gaming'
    printf '%s\n' 'Keywords=xbox;cloud;gaming;remote;play;' "Exec=$BIN"
    if [ -n "$icon_line" ]; then printf '%s\n' "$icon_line"; fi
    printf '%s\n' 'Terminal=false' 'Categories=Game;' 'StartupWMClass=XboxPlay' 'StartupNotify=true'
  } > "$DESKTOP"
  rm -f "$DESKTOP_DIR/xboxplay.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  fi
  local legacy="$HOME/.config/mate/panel2.d/default/launchers"
  if [ -d "$legacy" ]; then
    cp "$DESKTOP" "$legacy/XboxPlay.desktop"
    rm -f "$legacy/xboxplay.desktop"
  fi
}

add_mate_launcher() {
  if ! command -v dconf >/dev/null 2>&1; then
    say "dconf is not installed, so no MATE panel launcher was added. The app menu entry is still there."
    return 0
  fi
  local tops top cur next
  tops="$(dconf read /org/mate/panel/general/toplevel-id-list 2>/dev/null || true)"
  top="$(first_id "$tops")"
  if [ -z "$top" ]; then
    say "No MATE panel found, so nothing was pinned. You can pin XboxPlay from the app menu."
    return 0
  fi
  case "$top" in
    *[!A-Za-z0-9_-]*)
      say "Unexpected MATE panel id, skipping the panel launcher."
      return 0
      ;;
  esac
  dconf write "/org/mate/panel/objects/$MATE_ID/object-type" "'launcher'"
  dconf write "/org/mate/panel/objects/$MATE_ID/launcher-location" "'XboxPlay.desktop'"
  dconf write "/org/mate/panel/objects/$MATE_ID/toplevel-id" "'$top'"
  dconf write "/org/mate/panel/objects/$MATE_ID/position" "100"
  dconf write "/org/mate/panel/objects/$MATE_ID/panel-right-stick" "false"
  dconf write "/org/mate/panel/objects/$MATE_ID/locked" "false"
  cur="$(dconf read /org/mate/panel/general/object-id-list 2>/dev/null || true)"
  if list_has_id "$cur" "$MATE_ID"; then
    say "MATE panel launcher is already there."
    return 0
  fi
  next="$(append_id "$cur" "$MATE_ID")"
  dconf write /org/mate/panel/general/object-id-list "$next"
  say "Added XboxPlay to the MATE panel."
}

IN_PLACE=""
SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SRC" ] && [ -f "$SRC" ]; then
  SRC_DIR="$(cd -- "$(dirname "$SRC")" && pwd)"
  if [ -f "$SRC_DIR/package.json" ] && [ -f "$SRC_DIR/src/main.js" ]; then
    IN_PLACE=1
    APP="$SRC_DIR"
  fi
fi

if [ -n "$IN_PLACE" ]; then
  say "Installing from $APP"
  need_cmd local
else
  APP="${XBOXPLAY_HOME:-$HOME/xboxplay}"
  need_cmd clone
  if [ -d "$APP" ] && [ ! -d "$APP/.git" ]; then
    backup="$APP.old-$(date +%Y%m%d%H%M%S)"
    say "Moving old install to $backup"
    mv "$APP" "$backup"
  fi
  if [ -d "$APP/.git" ]; then
    say "Updating $APP ($BRANCH)"
    git -C "$APP" fetch --depth 1 origin "$BRANCH"
    git -C "$APP" checkout -q -B "$BRANCH" FETCH_HEAD
  else
    say "Downloading XboxPlay ($BRANCH)"
    git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP"
  fi
fi

cd "$APP"
say "Installing Electron (pinned, from package-lock.json)"
npm ci --no-fund --no-audit
# Some npm setups skip install scripts, which leaves Electron without its binary.
if [ ! -x node_modules/electron/dist/electron ]; then
  node node_modules/electron/install.js
fi

flags="--no-sandbox"
sb="$APP/node_modules/electron/dist/chrome-sandbox"
if [ -f "$sb" ]; then
  say "Chromium's sandbox helper has to be owned by root. This needs sudo. If it fails, XboxPlay runs with --no-sandbox."
  if sudo chown root:root "$sb" && sudo chmod 4755 "$sb"; then
    flags=""
  else
    say "Could not set up the sandbox. Using --no-sandbox."
  fi
fi

write_launcher "$flags"
write_desktop
if ! add_mate_launcher; then
  warn "Could not add a MATE panel launcher. The app menu entry is still there."
fi

mkdir -p "$STAMP_DIR"
printf '%s\n' "$APP" > "$STAMP_DIR/install-dir"

say "Installed. Start it from your app menu, or run: xboxplay"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) say "Add ~/.local/bin to your PATH to use the xboxplay command" ;;
esac
if ! id -nG "${USER:-$(id -un)}" 2>/dev/null | tr ' ' '\n' | grep -qx input; then
  warn "Your user is not in the input group, so a wired controller may not show up."
  warn "That needs sudo, then a logout: sudo usermod -aG input ${USER:-$(id -un)}"
fi

if [ "${XBOXPLAY_NO_LAUNCH:-0}" != 1 ]; then
  nohup "$BIN" >/dev/null 2>&1 &
  disown || true
fi
