# XboxPlay

A small Linux app for playing my Xbox (remote play) and Xbox Cloud Gaming in its own window, with keyboard and mouse.

I built this because Greenlight wouldn't connect on my work network, while xbox.com/play in Chrome worked fine. So this is just that website in an Electron window, plus a keyboard and mouse layer that makes the game think a controller is plugged in.

Not affiliated with or endorsed by Microsoft. Xbox is a trademark of Microsoft. You still need your own Xbox account, and Game Pass for cloud games.

![Controls guide (F1)](docs/guide.png)

## Install

Debian, Ubuntu, Parrot and similar:

```bash
curl -fsSL https://raw.githubusercontent.com/WastedPatriot/xboxplay/main/install.sh | bash
```

It installs git/node/npm with apt if they're missing, clones this repo to `~/xboxplay`, runs `npm ci` (Electron 45.4.1, pinned in the lockfile), and adds an `xboxplay` command and an app menu entry. It asks for sudo once to set up Chromium's sandbox helper. Run the same line again to update.

If you'd rather read it first (fair), download `install.sh`, look through it, then run `bash install.sh`.

## Using it

Sign in, go to your console (or a cloud game) and start the stream. Click the picture to capture the mouse. Esc gives it back.

The keyboard is one Xbox controller. One key does one thing, and it stays held for as long as you hold the key. The triggers go to a full press, so brake and throttle register in racing games (steer with A and D, brake with `-`, throttle with `=`).

The buttons follow Greenlight's defaults. The sticks, which that map leaves out, are W A S D and I J K L. L is the right stick, so the left stick click is Q.

| Control | Key |
|---|---|
| Left stick | W A S D |
| Right stick | I J K L, or the mouse |
| D-pad | Arrow keys |
| A | Enter |
| B | Backspace |
| X | X |
| Y | Y |
| LB | [ |
| RB | ] |
| LT (full press, brake) | - |
| RT (full press, throttle) | = |
| Left stick click | Q |
| Right stick click | R, or the middle mouse button |
| View | V |
| Menu | M |
| Xbox button | N |
| Aim (LT) | Right mouse button |
| Shoot (RT) | Left mouse button |

| Key | Does |
|---|---|
| F1 | Controls guide |
| F2 | Keyboard and mouse on/off |
| F3 | Settings |
| F5 | Reload |
| F11 | Fullscreen |
| Esc | Release the mouse |

A real controller works too, it's passed straight through.

F3 has mouse sensitivity (default 2), a trackpad boost for small movements, a linear or smooth mouse curve, invert Y, and the badge. They're saved in the app. `XBOXPLAY_SENS=1.5 xboxplay` also sets the sensitivity.

To change a key, copy `keymap.example.json` to `~/.config/XboxPlay/keymap.json` and edit it. Each key can only be used once. If that file is missing, isn't a normal file, or doesn't match the example, you get the table above.

## Better xCloud

On the old `www.xbox.com/play` site the app also loads [Better xCloud](https://github.com/redphx/better-xcloud) (pinned to v6.7.13, checked against a SHA-256 before it runs). It doesn't work on the new `play.xbox.com` site yet, which is why the built-in keyboard and mouse exists. You can turn Better xCloud off in F3, or with `XBOXPLAY_BX=0`.

## Known issues

- Xbox is moving people to the new `play.xbox.com` site. Right after that redirect it sometimes shows "Bad Request". The app retries; if it's still stuck press F5. To go back to the old site: sign in, click your profile picture, Exit preview.
- If the stream sits on "connecting" forever, try `XBOXPLAY_SAFE=1 xboxplay` (turns off GPU acceleration). Also check whether a VPN or Tailscale is up.
- The mouse goes through a virtual stick, so aiming feels like a controller with a very fast thumb. Tune the sensitivity and curve in F3.
- Sound should start with the stream. If it doesn't, click once inside the window.
- Only tested on Debian-based distros with X11. Wayland should work but I haven't tried much.

## Uninstall

```bash
bash ~/xboxplay/uninstall.sh          # keeps your login
bash ~/xboxplay/uninstall.sh --purge  # also deletes ~/.config/XboxPlay
```

## Security notes

- The window only navigates to Microsoft/Xbox sign-in and play domains (`src/config.js`). Other links open in your normal browser.
- Renderer is sandboxed with context isolation, no Node integration, no webviews. Devtools are off unless you set `XBOXPLAY_DEBUG=1`.
- Only pointer lock, fullscreen, keyboard lock, mic/camera, speaker selection and clipboard write are granted, and only to those domains.
- No telemetry of its own. Logs never include URLs' query strings.
- Your login lives in `~/.config/XboxPlay` like any browser profile.
- `keymap.json` is only read from that same folder, only if it is a regular file (not a link), and only if every entry is a known control and one key code. It is never downloaded.

Found something? See [SECURITY.md](SECURITY.md).

## License

MIT
