# XboxPlay

Xbox remote play and Xbox Cloud Gaming in a window on Linux, with a controller or the keyboard and mouse.

I built this because Greenlight wouldn't connect on my work network, while xbox.com/play in Chrome worked fine. This is that site in an Electron window, plus a keyboard and mouse layer that looks like a controller to the game.

Not affiliated with or endorsed by Microsoft. Xbox is a trademark of Microsoft. You still need your own Xbox account, and Game Pass for cloud games.

![Controls guide, press F1](docs/guide.png)

![Settings, press F3](docs/settings.png)

## Install

One command. On Debian, Ubuntu, and Parrot it uses apt. The same script also handles Fedora, Arch, and openSUSE, and it only calls the package manager when git, curl, or Node is missing.

```bash
curl -fsSL https://raw.githubusercontent.com/WastedPatriot/xboxplay/main/install.sh | bash
```

It clones this repo to `~/xboxplay`, runs `npm ci`, and adds an `xboxplay` command and a menu entry named XboxPlay. No terminal window. The icon goes into the hicolor sizes, and `StartupWMClass` is `XboxPlay`, which is also the window class. On MATE it pins a panel launcher when a panel is already set up. Run the same line again to update. It does not change your git branch.

If you'd rather read it first, download `install.sh`, look through it, then run `bash install.sh` from a checkout.

