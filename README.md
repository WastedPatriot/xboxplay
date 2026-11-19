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

Sign in, go to your console (or a cloud game) and start the stream. Click inside the stream to capture the mouse. Esc gives it back.

There are two layouts, because driving with WASD on a stick doesn't work: on foot, and driving. A short tap of F or V (Y, get in/out of a vehicle) flips between them. Hold V if you just want Y without switching. Games don't tell the page whether you're in a car, so if it gets out of step press G. The corner badge shows which one you're in.

The phone in GTA opens with the up arrow. While it's open, the mouse look pauses, the wheel moves up and down the list, left click selects (A), and right click, C or Backspace closes it (B). Two-finger trackpad scrolling is left alone until the phone is actually open.

The layout matches GTA 6's default controller scheme, with keys where PC players expect them.

| Action | On foot | Driving |
|---|---|---|
| Move / steer | W A S D | A / D, W accelerate, S brake |
| Look | Mouse / trackpad | Mouse / trackpad |
| Run (L3) / horn | Shift | Shift or H |
| Jump (A) / handbrake | Space | Space |
| Crouch / duck (B) | C or Ctrl | C or Ctrl |
| Interact, enter, exit (Y) | E, F or V | E, F or V |
| Melee / kick (X) | R | R |
| Aim (LT) | Right click or K | Right click or K (brake) |
| Shoot | Left click or L (RT) | Left click (RB) |
| Cover (RB) | Q | Q |
| Loadout / sidearm (LB) | Tab | Tab |
| Zoom, look back (R3) | Middle click or Z | Middle click or Z |
| Focus (L3 + R3) | T | T |
| Map / pause | M / Enter or P | same |
| D-pad | Arrow keys (up is the phone) | same |
| Guide | Home | same |

Keys ease in over about 100ms instead of snapping to full, so steering and throttle feel less twitchy. K and L are there for trackpad users who can't right-click and move at the same time.

| Key | Does |
|---|---|
| F1 | Controls guide |
| F2 | Keyboard and mouse on/off |
| G | Switch on foot / driving |
| Up arrow | Open the phone (then wheel / click / C) |
| F3 | Settings |
| F5 | Reload |
| F11 | Fullscreen |
| Esc | Release the mouse (also closes the phone) |

A real controller works too, it's passed straight through.

F3 has mouse sensitivity (default 2), a trackpad boost (multiplies small movements), linear or smooth mouse curve, key smoothing (0 = instant), invert Y, auto-switch on a short V tap, and the mode badge. They're saved in the app. `XBOXPLAY_SENS=1.5 xboxplay` also sets the sensitivity.

## Better xCloud

On the old `www.xbox.com/play` site the app also loads [Better xCloud](https://github.com/redphx/better-xcloud) (pinned to v6.7.13, checked against a SHA-256 before it runs). It doesn't work on the new `play.xbox.com` site yet, which is why the built-in keyboard and mouse exists. You can turn Better xCloud off in F3, or with `XBOXPLAY_BX=0`.

## Known issues

- Xbox is moving people to the new `play.xbox.com` site. Right after that redirect it sometimes shows "Bad Request". The app retries; if it's still stuck press F5. To go back to the old site: sign in, click your profile picture, Exit preview.
- If the stream sits on "connecting" forever, try `XBOXPLAY_SAFE=1 xboxplay` (turns off GPU acceleration). Also check whether a VPN or Tailscale is up.
- The mouse goes through a virtual stick, so aiming feels like a controller with a very fast thumb. Tune the sensitivity and curve in F3.
- Auto-switch only knows you tapped V, not whether you actually got in. If the layout is wrong, press G to put it back.
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

Found something? See [SECURITY.md](SECURITY.md).

## License

MIT
