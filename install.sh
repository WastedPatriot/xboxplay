#!/usr/bin/env bash
# XboxPlay installer: Xbox Remote Play desktop app (Electron + Better xCloud). Safe to re-run (updates).
set -euo pipefail
APP="$HOME/xboxplay"; ELECTRON_VER="45.4.1"
BX_URL="https://github.com/redphx/better-xcloud/releases/latest/download/better-xcloud.user.js"
echo "==> XboxPlay installer"

# 1. Node.js / npm
if ! command -v node >/dev/null || ! command -v npm >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "==> Installing nodejs + npm (sudo)"; sudo apt-get update -y && sudo apt-get install -y nodejs npm curl
fi
mkdir -p "$APP" "$HOME/.local/bin" "$HOME/.local/share/applications"
cd "$APP"

# 2. App files
cat > package.json <<'EOF'
{ "name": "xboxplay", "version": "1.0.0", "description": "Xbox Remote Play with Better xCloud", "main": "main.js", "private": true }
EOF

cat > preload.js <<'EOF'
// Injects Better xCloud into the page's main world before any page script runs.
const { webFrame } = require('electron');
const fs = require('fs');
const arg = process.argv.find(a => a.startsWith('--bx-path='));
const mkbArg = process.argv.find(a => a.startsWith('--mkb-sens='));
if (/^https:\/\/(www|play)\.xbox\.com\//i.test(location.href)) {
  try { webFrame.executeJavaScript((mkbArg ? 'window.__XBOXPLAY_SENS=' + JSON.stringify(mkbArg.slice(11)) + ';' : '') +
    fs.readFileSync(require('path').join(__dirname, 'mkb.js'), 'utf8') + '\n;void 0').catch(e => console.error('[XboxPlay] MKB failed:', e)); }
  catch (e) { console.error('[XboxPlay] cannot load MKB:', e); }
}
const MATCH = /^https:\/\/www\.xbox\.com\/[^/]+\/(play|auth\/msa\?.*loggedIn)/i;
if (arg && MATCH.test(location.href) && !/xbox-game-pass\/play-day-one/.test(location.href)) {
  try {
    const code = fs.readFileSync(arg.slice(10), 'utf8');
    webFrame.executeJavaScript(
      'window.__XBOXPLAY_BX_INJECTED_AT={readyState:document.readyState,scripts:document.scripts.length};\n' + code + '\n;void 0'
    ).catch(e => console.error('[XboxPlay] Better xCloud failed:', e));
  } catch (e) { console.error('[XboxPlay] cannot read Better xCloud:', e); }
}
EOF