The other way is an AppImage. Nothing is attached until a `v*` tag is pushed (see [Releases](https://github.com/WastedPatriot/xboxplay/releases)). After `v1.0.0` exists:

```bash
curl -fL -o XboxPlay.AppImage "https://github.com/WastedPatriot/xboxplay/releases/latest/download/XboxPlay-1.0.0.AppImage" && chmod +x XboxPlay.AppImage && ./XboxPlay.AppImage
```

That same release also has a `.deb` and an `.rpm`.

Sudo is used once for Chromium's sandbox helper. If you skip that, it still runs, with `--no-sandbox`. A wired controller needs your user in the `input` group (`sudo usermod -aG input "$USER"`, then log out). This script does not install kernel drivers.

## Features

- Remote play to your console, and cloud games, in one window.
- A plugged-in gamepad is passed through on its own. The keyboard pad is not mixed in with it.
- Keyboard and mouse act as one Xbox pad. F2 turns that off. F3 can force the keyboard even when a pad is plugged in.
- F1 is the control list. F3 is sensitivity, trackpad boost, aim kick, the mouse curve, and invert Y.
- The window stays awake, shows delay and bitrate, and tries to reconnect if the stream drops.
- If you step away, it clicks "I'm still here" and sends a tiny stick nudge the game ignores.
- On the old `www.xbox.com/play` site it can load Better xCloud, pinned to one version and checked with a SHA-256 before it runs.
- No telemetry of its own.

## Controllers

| What you have | What you need |
|---|---|
| 8BitDo pad with the standard mapping. The Ultimate 2C over USB is `2dc8:310a` on `xpad`. | Plug it in. Your user should be in the `input` group. This app does not install the driver. |
| Xbox pad, USB | `xpad`, or `xone` for many Series pads. |
| Xbox pad, Bluetooth | `xpadneo`, or the kernel HID driver. |
| Keyboard and mouse | Nothing extra. F2 turns it off. In F3, Keyboard forces this pad and hides a plugged-in controller. |

## Keys

Sign in, go to your console (or a cloud game) and start the stream. Click the picture to capture the mouse. Esc gives it back.

The keyboard is one Xbox controller. One key does one thing, and it stays held for as long as you hold the key. The triggers go to a full press, so brake and throttle register in racing games (steer with A and D, brake with `-`, throttle with `=`).

The face buttons, triggers, view, menu and Xbox button follow Greenlight. Bumpers are Q and R. The sticks, which Greenlight leaves out, are W A S D and I J K L. Stick clicks are F and G, and the middle mouse button is also the right stick click.

| Control | Key |
|---|---|
| Left stick | W A S D |
| Right stick | I J K L, or the mouse |
| D-pad | Arrow keys |
| A | Enter |
| B | Backspace |
| X | X |
| Y | Y |
| LB | Q |
| RB | R |
| LT (full press, brake) | - |
| RT (full press, throttle) | = |
| Left stick click | F |
| Right stick click | G, or the middle mouse button |
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

A plugged-in controller is what the game sees. The keyboard pad is not added next to it. In F3, pick Wired USB, Bluetooth, or Keyboard. Keyboard forces the keyboard pad even if a controller is plugged in. Until you pick, a controller is used when it is there and the keyboard is used when it is not.

`xboxplay --controller wired` (or `bluetooth`, or `keyboard`) does the same thing, and so does `XBOXPLAY_CONTROLLER=wired`. The choice is saved in `~/.config/XboxPlay/settings.json`. If the kind you picked is not connected, XboxPlay says so. Wired is the USB `xpad` / `xone` path. Bluetooth is `xpadneo` or HID.

F3 has mouse sensitivity (default 2), a trackpad boost for small movements, a linear or smooth mouse curve, invert Y, and the badge. They're saved in the app. `XBOXPLAY_SENS=1.5 xboxplay` also sets the sensitivity.

To change a key, copy `keymap.example.json` to `~/.config/XboxPlay/keymap.json` and edit it. Each key can only be used once. If that file is missing, isn't a normal file, or doesn't match the example, you get the table above.

## Stream

The window stays awake while XboxPlay is open, and Chromium is told not to throttle it when another window covers it. On Linux it asks for VA-API hardware decode. `XBOXPLAY_VAAPI=1` also tries zero-copy decode. That is faster on some GPUs and broken on others.

While a game is streaming, the top right shows delay and bitrate. `HW` means the video decoder reported hardware decode. If the connection stays poor (high delay or packet loss) it says so, once, until it recovers.

If the stream drops, XboxPlay waits a few seconds, then tries to reconnect up to three times. The first try restarts the network path. After that it clicks a Reconnect button on the page if there is one. Then it asks you to press F5. Turn this off in F3.

If you step away, XboxPlay stays connected: it clicks "I'm still here" when that prompt shows, and sends a tiny stick nudge the game ignores. Turn that off in F3.

F3 also has stream quality. Auto leaves Xbox's bitrate alone and keeps the playback buffer short. Stable asks for about 6 Mb/s and leaves the buffer alone. High asks for about 15 Mb/s. The bitrate applies the next time the stream connects. `XBOXPLAY_QUALITY=stable` (or `high`, or `auto`) is the same choice when you have not picked one in F3 yet.

## Troubleshooting

- Black screen, or the picture never comes up: the network is often blocking the UDP ports the stream uses. Try a phone hotspot. A VPN can block it the same way.
- Sandbox: the installer asks for sudo once so `chrome-sandbox` can be root-owned and setuid. If that fails, the app starts with `--no-sandbox`. The Flatpak build does that on purpose, because Flatpak is already a sandbox.
- GPU: if the window stays black or the app dies on startup, run `XBOXPLAY_SAFE=1 xboxplay`. That turns GPU acceleration off.
- The controller is missing. Wired USB needs the `input` group, then a logout. The 8BitDo Ultimate 2C uses `xpad`. Official Series pads over USB often need `xone`. Bluetooth needs `xpadneo` or the kernel HID driver. In F3, leave the choice on "Controller if plugged in" unless you want the keyboard.
- "Bad Request" right after Xbox sends you to `play.xbox.com`: the app retries. Press F5 if it is still stuck. To go back to the old site: sign in, click your profile picture, Exit preview.
- No sound: click once inside the window.
- The mouse goes through a virtual stick, so aiming feels like a controller with a very fast thumb. Tune the sensitivity and curve in F3.
- XboxPlay does not show in the menu. Run `./install.sh` again, then log out and back in. The entry name is XboxPlay.

## FAQ

**Is this official?** No.

**Do I need Game Pass?** For cloud games, yes. Remote play needs your own console on the same account.

**Where is the login stored?** `~/.config/XboxPlay`. Uninstall keeps it unless you pass `--purge`.

**How do I update?** Run the curl line again. For the AppImage, download the newer file from the release.

**Will it run on a Steam Deck?** The AppImage is the one to try. I have not tested it there.

**Which desktops?** Debian-based distros with X11. The installer also handles Fedora, Arch, and openSUSE. Wayland should work, but I have not tried it much.

## Better xCloud

On the old `www.xbox.com/play` site the app also loads [Better xCloud](https://github.com/redphx/better-xcloud) (pinned to v6.7.13, checked against a SHA-256 before it runs). It doesn't work on the new `play.xbox.com` site yet, which is why the built-in keyboard and mouse exists. You can turn Better xCloud off in F3, or with `XBOXPLAY_BX=0`.

## Uninstall

```bash
bash ~/xboxplay/uninstall.sh          # keeps your login
bash ~/xboxplay/uninstall.sh --purge  # also deletes ~/.config/XboxPlay
```

That removes the command, the menu entry, the icon, and the MATE panel launcher. An AppImage is just the file. Delete it.

## Security notes

- The window only navigates to Microsoft/Xbox sign-in and play domains (`src/config.js`). Other links open in your normal browser.
- Renderer is sandboxed with context isolation, no Node integration, no webviews. Devtools are off unless you set `XBOXPLAY_DEBUG=1`.
- Only pointer lock, fullscreen, keyboard lock, mic/camera, speaker selection and clipboard write are granted, and only to those domains.
- No telemetry of its own. Logs never include URLs' query strings.
- Your login lives in `~/.config/XboxPlay` like any browser profile.
- `keymap.json` is only read from that same folder, only if it is a regular file (not a link), and only if every entry is a known control and one key code. It is never downloaded.
- The main process reads `/sys/class/input` to tell a wired controller from a Bluetooth one. It does not open the device. The pad itself is the browser's normal gamepad.

Found something? See [SECURITY.md](SECURITY.md).

## Ideas / not yet

Steam Deck and other Linux handhelds are a possible later step, using the AppImage. Android might come after that. Old consoles such as the PSP and 3DS are not feasible.

## License

MIT
