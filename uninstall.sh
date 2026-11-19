#!/usr/bin/env bash
# Removes XboxPlay. Pass --purge to also delete your login/session data (~/.config/XboxPlay).
set -euo pipefail
pkill -f "$HOME/xboxplay/node_modules/electron" 2>/dev/null || true
# chrome-sandbox is root-owned after install, so removal may need sudo.
rm -rf "$HOME/xboxplay" 2>/dev/null || sudo rm -rf "$HOME/xboxplay"
rm -f "$HOME/.local/bin/xboxplay" "$HOME/.local/share/applications/xboxplay.desktop"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$HOME/.config/XboxPlay"
  echo "XboxPlay removed, including saved login."
else
  echo "XboxPlay removed. Your login is still in ~/.config/XboxPlay (run with --purge to delete it)."
fi
