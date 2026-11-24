#!/usr/bin/env bash
# Removes XboxPlay. Pass --purge to also delete your login (~/.config/XboxPlay).
# Safe to run again.
set -euo pipefail
CDPATH=

STAMP="$HOME/.local/share/xboxplay/install-dir"
MATE_ID="xboxplay"

list_has_id() {
  local cur="$1" id="$2"
  case "$cur" in
    *"'$id']"*|*"'$id',"*|*"'$id' ,"*) return 0 ;;
    *) return 1 ;;
  esac
}

remove_id() {
  local cur="$1" id="$2" body part bare out
  body="${cur#@as }"
  body="${body#[}"
  body="${body%]}"
  out=""
  local IFS=','
  for part in $body; do
    part="${part#"${part%%[![:space:]]*}"}"
    part="${part%"${part##*[![:space:]]}"}"
    bare="${part//\'/}"
    if [ -z "$part" ] || [ "$bare" = "$id" ]; then
      continue
    fi
    if [ -n "$out" ]; then out="$out, $part"; else out="$part"; fi
  done
  if [ -z "$out" ]; then printf '[]'; else printf '[%s]' "$out"; fi
}

remove_mate_launcher() {
  if command -v dconf >/dev/null 2>&1; then
    local cur next
    cur="$(dconf read /org/mate/panel/general/object-id-list 2>/dev/null || true)"
    if [ -n "$cur" ] && list_has_id "$cur" "$MATE_ID"; then
      next="$(remove_id "$cur" "$MATE_ID")"
      dconf write /org/mate/panel/general/object-id-list "$next" || true
    fi
    dconf reset -f "/org/mate/panel/objects/$MATE_ID/" 2>/dev/null || true
  fi
  rm -f "$HOME/.config/mate/panel2.d/default/launchers/xboxplay.desktop"
}

if [ -f "$STAMP" ]; then
  APP="$(tr -d '\n' < "$STAMP")"
else
  APP="$HOME/xboxplay"
fi
case "$APP" in
  /|"$HOME"|"") echo "Refusing to remove '$APP'."; exit 1 ;;
esac

present=0
if [ -d "$APP" ] || [ -e "$HOME/.local/bin/xboxplay" ] || [ -e "$HOME/.local/share/applications/xboxplay.desktop" ] || [ -e "$STAMP" ]; then
  present=1
fi

if [ -d "$APP" ]; then
  pkill -f "$APP/node_modules/electron" 2>/dev/null || true
fi
remove_mate_launcher
rm -f "$HOME/.local/bin/xboxplay" \
  "$HOME/.local/share/applications/xboxplay.desktop" \
  "$HOME/.local/share/icons/hicolor/256x256/apps/xboxplay.png" \
  "$STAMP"
rmdir "$HOME/.local/share/xboxplay" 2>/dev/null || true
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

if [ -d "$APP" ] && { [ -f "$APP/package.json" ] || [ -d "$APP/node_modules/electron" ]; }; then
  if ! rm -rf "$APP" 2>/dev/null; then
    echo "Removing $APP needs sudo because chrome-sandbox is owned by root."
    sudo rm -rf "$APP"
  fi
fi

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$HOME/.config/XboxPlay"
  echo "XboxPlay removed, including saved login."
elif [ "$present" -eq 1 ]; then
  echo "XboxPlay removed. Your login is still in ~/.config/XboxPlay (run with --purge to delete it)."
else
  echo "XboxPlay is already removed. Your login is still in ~/.config/XboxPlay (run with --purge to delete it)."
fi
