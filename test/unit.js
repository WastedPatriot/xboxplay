// Headless unit tests for the keyboard/mouse layer and audio startup. Run: node test/unit.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { parseBitmap, listInputDevices, summarizeDevices, resolveController, readControllerSetting, writeControllerSetting } = require('../src/input-devices');

let failed = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const autoplayAt = mainSrc.indexOf("appendSwitch('autoplay-policy', 'no-user-gesture-required')");
const readyAt = mainSrc.indexOf('app.whenReady()');
check(autoplayAt >= 0 && autoplayAt < readyAt, 'autoplay-policy is set before app ready');
check(/setAudioMuted\(\s*false\s*\)/.test(mainSrc), 'webContents is explicitly unmuted');
const cfg = fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8');
check(cfg.includes("'media'") && cfg.includes('speaker-selection'), 'media and speaker-selection are allowed');
check(mainSrc.includes("OWN_SCRIPTS.unshift({ name: 'debug'"), 'debug flag is injected when XBOXPLAY_DEBUG=1');
check(mainSrc.includes("appendSwitch('class', 'XboxPlay')"), 'the window class is XboxPlay, matching the desktop file');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
check(pkg.productName === 'XboxPlay' && pkg.desktopName === 'XboxPlay.desktop' && pkg.version === '1.1.0', 'package name, desktop name, and version');
const builder = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');
check(builder.includes('AppImage') && builder.includes('deb') && builder.includes('rpm'), 'electron-builder targets AppImage, deb, and rpm');
check(builder.includes('Keywords: xbox;cloud;gaming;remote;play;') && builder.includes('StartupWMClass: XboxPlay'), 'the packaged desktop entry is searchable as XboxPlay');
const flatpakDesktop = fs.readFileSync(path.join(__dirname, '../flatpak/com.wastedpatriot.XboxPlay.desktop'), 'utf8');
check(flatpakDesktop.includes('Name=XboxPlay') && flatpakDesktop.includes('Keywords=xbox;cloud;gaming;remote;play;') && flatpakDesktop.includes('StartupWMClass=XboxPlay') && flatpakDesktop.includes('Terminal=false'), 'the Flatpak desktop entry matches');
check(mainSrc.includes("name: 'stream'"), 'stream helper is injected');
check(mainSrc.includes('backgroundThrottling: false'), 'the page is not background-throttled');
check(mainSrc.includes('disable-background-timer-throttling') && mainSrc.includes('disable-renderer-backgrounding') && mainSrc.includes('disable-backgrounding-occluded-windows'), 'Chromium is told not to throttle a covered window');
check(mainSrc.includes("powerSaveBlocker.start('prevent-display-sleep')"), 'the display is kept awake');
const safeAt = mainSrc.indexOf("XBOXPLAY_SAFE === '1'");
const vaAt = mainSrc.indexOf('AcceleratedVideoDecodeLinuxGL');
check(safeAt >= 0 && vaAt > safeAt && mainSrc.includes('XBOXPLAY_VAAPI'), 'VA-API decode is requested only when GPU acceleration is on');

const mkbSrc = fs.readFileSync(path.join(__dirname, '../src/mkb.js'), 'utf8');

