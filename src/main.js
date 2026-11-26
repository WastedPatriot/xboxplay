'use strict';
const { app, BrowserWindow, session, net, shell, ipcMain, webContents, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { INJECT_HOSTS, ALLOWED_PERMISSIONS, BX, isAllowedUrl, safeUrl } = require('./config');
const { loadKeymap } = require('./keymap');
const { listInputDevices, summarizeDevices, resolveController, readControllerSetting, writeControllerSetting, normalizeController } = require('./input-devices');
const { readSession, writeSession, eraseSession, validSession } = require('./session-file');

const START = 'https://www.xbox.com/play';
const DEBUG = process.env.XBOXPLAY_DEBUG === '1';
const PARTITION = 'persist:xbox';
// xbox.com blocks unknown browsers, so present as plain Chrome on Linux (same engine version).
const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
const log = (...a) => console.log('[XboxPlay]', ...a);
let controllerMode = 'auto';
let lastDeviceLog = '';

function broadcast(code) {
  for (const wc of webContents.getAllWebContents()) {
    try { wc.executeJavaScript(code).catch(() => {}); } catch {}
  }
}
function deviceSummary() {
  try { return summarizeDevices(listInputDevices()); }
  catch { return { wired: [], bluetooth: [], scanned: false }; }
}
function publishDevices() {
  const summary = deviceSummary();
  const payload = JSON.stringify(summary);
  if (payload !== lastDeviceLog) {
    lastDeviceLog = payload;
    const found = (summary.wired || []).concat(summary.bluetooth || []);
    log(found.length ? 'controllers: ' + found.join(', ') : 'no wired or Bluetooth controller seen');
  }
  broadcast('window.__XBOXPLAY_DEVICES=' + payload + '; if (window.__xboxplayUI && window.__xboxplayUI.controllerHint) window.__xboxplayUI.controllerHint();');
}
function frameOk(e) {
  try { return isAllowedUrl(e.senderFrame && e.senderFrame.url); } catch { return false; }
}

app.setName('XboxPlay');
// WM_CLASS. The desktop file's StartupWMClass is the same string, so the menu entry and the window are one app.
if (process.platform === 'linux') app.commandLine.appendSwitch('class', 'XboxPlay');
app.userAgentFallback = CHROME_UA;
if (process.env.XBOXPLAY_SAFE === '1') app.disableHardwareAcceleration();
else {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  // Hardware decode on Linux. The GL path is the safe one. Zero-copy and the
  // driver bypass help some GPUs and black-screen others, so they stay opt-in.
  let video = 'AcceleratedVideoDecodeLinuxGL,VaapiVideoDecoder';
  if (process.env.XBOXPLAY_VAAPI === '1') video += ',AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiIgnoreDriverChecks,VaapiOnNvidiaGPUs';
  app.commandLine.appendSwitch('enable-features', video);
}
// A stream dies if Chromium decides the window is in the background.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'IntensiveWakeUpThrottling,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

// ---- injected scripts ----------------------------------------------------
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const OWN_SCRIPTS = [{ name: 'session', code: read('session.js') }, { name: 'stream', code: read('stream.js') }, { name: 'overlay', code: read('overlay.js') }, { name: 'pads', code: read('pads.js') }, { name: 'mkb', code: read('mkb.js') }, { name: 'idle', code: read('idle.js') }];
const sens = parseFloat(process.env.XBOXPLAY_SENS);
if (sens > 0) OWN_SCRIPTS.unshift({ name: 'sens', code: `window.__XBOXPLAY_SENS=${JSON.stringify(String(sens))}` });
if (process.env.XBOXPLAY_QUALITY) OWN_SCRIPTS.unshift({ name: 'quality', code: 'window.__XBOXPLAY_QUALITY=' + JSON.stringify(String(process.env.XBOXPLAY_QUALITY)) + ';' });
if (DEBUG) OWN_SCRIPTS.unshift({ name: 'debug', code: 'window.__XBOXPLAY_DEBUG=1' });

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
  try { wc.setBackgroundThrottling(false); } catch {}
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
  wc.on('did-create-window', w => { lockDown(w.webContents); armClose(w); });
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
  wc.setAudioMuted(false);
  lockDown(wc);

  const ui = fn => wc.executeJavaScript(`window.__xboxplayUI && window.__xboxplayUI.${fn}()`).catch(() => {});
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const k = i.key;
    if (k === 'F1') ui('guide');
    else if (k === 'F2') wc.executeJavaScript('window.__xboxplayMKB && window.__xboxplayMKB.toggle()').catch(() => {});
    else if (k === 'F3') ui('settings');
    else if (k === 'F4') wc.executeJavaScript('window.__xboxplayPads && window.__xboxplayPads.reattach && window.__xboxplayPads.reattach("manual")').catch(() => {});
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
  wc.on('did-finish-load', () => {
    wc.setAudioMuted(false);
    publishDevices();
    setTimeout(() => {
      if (wc.getURL().includes('play.xbox.com') && /Bad Request|Invalid URL/i.test(wc.getTitle()) && retries++ < 2) wc.loadURL('https://play.xbox.com/');
    }, 1500);
  });

  const kickPads = () => {
    try {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript('window.__xboxplayPads && window.__xboxplayPads.reattach && window.__xboxplayPads.reattach()').catch(() => {});
    } catch {}
  };
  win.on('focus', kickPads);
  win.on('restore', kickPads);
  win.on('show', kickPads);
  armClose(win);
  wc.loadURL(process.env.XBOXPLAY_URL && isAllowedUrl(process.env.XBOXPLAY_URL) ? process.env.XBOXPLAY_URL : START);
  return win;
}

