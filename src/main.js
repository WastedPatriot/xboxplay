'use strict';
const { app, BrowserWindow, session, net, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { INJECT_HOSTS, ALLOWED_PERMISSIONS, BX, isAllowedUrl, safeUrl } = require('./config');

const START = 'https://www.xbox.com/play';
const DEBUG = process.env.XBOXPLAY_DEBUG === '1';
const PARTITION = 'persist:xbox';
// xbox.com blocks unknown browsers, so present as plain Chrome on Linux (same engine version).
const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
const log = (...a) => console.log('[XboxPlay]', ...a);

app.setName('XboxPlay');
app.userAgentFallback = CHROME_UA;
if (process.env.XBOXPLAY_SAFE === '1') app.disableHardwareAcceleration();
else {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

// ---- injected scripts ----------------------------------------------------
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const OWN_SCRIPTS = [{ name: 'overlay', code: read('overlay.js') }, { name: 'mkb', code: read('mkb.js') }];
const sens = parseFloat(process.env.XBOXPLAY_SENS);
if (sens > 0) OWN_SCRIPTS.unshift({ name: 'sens', code: `window.__XBOXPLAY_SENS=${JSON.stringify(String(sens))}` });

const BX_FILE = () => path.join(app.getPath('userData'), `better-xcloud-${BX.version}.user.js`);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
let bxCode = null;

// Load the pinned Better xCloud release, downloading it once. Skipped entirely on hash mismatch.
async function loadBX() {
  if (process.env.XBOXPLAY_BX === '0') return;
  let code = null;
  try { code = fs.readFileSync(BX_FILE(), 'utf8'); } catch {}
  if (!code || sha256(code) !== BX.sha256) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const r = await net.fetch(BX.url, { signal: ctl.signal }); clearTimeout(t);
      code = r.ok ? await r.text() : null;
    } catch { code = null; }
    if (code && sha256(code) === BX.sha256) fs.writeFileSync(BX_FILE(), code, { mode: 0o600 });
    else { if (code) log(`Better xCloud ${BX.version}: SHA-256 mismatch, not using it`); else log('Better xCloud: download failed, continuing without it'); return; }
  }
  bxCode = code;
}

ipcMain.on('xboxplay:scripts', (e, opts) => {
  let out = [];
  try {
    const url = e.senderFrame && e.senderFrame.url;          // trust the frame, not the renderer's claim
    const u = new URL(url);
    if (u.protocol === 'https:' && INJECT_HOSTS.includes(u.hostname)) {
      out = OWN_SCRIPTS.slice();
      if (bxCode && opts && opts.bx !== false && BX.match.test(url) && !BX.exclude.test(url)) out.push({ name: 'better-xcloud', code: bxCode });
    }
  } catch {}
  e.returnValue = out;
});

// ---- window --------------------------------------------------------------
function webPreferences() {
  return {
    partition: PARTITION, preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false,
    devTools: DEBUG, spellcheck: false, backgroundThrottling: false,
  };
}

function lockDown(wc) {
  const guard = (e, url) => {
    if (isAllowedUrl(url)) return;
    e.preventDefault(); log('blocked navigation to', safeUrl(url));
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', (e, url, inPlace, isMainFrame) => { if (isMainFrame) guard(e, url); });
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000', webPreferences: webPreferences() } };
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', w => lockDown(w.webContents));
}

function createWindow() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA);
  const originOk = o => isAllowedUrl(o);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ALLOWED_PERMISSIONS.has(perm) && originOk(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => ALLOWED_PERMISSIONS.has(perm) && originOk(origin));
  ses.setDevicePermissionHandler(() => false);

  const win = new BrowserWindow({
    width: 1600, height: 900, title: 'XboxPlay', backgroundColor: '#000', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), webPreferences: webPreferences(),
  });
  win.setMenuBarVisibility(false);
  const wc = win.webContents;
  lockDown(wc);

  const ui = fn => wc.executeJavaScript(`window.__xboxplayUI && window.__xboxplayUI.${fn}()`).catch(() => {});
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const k = i.key;
    if (k === 'F1') ui('guide');
    else if (k === 'F2') wc.executeJavaScript('window.__xboxplayMKB && window.__xboxplayMKB.toggle()').catch(() => {});
    else if (k === 'F3') ui('settings');
    else if (k === 'F5') wc.reload();
    else if (k === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (DEBUG && (k === 'F12' || (i.control && i.shift && k.toLowerCase() === 'i'))) wc.toggleDevTools();
    else return;
    e.preventDefault();
  });
  wc.on('console-message', (e, ...a) => { const m = e.message || (typeof a[1] === 'string' ? a[1] : ''); if (DEBUG || m.startsWith('[XboxPlay]')) console.log('[page]', m.slice(0, 300)); });

  // Xbox is moving people to play.xbox.com. Its redirect from xbox.com/<locale>/play can land on an
  // "Invalid URL" / "Bad Request" page, so go to the new site's home instead and retry once or twice.
  wc.on('will-redirect', (e, url) => {
    if (/^https:\/\/play\.xbox\.com\/[a-z]{2}-[a-z]{2}\/play\/?$/i.test(url)) {
      e.preventDefault(); log('redirected to play.xbox.com (preview site)');
      setTimeout(() => wc.loadURL('https://play.xbox.com/'), 1500);
    }
  });
  let retries = 0;
  wc.on('did-finish-load', () => setTimeout(() => {
    if (wc.getURL().includes('play.xbox.com') && /Bad Request|Invalid URL/i.test(wc.getTitle()) && retries++ < 2) wc.loadURL('https://play.xbox.com/');
  }, 1500));

  wc.loadURL(process.env.XBOXPLAY_URL && isAllowedUrl(process.env.XBOXPLAY_URL) ? process.env.XBOXPLAY_URL : START);
  return win;
}

app.on('web-contents-created', (e, wc) => wc.on('will-attach-webview', ev => ev.preventDefault()));
app.whenReady().then(async () => { await loadBX(); createWindow(); });
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => app.quit());
module.exports = { createWindow };