function makeEnv() {
  const listeners = { window: {}, document: {} };
  const add = (target, type, fn) => { (listeners[target][type] ||= []).push(fn); };
  const fire = (target, type, ev) => {
    ev.type = ev.type || type;
    if (ev.timeStamp == null) ev.timeStamp = performance.now();
    ev.preventDefault = ev.preventDefault || (() => { ev.prevented = true; });
    ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev.stopped = true; });
    for (const fn of listeners[target][type] || []) { fn(ev); if (ev.stopped) break; }
    return ev;
  };
  const store = {};
  const videos = [{ tagName: 'VIDEO', getBoundingClientRect: () => ({ width: 1280, height: 720 }), readyState: 4, srcObject: { active: true }, muted: true, play: () => Promise.resolve() }];
  let pointerLockElement = null;
  const body = {
    requestPointerLock(opts) {
      if (opts && opts.unadjustedMovement) {
        if (document._throwUnadjusted) throw new Error('unadjustedMovement not supported');
        if (document._rejectUnadjusted) return Promise.reject(new Error('unadjustedMovement unavailable'));
      }
      pointerLockElement = body;
      fire('document', 'pointerlockchange', {});
      return Promise.resolve();
    },
  };
  const document = {
    readyState: 'complete', hidden: false, body, documentElement: body,
    exitPointerLock() { pointerLockElement = null; fire('document', 'pointerlockchange', {}); },
    querySelectorAll() { return videos; },
    querySelector() { return videos[0]; },
    addEventListener(type, fn) { add('document', type, fn); },
    get pointerLockElement() { return pointerLockElement; },
    _throwUnadjusted: false, _rejectUnadjusted: false,
  };
  const pads = { list: [] };
  function Navigator() {}
  Navigator.prototype.getGamepads = function () { return pads.list; };
  function Gamepad() {}
  const windowObj = {
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
    },
    addEventListener(type, fn) { add('window', type, fn); },
    dispatchEvent(e) { fire('window', e.type || 'event', e); return true; },
    __xboxplayUI: { toast() {}, badge() {} },
  };
  const navigator = new Navigator();
  windowObj.navigator = navigator;
  const ctx = {
    window: windowObj, document, navigator, Navigator, Gamepad, Event, console,
    setTimeout, clearTimeout, setInterval, clearInterval, performance,
    Object, Array, Math, Number, String, Set, Map, Error, TypeError, JSON, parseFloat, innerWidth: 1280, innerHeight: 800,
  };
  ctx._fire = (type, ev) => fire('window', type, ev);
  ctx._fireDoc = (type, ev) => fire('document', type, ev);
  ctx._doc = document;
  ctx._store = store;
  ctx._pads = pads;
  return ctx;
}

function load() {
  const ctx = makeEnv();
  ctx._store['xboxplay.mkb'] = '1';
  ctx._store['xboxplay.smooth'] = '0';
  ctx._store['xboxplay.autoSwitch'] = '1';
  ctx._store['xboxplay.sens'] = '1';
  ctx._store['xboxplay.trackpad'] = '1';
  vm.createContext(ctx);
  vm.runInContext(mkbSrc, ctx);
  const M = vm.runInContext('window.__xboxplayMKB', ctx);
  M.enabled = true;
  M.forceActive = true;
  M.setMode('foot', true);
  ctx._doc.body.requestPointerLock();
  return { ctx, M, gp() { return vm.runInContext('[...navigator.getGamepads()].find(g => g && g.id.includes("XInput"))', ctx); } };
}

function key(ctx, type, code, extra) { return ctx._fire(type, { code, repeat: false, ...(extra || {}) }); }

function fakeInput(root) {
  const dev = path.join(root, 'dev0');
  const parent = path.join(root, 'parent');
  const driver = path.join(root, 'drivers', 'xpad');
  fs.mkdirSync(path.join(dev, 'id'), { recursive: true });
  fs.mkdirSync(path.join(dev, 'capabilities'), { recursive: true });
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(driver, { recursive: true });
  fs.writeFileSync(path.join(dev, 'name'), '8BitDo Ultimate 2C\n');
  fs.writeFileSync(path.join(dev, 'phys'), 'usb-0000:00:14.0-1/input0\n');
  fs.writeFileSync(path.join(dev, 'id/bustype'), '0003\n');
  fs.writeFileSync(path.join(dev, 'id/vendor'), '2dc8\n');
  fs.writeFileSync(path.join(dev, 'id/product'), '310a\n');
  // BTN_A is bit 304. On a 64-bit bitmap that is word 4, bit 48.
  fs.writeFileSync(path.join(dev, 'capabilities/key'), '1000000000000 0 0 0 0\n');
  fs.writeFileSync(path.join(dev, 'capabilities/abs'), '1\n');
  fs.symlinkSync(driver, path.join(parent, 'driver'));
  fs.symlinkSync(parent, path.join(dev, 'device'));
  const js = path.join(root, 'class', 'js0');
  fs.mkdirSync(js, { recursive: true });
  fs.symlinkSync(dev, path.join(js, 'device'));
  const bt = path.join(root, 'bt0');
  fs.mkdirSync(path.join(bt, 'id'), { recursive: true });
  fs.mkdirSync(path.join(bt, 'capabilities'), { recursive: true });
  fs.mkdirSync(path.join(root, 'drivers', 'xpadneo'), { recursive: true });
  fs.writeFileSync(path.join(bt, 'name'), 'Xbox Wireless Controller\n');
  fs.writeFileSync(path.join(bt, 'phys'), 'bluetooth\n');
  fs.writeFileSync(path.join(bt, 'id/bustype'), '0005\n');
  fs.writeFileSync(path.join(bt, 'id/vendor'), '045e\n');
  fs.writeFileSync(path.join(bt, 'id/product'), '0b13\n');
  fs.writeFileSync(path.join(bt, 'capabilities/key'), '1000000000000 0 0 0 0\n');
  const btParent = path.join(root, 'bt-parent');
  fs.mkdirSync(btParent, { recursive: true });
  fs.symlinkSync(path.join(root, 'drivers', 'xpadneo'), path.join(btParent, 'driver'));
  fs.symlinkSync(btParent, path.join(bt, 'device'));
  const ev = path.join(root, 'class', 'event3');
  fs.mkdirSync(ev, { recursive: true });
  fs.symlinkSync(bt, path.join(ev, 'device'));
  const keys = path.join(root, 'keys0');
  fs.mkdirSync(path.join(keys, 'id'), { recursive: true });
  fs.mkdirSync(path.join(keys, 'capabilities'), { recursive: true });
  fs.writeFileSync(path.join(keys, 'name'), 'Keyboard\n');
  fs.writeFileSync(path.join(keys, 'id/bustype'), '0003\n');
  fs.writeFileSync(path.join(keys, 'capabilities/key'), '0\n');
  const keyEv = path.join(root, 'class', 'event9');
  fs.mkdirSync(keyEv, { recursive: true });
  fs.symlinkSync(keys, path.join(keyEv, 'device'));
  return path.join(root, 'class');
}

