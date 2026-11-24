# XboxPlay

A small Linux app for playing my Xbox (remote play) and Xbox Cloud Gaming in its own window, with keyboard and mouse.

I built this because Greenlight wouldn't connect on my work network, while xbox.com/play in Chrome worked fine. So this is just that website in an Electron window, plus a keyboard and mouse layer that makes the game think a controller is plugged in.

Not affiliated with or endorsed by Microsoft. Xbox is a trademark of Microsoft. You still need your own Xbox account, and Game Pass for cloud games.

![Controls guide (F1)](docs/guide.png)

## Install

From a checkout:

```bash
git fetch origin polish
git checkout polish
./install.sh
```

That installs for your user. It runs `npm ci`, adds an `xboxplay` command, and puts an icon in the app menu so you can pin it. On MATE (Parrot's default desktop) it also adds a panel launcher, if a panel is already set up. Run it again whenever you want; it refreshes the same files and does not add a second launcher or change your git branch.

Sudo is only for missing packages (git, Node, npm, via apt) and for Chromium's sandbox helper. If you skip the sandbox step it still runs, with `--no-sandbox`. A wired controller also needs your user in the `input` group. That is a separate sudo, and you have to log out afterwards:

```bash
sudo usermod -aG input "$USER"
```

The 8BitDo Ultimate 2C over USB uses the kernel `xpad` driver and shows up as `/dev/input/js*`. Electron reads it as a normal controller. Official Xbox Series pads over USB often need the `xone` driver instead. Bluetooth controllers use `xpadneo` or the kernel HID driver.

You can still install with `curl -fsSL https://raw.githubusercontent.com/WastedPatriot/xboxplay/main/install.sh | bash`, which clones `main` into `~/xboxplay`. Set `XBOXPLAY_BRANCH` if you want a different branch. Read the script first if you'd rather not pipe it.

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

A plugged-in controller is what the game sees. The keyboard pad is not added next to it, so the two don't get mixed up. In F3, pick Wired USB, Bluetooth, or Keyboard. Keyboard forces the keyboard pad even if a controller is plugged in. Until you pick, a controller is used when it's there and the keyboard is used when it isn't.

`xboxplay --controller wired` (or `bluetooth`, or `keyboard`) does the same thing, and so does `XBOXPLAY_CONTROLLER=wired`. The choice is saved in `~/.config/XboxPlay/settings.json`. If the kind you picked isn't connected, XboxPlay says so. Wired is the USB `xpad` / `xone` path. Bluetooth is `xpadneo` or HID.

F3 has mouse sensitivity (default 2), a trackpad boost (multiplies small movements), linear or smooth mouse curve, key smoothing (0 = instant), invert Y, auto-switch on a short V tap, and the mode badge. They're saved in the app. `XBOXPLAY_SENS=1.5 xboxplay` also sets the sensitivity.

## Stream

The window stays awake while XboxPlay is open, and Chromium is told not to throttle it when another window covers it. On Linux it asks for VA-API hardware decode. If the picture is black or the app crashes, start it with `XBOXPLAY_SAFE=1`, which turns GPU acceleration off. `XBOXPLAY_VAAPI=1` also tries zero-copy decode. That is faster on some GPUs and broken on others.

While a game is streaming, the top right shows delay and bitrate. `HW` means the video decoder reported hardware decode. If the connection stays poor (high delay or packet loss) it says so, once, until it recovers.

If the stream drops, XboxPlay waits a few seconds, then tries to reconnect up to three times. The first try restarts the network path. After that it clicks a Reconnect button on the page if there is one. Then it asks you to press F5. Turn this off in F3.

F3 also has stream quality. Auto leaves Xbox's bitrate alone and keeps the playback buffer short. Stable asks for about 6 Mb/s and leaves the buffer alone. High asks for about 15 Mb/s. The bitrate applies the next time the stream connects. `XBOXPLAY_QUALITY=stable` (or `high`, or `auto`) is the same choice when you haven't picked one in F3 yet.

## Better xCloud

On the old `www.xbox.com/play` site the app also loads [Better xCloud](https://github.com/redphx/better-xcloud) (pinned to v6.7.13, checked against a SHA-256 before it runs). It doesn't work on the new `play.xbox.com` site yet, which is why the built-in keyboard and mouse exists. You can turn Better xCloud off in F3, or with `XBOXPLAY_BX=0`.

## Known issues

- Xbox is moving people to the new `play.xbox.com` site. Right after that redirect it sometimes shows "Bad Request". The app retries; if it's still stuck press F5. To go back to the old site: sign in, click your profile picture, Exit preview.
- If the stream sits on "connecting" forever, or the picture is black, try `XBOXPLAY_SAFE=1 xboxplay` (turns off GPU acceleration, including VA-API). Also check whether a VPN or Tailscale is up.
- The mouse goes through a virtual stick, so aiming feels like a controller with a very fast thumb. Tune the sensitivity and curve in F3.
- Auto-switch only knows you tapped V, not whether you actually got in. If the layout is wrong, press G to put it back.
- Sound should start with the stream. If it doesn't, click once inside the window.
- Only tested on Debian-based distros with X11. Wayland should work but I haven't tried much.

## Uninstall

```bash
bash ~/xboxplay/uninstall.sh          # keeps your login
bash ~/xboxplay/uninstall.sh --purge  # also deletes ~/.config/XboxPlay
```

That removes the command, the menu entry, the icon, and the MATE panel launcher. Running it again is fine.

## Security notes

- The window only navigates to Microsoft/Xbox sign-in and play domains (`src/config.js`). Other links open in your normal browser.
- Renderer is sandboxed with context isolation, no Node integration, no webviews. Devtools are off unless you set `XBOXPLAY_DEBUG=1`.
- Only pointer lock, fullscreen, keyboard lock, mic/camera, speaker selection and clipboard write are granted, and only to those domains.
- No telemetry of its own. Logs never include URLs' query strings.
- Your login lives in `~/.config/XboxPlay` like any browser profile.
- The main process reads `/sys/class/input` to tell a wired controller from a Bluetooth one. It does not open the device. The pad itself is the browser's normal gamepad.

Found something? See [SECURITY.md](SECURITY.md).

## License

MIT
