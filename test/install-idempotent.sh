#!/usr/bin/env bash
# Runs install.sh twice against a fake checkout and a fake HOME, then uninstalls twice.
set -euo pipefail
CDPATH=

ROOT="$(cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

home="$tmp/home"
repo="$tmp/repo"
bin="$tmp/bin"
dconf_dir="$tmp/dconf"
mkdir -p "$home" "$repo/src" "$repo/assets" "$bin" "$dconf_dir/org/mate/panel/general"

cp "$ROOT/install.sh" "$ROOT/uninstall.sh" "$ROOT/package.json" "$repo/"
cp "$ROOT/assets/icon.png" "$repo/assets/icon.png"
printf '%s\n' 'ok' > "$repo/src/main.js"
printf '%s\n' "['top']" > "$dconf_dir/org/mate/panel/general/toplevel-id-list"
printf '%s\n' "['menu-bar']" > "$dconf_dir/org/mate/panel/general/object-id-list"

cat > "$bin/node" <<'EOF'
#!/bin/bash
if [ "$1" = "-p" ]; then
  echo 22
  exit 0
fi
exit 0
EOF
cat > "$bin/npm" <<'EOF'
#!/bin/bash
exit 0
EOF
cat > "$bin/git" <<'EOF'
#!/bin/bash
echo "git should not run during an in-place install" >&2
exit 1
EOF
cat > "$bin/sudo" <<'EOF'
#!/bin/bash
echo "sudo $*" >> "${SUDO_LOG:?}"
exit 1
EOF
cat > "$bin/dconf" <<'EOF'
#!/bin/bash
store="${DCONF_DIR:?}"
cmd="$1"
shift
if [ "$cmd" = "read" ]; then
  f="$store$1"
  if [ -f "$f" ]; then
    cat "$f"
    exit 0
  fi
  exit 1
fi
if [ "$cmd" = "write" ]; then
  f="$store$1"
  mkdir -p "$(dirname "$f")"
  printf '%s\n' "$2" > "$f"
  exit 0
fi
if [ "$cmd" = "reset" ]; then
  if [ "$1" = "-f" ]; then
    rm -rf "$store${2%/}"
  else
    rm -f "$store$1"
  fi
  exit 0
fi
exit 0
EOF
chmod +x "$bin/node" "$bin/npm" "$bin/git" "$bin/sudo" "$bin/dconf"

export HOME="$home"
export PATH="$bin:$PATH"
export XBOXPLAY_NO_LAUNCH=1
export SUDO_LOG="$tmp/sudo.log"
export DCONF_DIR="$dconf_dir"
: > "$SUDO_LOG"

bash "$repo/install.sh"
bash "$repo/install.sh"

desk="$home/.local/share/applications/xboxplay.desktop"
icon="$home/.local/share/icons/hicolor/256x256/apps/xboxplay.png"
launcher="$home/.local/bin/xboxplay"
list="$dconf_dir/org/mate/panel/general/object-id-list"

grep -q '^Name=XboxPlay$' "$desk"
grep -q '^Type=Application$' "$desk"
grep -q "^Icon=$icon$" "$desk"
grep -q "^Exec=$launcher$" "$desk"
test -x "$launcher"
grep -q 'XBOXPLAY_CONTROLLER' "$launcher"
test -f "$icon"
grep -q "xboxplay" "$list"
test "$(grep -o 'xboxplay' "$list" | wc -l)" -eq 1
grep -q "'top'" "$dconf_dir/org/mate/panel/objects/xboxplay/toplevel-id"
test ! -s "$SUDO_LOG"
test -f "$home/.local/share/xboxplay/install-dir"

cp "$repo/uninstall.sh" "$tmp/uninstall.sh"
bash "$tmp/uninstall.sh"
test ! -e "$desk"
test ! -e "$launcher"
test ! -e "$icon"
test "$(grep -o 'xboxplay' "$list" | wc -l)" -eq 0
bash "$tmp/uninstall.sh"

echo "install script is idempotent"