(async () => {
  check(parseBitmap('1000000000000 0 0 0 0', 64).has(0x130), 'capability bitmap bit 304 is BTN_A');
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xboxplay-input-'));
    const found = listInputDevices(fakeInput(root), { bitsPerWord: 64 });
    const pad = found.find(d => d.vendor === 0x2dc8);
    check(!!pad && pad.kind === 'wired' && pad.product === 0x310a && pad.driver === 'xpad' && pad.name === '8BitDo Ultimate 2C',
      '8BitDo Ultimate 2C USB 2dc8:310a on xpad is a wired controller');
    const bt = found.find(d => d.driver === 'xpadneo');
    check(!!bt && bt.kind === 'bluetooth', 'xpadneo pad is Bluetooth');
    check(!found.some(d => d.name === 'Keyboard'), 'a plain keyboard is not a controller');
    const summary = summarizeDevices(found);
    check(summary.scanned && summary.wired.length === 1 && summary.bluetooth.length === 1, 'wired and Bluetooth are reported separately');
    fs.rmSync(root, { recursive: true, force: true });
  }
  check(Array.isArray(listInputDevices('/sys/class/input')), 'scanning /sys/class/input does not throw');
  {
    const choice = resolveController({ argv: ['--controller', 'wired'], env: { XBOXPLAY_CONTROLLER: 'bluetooth' }, saved: 'keyboard' });
    check(choice.mode === 'wired' && choice.source === 'flag', 'the --controller flag wins');
    check(resolveController({ argv: [], env: { XBOXPLAY_CONTROLLER: 'bt' }, saved: 'keyboard' }).mode === 'bluetooth', 'XBOXPLAY_CONTROLLER is accepted');
    check(resolveController({ argv: [], env: {}, saved: 'keyboard' }).mode === 'keyboard', 'a saved choice is used');
    check(resolveController({ argv: [], env: {}, saved: '' }).mode === 'auto', 'the default is auto');
    check(resolveController({ argv: ['--controller=usb'], env: {}, saved: '' }).mode === 'wired', '--controller=usb means wired');
  }
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xboxplay-settings-'));
    check(readControllerSetting(dir) === '', 'a missing settings file is unset');
    check(writeControllerSetting(dir, 'wired') === true && readControllerSetting(dir) === 'wired', 'the controller choice is saved');
    check(writeControllerSetting(dir, 'nope') === false && readControllerSetting(dir) === 'wired', 'a bad choice is not saved');
    const real = path.join(dir, 'real.json');
    fs.writeFileSync(real, '{"controller":"wired","other":1}\n');
    fs.unlinkSync(path.join(dir, 'settings.json'));
    fs.symlinkSync('real.json', path.join(dir, 'settings.json'));
    check(readControllerSetting(dir) === '' && writeControllerSetting(dir, 'bluetooth') === false, 'a symlink settings file is ignored');
    check(fs.readFileSync(real, 'utf8').includes('"controller":"wired"'), 'the symlink target is left alone');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- V: one Y press per physical tap, held at least 60ms, short tap toggles ---
  {
    const { ctx, M, gp } = load();
    key(ctx, 'keydown', 'KeyV');
    check(gp().buttons[3].pressed, 'V down presses Y');
    key(ctx, 'keydown', 'KeyV', { repeat: true });
    check(gp().buttons[3].pressed && gp().buttons[3].value === 1, 'V key repeat does not re-press or release Y');
    key(ctx, 'keyup', 'KeyV');
    check(gp().buttons[3].pressed, 'Y stays pressed after a short V release');
    check(M.mode === 'foot', 'mode does not flip until the 60ms hold ends');
    await sleep(90);
    check(!gp().buttons[3].pressed, 'Y releases after at least 60ms');
    check(M.mode === 'drive', 'short V tap switches to driving');
  }

  // --- V: a hold is just Y, no layout toggle ---
  {
    const { ctx, M, gp } = load();
    key(ctx, 'keydown', 'KeyV');
    await sleep(450);
    check(gp().buttons[3].pressed, 'held V keeps Y down');
    key(ctx, 'keyup', 'KeyV');
    await sleep(20);
    check(!gp().buttons[3].pressed && M.mode === 'foot', 'holding V over 400ms does not toggle the layout');
  }

  // --- Phone mode ---
  {
    const { ctx, M, gp } = load();
    key(ctx, 'keydown', 'ArrowUp');
    check(M.phone && gp().buttons[12].pressed, 'up arrow opens phone mode and presses D-pad up');
    key(ctx, 'keyup', 'ArrowUp');
    const ev = ctx._fire('wheel', { deltaY: 80, deltaX: 0 });
    check(ev.prevented && gp().buttons[13].pressed, 'in phone mode, wheel down is D-pad down and is consumed');
    await sleep(90);
    check(!gp().buttons[13].pressed, 'phone-mode wheel press is released after a short click');
    ctx._fire('mousedown', { button: 0 });
    check(gp().buttons[0].pressed && !gp().buttons[7].pressed, 'in phone mode, left click is A, not RT');
    ctx._fire('mouseup', { button: 0 });
    ctx._fire('mousedown', { button: 2 });
    check(gp().buttons[1].pressed, 'in phone mode, right click is B');
    ctx._fire('mouseup', { button: 2 });
    check(!M.phone, 'right click closes the phone');
    key(ctx, 'keydown', 'ArrowUp');
    key(ctx, 'keyup', 'ArrowUp');
    key(ctx, 'keydown', 'KeyC');
    key(ctx, 'keyup', 'KeyC');
    check(!M.phone, 'C closes the phone');
  }

  // --- Wheel is ignored outside phone mode (two-finger trackpad scroll) ---
  {
    const { ctx, M, gp } = load();
    const ev = ctx._fire('wheel', { deltaY: -80, deltaX: 0 });
    check(!M.phone && !ev.prevented && !gp().buttons[12].pressed && !gp().buttons[13].pressed,
      'wheel outside phone mode is not eaten and does not press the D-pad');
  }

  // --- Focus loss releases everything ---
  {
    const { ctx, M, gp } = load();
    key(ctx, 'keydown', 'KeyW');
    key(ctx, 'keydown', 'ArrowUp');
    await sleep(20);
    check(M.phone, 'phone is open before blur');
    ctx._fire('blur', {});
    await sleep(20);
    const p = gp();
    check(!M.phone && !p.buttons[0].pressed && p.buttons[7].value === 0 && p.axes[0] === 0,
      'blur releases keys and leaves phone mode');
  }
  {
    const { ctx, M, gp } = load();
    key(ctx, 'keydown', 'ArrowUp');
    key(ctx, 'keydown', 'KeyD');
    ctx._doc.hidden = true;
    ctx._fireDoc('visibilitychange', {});
    const p = gp();
    check(!M.phone && p.axes[0] === 0, 'visibilitychange releases keys and leaves phone mode');
  }

  // --- Driving: W/S and mouse clicks take the max, they don't fight ---
  {
    const { ctx, M, gp } = load();
    M.setMode('drive', true);
    key(ctx, 'keydown', 'KeyW');
    ctx._fire('mousedown', { button: 0 });
    await sleep(20);
    check(gp().buttons[7].value === 1, 'driving: W and left click together stay at full RT');
    ctx._fire('mouseup', { button: 0 });
    key(ctx, 'keyup', 'KeyW');
    key(ctx, 'keydown', 'KeyS');
    ctx._fire('mousedown', { button: 2 });
    await sleep(20);
    check(gp().buttons[6].value === 1, 'driving: S and right click together stay at full LT');
  }

  // --- Trackpad: fractional deltas accumulate, no deadzone ---
  {
    const { ctx, gp } = load();
    ctx._fire('mousemove', { movementX: 0.25, movementY: 0, timeStamp: 1 });
    ctx._fire('pointermove', { movementX: 0.25, movementY: 0, timeStamp: 1 }); // same event, must not double
    await sleep(20);
    const first = gp().axes[2];
    check(first > 0, 'fractional trackpad delta reaches the look stick (no deadzone), got ' + first);
    ctx._fire('mousemove', { movementX: 0.25, movementY: 0, timeStamp: 2 });
    await sleep(20);
    check(gp().axes[2] > 0, 'a second tiny trackpad delta is not swallowed');
  }

  // --- Phone mode pauses mouse look ---
  {
    const { ctx, gp } = load();
    key(ctx, 'keydown', 'ArrowUp');
    key(ctx, 'keyup', 'ArrowUp');
    ctx._fire('mousemove', { movementX: 40, movementY: 10, timeStamp: 3 });
    await sleep(20);
    check(gp().axes[2] === 0 && gp().axes[3] === 0, 'mouse look is paused in phone mode');
  }

  // --- Pointer lock: unadjustedMovement failure falls back and still locks ---
  {
    const { ctx, M } = load();
    M.forceActive = false;
    ctx._doc.exitPointerLock();
    ctx._doc._rejectUnadjusted = true;
    ctx._fire('mousedown', { button: 0 });
    await sleep(30);
    check(!!ctx._doc.pointerLockElement, 'requestPointerLock falls back when unadjustedMovement rejects');
  }
  {
    const { ctx, M } = load();
    M.forceActive = false;
    ctx._doc.exitPointerLock();
    ctx._doc._throwUnadjusted = true;
    ctx._fire('mousedown', { button: 0 });
    await sleep(20);
    check(!!ctx._doc.pointerLockElement, 'requestPointerLock falls back when unadjustedMovement throws');
  }

  // --- Small trackpad move clears the game deadzone; Shift taps A; Space jumps ---
  {
    const { ctx, M, gp } = load();
    ctx._fire('mousemove', { movementX: 1, movementY: 0, timeStamp: 11 });
    await sleep(12);
    check(gp().axes[2] >= 0.2, 'a 1px trackpad move gets past the stick deadzone, got ' + gp().axes[2]);
    await sleep(200);
    check(gp().axes[2] === 0, 'look stick returns to centre after the move');
    key(ctx, 'keydown', 'ShiftLeft');
    check(gp().buttons[10].pressed && !gp().buttons[0].pressed, 'holding Shift holds L3 to sprint');
    key(ctx, 'keyup', 'ShiftLeft');
    key(ctx, 'keydown', 'Space');
    check(gp().buttons[0].pressed, 'Space is A (jump) on foot, as in GTA 6');
    key(ctx, 'keyup', 'Space');
    key(ctx, 'keydown', 'KeyC');
    check(gp().buttons[1].pressed, 'C is B (crouch)');
    key(ctx, 'keyup', 'KeyC');
    key(ctx, 'keydown', 'KeyE');
    check(gp().buttons[3].pressed, 'E is Y (interact)');
    key(ctx, 'keyup', 'KeyE');
    key(ctx, 'keydown', 'KeyT');
    check(gp().buttons[10].pressed && gp().buttons[11].pressed, 'T is Focus (L3 + R3)');
    key(ctx, 'keyup', 'KeyT');
  }

  // A real controller is returned on its own. Keyboard mode is the way to force the virtual pad.
  {
    const { ctx } = load();
    ctx._pads.list = [{ id: '8BitDo Ultimate 2C (Vendor: 2dc8 Product: 310a)', connected: true, mapping: 'standard', index: 0, buttons: [], axes: [0, 0, 0, 0] }];
    const ids = vm.runInContext('[...navigator.getGamepads()].filter(Boolean).map(g => g.id)', ctx);
    check(ids.length === 1 && ids[0].includes('8BitDo') && !ids.some(id => id.includes('XInput')), 'a real pad is returned on its own, with no virtual pad');
    ctx.window.__XBOXPLAY_CONTROLLER = 'wired';
    const wired = vm.runInContext('[...navigator.getGamepads()].filter(Boolean).map(g => g.id)', ctx);
    check(wired.length === 1 && wired[0].includes('2dc8'), 'wired mode still passes the real controller through');
    ctx.window.__XBOXPLAY_CONTROLLER = 'keyboard';
    const forced = vm.runInContext('[...navigator.getGamepads()].filter(Boolean).map(g => g.id)', ctx);
    check(forced.length === 1 && forced[0].includes('XInput') && !forced.some(id => id.includes('8BitDo')), 'keyboard mode forces the virtual pad even if a controller is plugged in');
    ctx._pads.list = [];
    ctx.window.__XBOXPLAY_CONTROLLER = 'auto';
    const virt = vm.runInContext('[...navigator.getGamepads()].filter(Boolean).map(g => g.id)', ctx);
    check(virt.length === 1 && virt[0].includes('XInput'), 'with no controller plugged in, the keyboard pad is used');
  }

  // Stream quality, stats, and reconnect. The page script is loaded on its own so it can wrap RTCPeerConnection.
  {
    const store = {};
    const clicks = [];
    const button = { tagName: 'BUTTON', textContent: 'Reconnect', click() { clicks.push('reconnect'); } };
    const resume = { tagName: 'BUTTON', textContent: 'Resume', click() { clicks.push('resume'); } };
    function OrigPC() {
      this.iceConnectionState = 'new';
      this.connectionState = 'new';
      this.local = null;
      this.receivers = [{ track: { kind: 'video' }, playoutDelayHint: 1 }];
      this.restarted = 0;
    }
    OrigPC.prototype.setLocalDescription = function (desc) { this.local = desc; return Promise.resolve(); };
    OrigPC.prototype.setRemoteDescription = function (desc) { this.remote = desc; return Promise.resolve(); };
    OrigPC.prototype.getReceivers = function () { return this.receivers; };
    OrigPC.prototype.addEventListener = function () {};
    OrigPC.prototype.restartIce = function () { this.restarted++; };
    OrigPC.prototype.getStats = function () { return Promise.resolve({ forEach() {} }); };
    const ctx = {
      window: {
        localStorage: {
          getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
          setItem(k, v) { store[k] = String(v); },
        },
        RTCPeerConnection: OrigPC,
        __xboxplayUI: { toast() {}, streamStatus() {} },
      },
      document: {
        hidden: false,
        querySelectorAll(sel) { return String(sel).includes('button') ? [button, resume] : []; },
      },
      console, setTimeout, clearTimeout, setInterval, clearInterval,
      Map, Promise, Date, Math, Number, String, JSON,
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/stream.js'), 'utf8'), ctx);
    const api = vm.runInContext('window.__xboxplayStream', ctx);
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'c=IN IP4 0.0.0.0',
      'a=sendrecv',
      'b=AS:64',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'c=IN IP4 0.0.0.0',
      'a=recvonly',
      'b=AS:20000',
      'b=TIAS:20000000',
      '',
    ].join('\r\n');
    const capped = api.applyBitrate(sdp, 6000);
    check(capped.includes('b=AS:64') && capped.includes('b=AS:6000') && !capped.includes('b=AS:20000'), 'a video bandwidth cap replaces the video line and leaves audio alone');
    check(capped.includes('b=TIAS:6000000'), 'TIAS is kept in step with the video cap');
    check((capped.match(/b=AS:6000/g) || []).length === 1, 'the video cap is not written twice');
    check(api.applyBitrate(sdp, 0) === sdp, 'auto does not rewrite the offer');
    const bare = 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\na=recvonly\r\n';
    const added = api.applyBitrate(bare, 15000);
    check(added.indexOf('b=AS:15000') !== -1 && added.indexOf('b=AS:15000') < added.indexOf('a=recvonly'), 'a missing video cap is inserted before the attributes');
    const prev = { t: 1000, bytes: 0, recv: 0, lost: 0 };
    const sample = api.readStats([
      { type: 'inbound-rtp', kind: 'video', bytesReceived: 1000000, packetsReceived: 99, packetsLost: 1, timestamp: 2000, frameWidth: 1920, frameHeight: 1080, decoderImplementation: 'ExternalDecoder (VAAPI)' },
      { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.042 },
    ], prev);
    check(sample && Math.abs(sample.bitrateMbps - 8) < 0.01 && Math.abs(sample.lossPct - 1) < 0.01, 'bitrate and loss come from the video counters, got ' + (sample && sample.bitrateMbps) + ' / ' + (sample && sample.lossPct));
    check(sample.rttMs === 42 && sample.hardware && sample.width === 1920, 'round trip and a VA-API decoder are reported');
    check(api.healthOf(sample) === 'good', '42 ms and 1% loss is a good connection');
    check(api.healthOf({ rttMs: 90, lossPct: 0 }) === 'fair', 'delay around 90 ms is a fair connection');
    check(api.healthOf({ rttMs: 180, lossPct: 1 }) === 'poor', 'high delay is a poor connection');
    check(api.healthOf({ rttMs: 40, lossPct: 6 }) === 'poor', 'high packet loss is a poor connection');
    check(api.poorMessage({ rttMs: 180, lossPct: 6 }).includes('180 ms') && api.poorMessage({ rttMs: 180, lossPct: 6 }).includes('6% packet loss'), 'the poor-connection message names the delay and the loss');
    const h = { poorRun: 0, warned: false };
    check(api.noteHealth(h, 'poor') === false && api.noteHealth(h, 'poor') === true && api.noteHealth(h, 'poor') === false, 'the poor-connection warning fires once, after it stays poor');
    check(api.noteHealth(h, 'good') === false && api.noteHealth(h, 'poor') === false && api.noteHealth(h, 'poor') === true, 'recovery arms the warning again');
    const link = api.freshLink();
    check(api.onLinkState(link, 'disconnected', 1000) === 'ignore', 'a stream that never connected is not reconnected');
    check(api.onLinkState(link, 'connected', 0) === 'up', 'a connected stream is marked up');
    check(api.onLinkState(link, 'failed', 1000) === 'down', 'a failed stream is marked down');
    check(api.nextReconnect(link, 3000, true) === 'none', 'reconnect waits a few seconds');
    check(api.nextReconnect(link, 6000, true) === 'restart', 'the first reconnect restarts the network path');
    check(api.nextReconnect(link, 10000, true) === 'none', 'reconnect does not hammer');
    check(api.nextReconnect(link, 14000, true) === 'click' && api.nextReconnect(link, 22000, true) === 'click', 'later attempts click the page button');
    check(api.nextReconnect(link, 30000, true) === 'giveup', 'reconnect stops after three tries');
    const again = api.freshLink();
    api.onLinkState(again, 'connected', 0);
    api.onMedia(again, true, 1000);
    api.onMedia(again, false, 9000);
    check(api.nextReconnect(again, 12000, true) === 'click', 'video that stops arriving is treated as a dropped stream');
    check(api.nextReconnect(again, 20000, false) === 'none', 'reconnect can be turned off');
    const found = api.findReconnect(ctx.document);
    check(found === button, 'only a Reconnect button is clicked, not Resume');
    store['xboxplay.quality'] = 'stable';
    const pc = vm.runInContext('new window.RTCPeerConnection()', ctx);
    await vm.runInContext('pc.setLocalDescription({ type: "offer", sdp })', Object.assign(ctx, { pc, sdp }));
    check(pc.local && pc.local.sdp.includes('b=AS:6000') && !pc.local.sdp.includes('b=AS:20000'), 'stable quality rewrites the local offer');
    await vm.runInContext('pc.setRemoteDescription({ type: "answer", sdp: "v=0" })', ctx);
    check(pc.receivers[0].playoutDelayHint === 1, 'stable quality leaves the playback buffer alone');
    store['xboxplay.quality'] = 'auto';
    await vm.runInContext('pc.setRemoteDescription({ type: "answer", sdp: "v=0" })', ctx);
    check(pc.receivers[0].playoutDelayHint === 0, 'auto asks the playback buffer to stay short');
  }

  if (failed) {
    console.log(failed + ' failed');
    process.exit(1);
  }
  console.log('All unit tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