cat > mkb.js <<'EOF'
// XboxPlay built-in keyboard+mouse -> virtual Xbox gamepad (works on www.xbox.com and play.xbox.com).
(() => {
  if (window.__xboxplayMKB) return;
  const LS = window.localStorage, origGP = Navigator.prototype.getGamepads;
  const KEYS = { Space: 0, KeyE: 0, KeyC: 1, Backspace: 1, KeyR: 2, KeyV: 3, KeyQ: 4, KeyF: 5, Tab: 8, Enter: 9,
    KeyX: 10, KeyZ: 11, ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15, Home: 16 };
  const STICK = { KeyW: [1, -1], KeyS: [1, 1], KeyA: [0, -1], KeyD: [0, 1] };
  const btn = new Array(17).fill(false), held = new Set();
  let accX = 0, accY = 0, rx = 0, ry = 0, ts = performance.now(), announced = false;
  const sens = () => parseFloat(LS.getItem('xboxplay.sens') || window.__XBOXPLAY_SENS || '1') || 1;
  const pref = LS.getItem('xboxplay.mkb');
  const M = window.__xboxplayMKB = {
    enabled: pref ? pref === '1' : true, forceActive: false,
    active() { return this.enabled && (this.forceActive || !!document.pointerLockElement); },
    toggle() { this.enabled = !this.enabled; LS.setItem('xboxplay.mkb', this.enabled ? '1' : '0'); if (!this.enabled) { reset(); document.exitPointerLock && document.exitPointerLock(); } else announce();
      toast('Keyboard & mouse ' + (this.enabled ? 'ON - click the stream to capture the mouse, Esc releases' : 'OFF')); },
    setSensitivity(v) { LS.setItem('xboxplay.sens', String(v)); toast('Mouse sensitivity ' + v); },
  };
  // If Better xCloud is loaded and the user never chose, leave input to Better xCloud.
  setTimeout(() => { if (!pref && window.BX_EXPOSED) M.enabled = false; }, 0);
  function reset() { btn.fill(false); held.clear(); accX = accY = rx = ry = 0; ts = performance.now(); }
  function toast(t) { const d = document.createElement('div'); d.textContent = t;
    d.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:2147483647;background:rgba(16,124,16,.9);color:#fff;font:15px sans-serif;padding:10px 18px;border-radius:8px;pointer-events:none';
    (document.body || document.documentElement).appendChild(d); setTimeout(() => d.remove(), 2500); }
  const clamp = v => Math.max(-1, Math.min(1, v));
  function pad(index) {
    const ax = [0, 0, rx, ry]; for (const k of held) if (STICK[k]) ax[STICK[k][0]] += STICK[k][1];
    const b = btn.map(p => ({ pressed: p, touched: p, value: p ? 1 : 0 }));
    const g = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index, connected: true, mapping: 'standard',
      timestamp: ts, axes: ax.map(clamp), buttons: b, vibrationActuator: null, hapticActuators: [] };
    try { Object.setPrototypeOf(g, Gamepad.prototype); } catch (e) {}
    return g;
  }
  let slot = 0;
  Navigator.prototype.getGamepads = function () {
    const real = Array.from(origGP.call(this) || []);
    if (!M.enabled) return real;
    slot = real.findIndex(p => !p); if (slot < 0) slot = real.length;
    while (real.length < 4) real.push(null);
    real[slot] = pad(slot); return real;
  };
  function announce() { if (announced) return; announced = true; try { const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: pad(slot) }); window.dispatchEvent(e); } catch (e) {} }
  // Mouse -> right stick with decay
  setInterval(() => { const s = sens() * 0.04; const nx = clamp(accX * s), ny = clamp(accY * s);
    if (nx !== rx || ny !== ry) ts = performance.now(); rx = nx; ry = ny; accX *= 0.5; accY *= 0.5;
    if (Math.abs(accX) < 0.5) accX = 0; if (Math.abs(accY) < 0.5) accY = 0; }, 8);
  const on = (t, f) => window.addEventListener(t, f, true);
  on('keydown', e => { if (!M.active()) return; const c = e.code;
    if (c in KEYS || c in STICK) { e.preventDefault(); e.stopImmediatePropagation(); held.add(c); if (c in KEYS) btn[KEYS[c]] = true; ts = performance.now(); } });
  on('keyup', e => { const c = e.code; if (!held.has(c)) return; held.delete(c);
    if (c in KEYS && ![...held].some(k => KEYS[k] === KEYS[c])) btn[KEYS[c]] = false; ts = performance.now(); if (M.active()) { e.preventDefault(); e.stopImmediatePropagation(); } });
  on('mousemove', e => { if (!M.active()) return; accX += e.movementX; accY += e.movementY; });
  const mbtn = { 0: 7, 2: 6 };
  on('mousedown', e => {
    if (M.enabled && !document.pointerLockElement && document.querySelector('video') && [...document.querySelectorAll('video')].some(v => v.readyState >= 2)) {
      (document.body || document.documentElement).requestPointerLock(); announce(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!M.active() || !(e.button in mbtn)) return; btn[mbtn[e.button]] = true; ts = performance.now(); e.preventDefault(); e.stopImmediatePropagation(); });
  on('mouseup', e => { if (e.button in mbtn && btn[mbtn[e.button]]) { btn[mbtn[e.button]] = false; ts = performance.now(); if (M.active()) { e.preventDefault(); e.stopImmediatePropagation(); } } });
  on('contextmenu', e => { if (M.active()) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) reset(); });
  window.addEventListener('blur', reset);
  if (M.enabled) announce();
})();
EOF