const XBOX_ORIGINS = ['https://www.xbox.com', 'https://play.xbox.com'];
async function clearStreamCaches(ses, http) {
  if (!ses) return;
  if (http) { try { await ses.clearCache(); } catch { log('could not clear the http cache'); } }
  for (const origin of XBOX_ORIGINS) {
    try { await ses.clearStorageData({ origin, storages: ['serviceworkers', 'cachestorage'] }); }
    catch { log('could not clear the site cache'); }
  }
}
async function stopSavedSession() {
  let dir = '';
  try { dir = app.getPath('userData'); } catch { return false; }
  const saved = readSession(dir);
  if (!saved) return false;
  try {
    const r = await net.fetch(saved.stopUrl, { method: 'DELETE', headers: { Authorization: saved.authorization } });
    eraseSession(dir);
    log(r.ok || r.status === 404 ? 'stopped the console session' : 'console session stop returned ' + r.status);
    return !!(r.ok || r.status === 404);
  } catch {
    log('could not stop the console session');
    return false;
  }
}
let ended = null;
function endConsoleSession() {
  if (ended) return ended;
  const pages = webContents.getAllWebContents().filter(wc => { try { return !wc.isDestroyed(); } catch { return false; } });
  ended = (async () => {
    await Promise.race([
      Promise.all(pages.map(wc => wc.executeJavaScript('window.__xboxplaySession ? window.__xboxplaySession.stop() : false', true).catch(() => false))),
      new Promise(r => setTimeout(r, 2000)),
    ]);
    await Promise.race([stopSavedSession(), new Promise(r => setTimeout(r, 2000))]);
  })();
  return ended;
}
function armClose(win) {
  win.on('close', (e) => {
    if (win.__xboxplayGone) return;
    e.preventDefault();
    win.__xboxplayGone = true;
    const finish = () => { try { if (!win.isDestroyed()) win.destroy(); } catch {} };
    const timer = setTimeout(finish, 2500);
    endConsoleSession().finally(() => { clearTimeout(timer); finish(); });
  });
}

ipcMain.handle('xboxplay:session-note', (e, info) => {
  if (!frameOk(e)) return false;
  let dir = '';
  try { dir = app.getPath('userData'); } catch { return false; }
  if (info == null) { eraseSession(dir); return true; }
  if (!validSession(info)) return false;
  return writeSession(dir, info);
});
ipcMain.handle('xboxplay:clear-stream-cache', async (e) => {
  if (!frameOk(e)) return false;
  try { await clearStreamCaches(e.sender.session, false); return true; }
  catch { return false; }
});

