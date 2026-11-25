#!/bin/sh
# Flatpak already sandboxes the process, so Chromium's setuid helper is not used.
export CHROME_DESKTOP="${CHROME_DESKTOP:-com.wastedpatriot.XboxPlay.desktop}"
exec /app/lib/xboxplay/node_modules/electron/dist/electron /app/lib/xboxplay --no-sandbox "$@"