cat > main.js <<'EOF'
const { app, BrowserWindow, session, net } = require('electron');
const path = require('path'), fs = require('fs');
const BX_URL = 'https://github.com/redphx/better-xcloud/releases/latest/download/better-xcloud.user.js';
const BX_FILE = path.join(__dirname, 'better-xcloud.user.js');
const START = process.env.XBOXPLAY_URL || 'https://www.xbox.com/play';
const TEST = process.env.XBOXPLAY_TEST === '1';
const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;

app.setName('XboxPlay');
app.userAgentFallback = CHROME_UA;
if (process.env.XBOXPLAY_SAFE === '1') app.disableHardwareAcceleration();
else {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Refresh Better xCloud (max 6s); keep cached copy on failure.
async function updateBX() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await net.fetch(BX_URL, { signal: ctl.signal }); clearTimeout(t);
    const txt = await r.text();
    if (r.ok && txt.includes('==UserScript==')) { fs.writeFileSync(BX_FILE, txt); console.log('[XboxPlay] Better xCloud', (txt.match(/@version\s+(\S+)/) || [])[1], 'up to date'); }
  } catch (e) { console.log('[XboxPlay] Better xCloud update skipped, using cached copy'); }
}

// F1 overlay: Better xCloud's default MKB preset (from the userscript). Change keys in Better xCloud settings > Controls.
const GUIDE_JS = `(() => { let d = document.getElementById('xboxplay-guide'); if (d) { d.remove(); return; }
  d = document.createElement('div'); d.id = 'xboxplay-guide';
  d.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:rgba(0,0,0,.8);color:#fff;font:14px/1.6 monospace;padding:14px 18px;border-radius:10px;border:1px solid #107c10;pointer-events:none;white-space:pre';
  d.textContent = 'XboxPlay - keyboard & mouse (F2 = built-in on/off)\\n' +
   'Move (left stick)   W A S D\\nLook (right stick)  Mouse\\nRT shoot / LT aim   Left / Right click\\n' +
   'A  Space or E       B  C or Backspace\\nX  R                Y  V\\nLB Q                RB F\\n' +
   'L3 X   R3 Z         View Tab   Menu Enter\\n\\nF1 guide  F2 keyboard/mouse  F11 fullscreen   F5 reload   F12 devtools\\n' +
   'D-pad  Arrow keys   Guide Home\\n' +
   'Click the stream to capture the mouse, Esc releases it.\\n' +
   'Sensitivity: XBOXPLAY_SENS=1.5 xboxplay (or localStorage xboxplay.sens)';
  document.documentElement.appendChild(d); })()`;