ipcMain.handle('xboxplay:controller-set', (e, mode) => {
  if (!frameOk(e)) return controllerMode;
  const next = normalizeController(mode);
  if (!next) return controllerMode;
  controllerMode = next;
  try { writeControllerSetting(app.getPath('userData'), next); }
  catch { log('could not save controller choice'); }
  broadcast('window.__XBOXPLAY_CONTROLLER=' + JSON.stringify(next) + ';');
  publishDevices();
  return next;
});

app.on('web-contents-created', (e, wc) => wc.on('will-attach-webview', ev => ev.preventDefault()));
app.whenReady().then(async () => {
  const loaded = loadKeymap(app.getPath('userData'));
  if (loaded.error) log('keymap.json ignored (' + loaded.error + '), using defaults');
  OWN_SCRIPTS.unshift({ name: 'keymap', code: 'window.__XBOXPLAY_KEYMAP=' + JSON.stringify(loaded.map) + ';' });
  const saved = readControllerSetting(app.getPath('userData'));
  const choice = resolveController({ argv: process.argv, env: process.env, saved });
  controllerMode = choice.mode;
  if (choice.source === 'flag' || choice.source === 'env') {
    try { writeControllerSetting(app.getPath('userData'), choice.mode); } catch {}
  }
  OWN_SCRIPTS.unshift({ name: 'controller', code: 'window.__XBOXPLAY_CONTROLLER=' + JSON.stringify(choice.mode) + ';' });
  if (choice.source !== 'default') log('controller:', choice.mode);
  await loadBX();
  const ses = session.fromPartition(PARTITION);
  await stopSavedSession();
  await clearStreamCaches(ses, true);
  log('cleared the xbox.com site cache');
  createWindow();
  try { powerSaveBlocker.start('prevent-display-sleep'); }
  catch { log('could not keep the display awake'); }
  publishDevices();
  setInterval(publishDevices, 2000);
});
function nudgePicture(win) {
  if (!win) return;
  try {
    const [w, h] = win.getSize();
    win.setSize(w, Math.max(1, h + 1));
    setTimeout(() => { try { if (!win.isDestroyed()) win.setSize(w, h); } catch {} }, 50);
  } catch {}
  try {
    const wc = win.webContents;
    if (wc && !wc.isDestroyed()) wc.executeJavaScript('window.__xboxplayStream && window.__xboxplayStream.nudge && window.__xboxplayStream.nudge()').catch(() => {});
  } catch {}
}
function raiseWindow(win) {
  if (!win) return;
  try { if (win.isDestroyed()) return; } catch { return; }
  try { if (win.isMinimized()) win.restore(); } catch {}
  try { win.show(); } catch {}
  try { win.moveTop(); } catch {}
  try { win.setAlwaysOnTop(true); win.setAlwaysOnTop(false); } catch {}
  try { win.focus(); } catch {}
  try { app.focus({ steal: true }); } catch {}
  nudgePicture(win);
  try {
    const wc = win.webContents;
    if (wc && !wc.isDestroyed()) wc.executeJavaScript('window.__xboxplayPads && window.__xboxplayPads.reattach && window.__xboxplayPads.reattach()').catch(() => {});
  } catch {}
  log('raised the open window');
}
app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows().filter(w => { try { return !w.isDestroyed(); } catch { return false; } });
  if (wins[0]) raiseWindow(wins[0]);
});
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  const open = BrowserWindow.getAllWindows().filter(w => { try { return !w.isDestroyed() && !w.__xboxplayGone; } catch { return false; } });
  if (!open.length) return;
  e.preventDefault();
  quitting = true;
  const finish = () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.__xboxplayGone = true;
      try { if (!w.isDestroyed()) w.destroy(); } catch {}
    }
    app.quit();
  };
  const timer = setTimeout(finish, 2500);
  endConsoleSession().finally(() => { clearTimeout(timer); finish(); });
});
app.on('window-all-closed', () => app.quit());
module.exports = { createWindow };