function createWindow() {
  const ses = session.fromPartition('persist:xbox');
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(true));   // mic, pointer lock, fullscreen, etc.
  ses.setPermissionCheckHandler(() => true);
  const webPreferences = {
    partition: 'persist:xbox', preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: false,
    additionalArguments: ['--bx-path=' + BX_FILE, ...(process.env.XBOXPLAY_SENS ? ['--mkb-sens=' + process.env.XBOXPLAY_SENS] : [])], backgroundThrottling: false,
  };
  const win = new BrowserWindow({ width: 1600, height: 900, title: 'XboxPlay', backgroundColor: '#000', autoHideMenuBar: true, webPreferences });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences } }));
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F2') { win.webContents.executeJavaScript('window.__xboxplayMKB && window.__xboxplayMKB.toggle()').catch(() => {}); e.preventDefault(); }
    else if (i.key === 'F1') { win.webContents.executeJavaScript(GUIDE_JS).catch(() => {}); e.preventDefault(); }
    else if (i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (i.key === 'F5') { win.webContents.reload(); e.preventDefault(); }
    else if (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.webContents.on('console-message', (e, ...a) => { const m = typeof a[1] === 'string' ? a[1] : (e.message || ''); if (TEST || /XboxPlay|BxC/.test(m)) console.log('[page]', m); });
  // Xbox is rolling out the new play.xbox.com site (Better xCloud doesn't support it yet). Its redirect
  // from xbox.com/<locale>/play lands on an "Invalid URL" page, so go to its home page instead.
  win.webContents.on('will-redirect', (e, url) => {
    if (/^https:\/\/play\.xbox\.com\/[a-z]{2}-[a-z]{2}\/play\/?$/i.test(url)) {
      e.preventDefault();
      console.log('[XboxPlay] Redirected to new play.xbox.com site. For mouse & keyboard: sign in, profile picture > Exit preview.');
      setTimeout(() => win.loadURL('https://play.xbox.com/'), 1500);
    }
  });
  let retries = 0;   // new site sometimes shows "Bad Request"/"Invalid URL" right after the redirect; a fresh load fixes it
  win.webContents.on('did-finish-load', () => setTimeout(() => {
    const t = win.webContents.getTitle(), u = win.webContents.getURL();
    if (u.includes('play.xbox.com') && /Bad Request|Invalid URL/i.test(t) && retries++ < 2) win.loadURL('https://play.xbox.com/');
  }, 1500));
  win.loadURL(START);
  if (TEST) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    const r = await win.webContents.executeJavaScript(`({url: location.href, title: document.title, ua: navigator.userAgent,
      injected: window.__XBOXPLAY_BX_INJECTED_AT || null, BX_EXPOSED: typeof window.BX_EXPOSED, BxLogger: typeof window.BxLogger,
      bxElements: [...document.querySelectorAll('[class*="bx-"],[id^="bx"],[class*="bx-header"]')].slice(0,8).map(e => e.tagName + '.' + e.className)})`);
    console.log('[XboxPlay TEST]', JSON.stringify(r));
    fs.writeFileSync(path.join(__dirname, 'test-shot.png'), (await win.webContents.capturePage()).toPNG());
    app.quit();
  }, 20000));
}

app.whenReady().then(async () => { if (!fs.existsSync(BX_FILE) || !TEST) await updateBX(); createWindow(); });
app.on('window-all-closed', () => app.quit());
EOF

# 3. Better xCloud + Electron
echo "==> Downloading Better xCloud"
curl -fsSL "$BX_URL" -o better-xcloud.user.js.tmp && mv better-xcloud.user.js.tmp better-xcloud.user.js || { rm -f better-xcloud.user.js.tmp; [ -s better-xcloud.user.js ] || { echo "Download failed"; exit 1; }; }
echo "==> Installing Electron $ELECTRON_VER (local to $APP)"
npm install --no-fund --no-audit --save-exact "electron@$ELECTRON_VER"
[ -x node_modules/electron/dist/electron ] || node node_modules/electron/install.js   # newer npm may skip postinstall

# Use Chromium's sandbox if it can be set up (needs sudo); otherwise fall back to --no-sandbox.
SB="$APP/node_modules/electron/dist/chrome-sandbox"; FLAGS="--no-sandbox"
if [ -f "$SB" ] && sudo chown root:root "$SB" && sudo chmod 4755 "$SB"; then FLAGS=""; fi

# 4. Launcher + menu entry
cat > "$HOME/.local/bin/xboxplay" <<EOF
#!/usr/bin/env bash
cd "$APP" && exec "$APP/node_modules/.bin/electron" . $FLAGS "\$@"
EOF
chmod +x "$HOME/.local/bin/xboxplay"
curl -fsSL -o "$APP/icon.png" "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Xbox_one_logo.svg/256px-Xbox_one_logo.svg.png" 2>/dev/null || true
cat > "$HOME/.local/share/applications/xboxplay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=XboxPlay
Comment=Xbox Remote Play with mouse & keyboard (Better xCloud)
Exec=$HOME/.local/bin/xboxplay
Icon=$APP/icon.png
Terminal=false
Categories=Game;
StartupWMClass=XboxPlay
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "==> Installed. Run 'xboxplay' or find XboxPlay in your app menu. F1 = controls guide, F11 = fullscreen, F5 = reload."
[ "${XBOXPLAY_NO_LAUNCH:-0}" = 1 ] || { nohup "$HOME/.local/bin/xboxplay" >"$APP/xboxplay.log" 2>&1 & disown; echo "==> Launched (log: $APP/xboxplay.log)"; }
