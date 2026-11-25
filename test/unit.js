// Headless unit tests for the keyboard/mouse layer, keymap file, and audio startup. Run: node test/unit.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { DEFAULT_KEYMAP, ACTIONS, parseKeymap, loadKeymap } = require('../src/keymap');
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
check(mainSrc.includes('contextIsolation: true') && mainSrc.includes('nodeIntegration: false') && mainSrc.includes('sandbox: true'), 'renderer stays sandboxed');
check(mainSrc.includes("appendSwitch('class', 'XboxPlay')"), 'the window class is XboxPlay, matching the desktop file');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
check(pkg.version === '1.0.0' && pkg.productName === 'XboxPlay' && pkg.desktopName === 'XboxPlay.desktop', 'package version is 1.0.0 and the desktop name matches');
const releaseYml = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8');
check(releaseYml.includes("tags: ['v*']") && releaseYml.includes('AppImage') && releaseYml.includes('deb') && releaseYml.includes('rpm'), 'a v* tag builds an AppImage, a deb, and an rpm');
check(mainSrc.includes('loadKeymap') && mainSrc.includes('JSON.stringify(loaded.map)'), 'keymap is loaded locally and serialized into the page');

const mkbSrc = fs.readFileSync(path.join(__dirname, '../src/mkb.js'), 'utf8');
const overlaySrc = fs.readFileSync(path.join(__dirname, '../src/overlay.js'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
check(!/\bsetMode\b|\bphone\b|vTimer|autoSwitch|V_HOLD|DRIVE\b/.test(mkbSrc), 'old hold/mode scheme is gone from the input layer');
check(!/autoSwitch|Driving|on foot|GTA/.test(overlaySrc), 'guide no longer describes the old layouts');
check(overlaySrc.includes('I J K L') && overlaySrc.includes('Enter') && overlaySrc.includes("'='"), 'guide shows the new map');
check(overlaySrc.includes("row('LB', 'Q')") && overlaySrc.includes("row('RB', 'R')") && overlaySrc.includes("row('Left stick click', 'F')") && overlaySrc.includes("row('Right stick click', 'G', 'MMB')"), 'guide bumpers are Q and R, stick clicks are F and G');
check(readme.includes('| Left stick | W A S D |') && readme.includes('I J K L') && readme.includes('keymap.json'), 'readme table shows the new map');
check(readme.includes('| LB | Q |') && readme.includes('| RB | R |') && readme.includes('| Left stick click | F |') && readme.includes('| Right stick click | G, or the middle mouse button |'), 'readme bumpers are Q and R, stick clicks are F and G');
check(!/on foot|hold V|Auto-switch|Driving mode/i.test(readme), 'readme dropped the old scheme');
check(readme.includes('curl -fsSL https://raw.githubusercontent.com/WastedPatriot/xboxplay/main/install.sh | bash'), 'readme has the one-line install');
check(readme.includes('XboxPlay-1.0.0.AppImage') && readme.includes('8BitDo') && readme.includes('XBOXPLAY_SAFE=1'), 'readme covers the AppImage, controllers, and the GPU safe mode');
check(readme.includes("I'm still here"), 'readme mentions the idle prompt');
check(mainSrc.includes("name: 'stream'"), 'stream helper is injected');
check(mainSrc.includes("name: 'idle'") && mainSrc.indexOf("name: 'mkb'") < mainSrc.indexOf("name: 'idle'"), 'idle helper is injected after the gamepad script');
check(mainSrc.includes('backgroundThrottling: false'), 'the page is not background-throttled');
check(mainSrc.includes("name: 'session'") && mainSrc.indexOf("name: 'session'") < mainSrc.indexOf("name: 'stream'"), 'session helper is injected before the stream helper');
check(mainSrc.includes('serviceworkers') && mainSrc.includes('cachestorage') && mainSrc.includes('cleared the xbox.com site cache'), 'xbox.com service worker caches are cleared on startup');
check(mainSrc.includes('before-quit') && mainSrc.includes('__xboxplaySession'), 'closing the window stops the console session');
const preloadSrc = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
check(preloadSrc.includes('DOMContentLoaded') && preloadSrc.includes("name !== 'better-xcloud'"), 'better-xcloud waits until the document exists');
check(mainSrc.includes('disable-background-timer-throttling') && mainSrc.includes('disable-renderer-backgrounding') && mainSrc.includes('disable-backgrounding-occluded-windows'), 'Chromium is told not to throttle a covered window');
check(mainSrc.includes("powerSaveBlocker.start('prevent-display-sleep')"), 'the display is kept awake');
const safeAt = mainSrc.indexOf("XBOXPLAY_SAFE === '1'");
const vaAt = mainSrc.indexOf('AcceleratedVideoDecodeLinuxGL');
check(safeAt >= 0 && vaAt > safeAt && mainSrc.includes('XBOXPLAY_VAAPI'), 'VA-API decode is requested only when GPU acceleration is on');
check(overlaySrc.includes("toggle('idle'"), 'anti-idle is on in F3 unless turned off');

const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, L3: 10, R3: 11, DUp: 12, DDown: 13, DLeft: 14, DRight: 15, Guide: 16 };
const AXIS = { LSUp: [1, -1], LSDown: [1, 1], LSLeft: [0, -1], LSRight: [0, 1], RSUp: [3, -1], RSDown: [3, 1], RSLeft: [2, -1], RSRight: [2, 1] };

function makeEnv() {
  const listeners = { window: {}, document: {}, other: {} };
  const add = (bucket, type, fn) => { (listeners[bucket][type] ||= []).push(fn); };
  const fire = (bucket, type, ev) => {
    ev.type = ev.type || type;
    if (ev.timeStamp == null) ev.timeStamp = performance.now();
    ev.preventDefault = ev.preventDefault || (() => { ev.prevented = true; });
    ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev.stopped = true; });
    for (const fn of listeners[bucket][type] || []) { fn(ev); if (ev.stopped) break; }
    return ev;
  };
  const store = {};
  const videos = [{ tagName: 'VIDEO', getBoundingClientRect: () => ({ width: 1280, height: 720 }), readyState: 4, srcObject: { active: true }, muted: true, play: () => Promise.resolve() }];
  let pointerLockElement = null;
  const document = {
    readyState: 'complete', hidden: false,
    exitPointerLock() { pointerLockElement = null; fire('document', 'pointerlockchange', {}); },
    querySelectorAll() { return videos; },
    querySelector() { return videos[0]; },
    get pointerLockElement() { return pointerLockElement; },
    _throwUnadjusted: false, _rejectUnadjusted: false, _noLock: false, _media: videos,
  };
  const body = {
    requestPointerLock(opts) {
      if (document._noLock) return Promise.resolve();
      if (opts && opts.unadjustedMovement) {
        if (document._throwUnadjusted) throw new Error('unadjustedMovement not supported');
        if (document._rejectUnadjusted) return Promise.reject(new Error('unadjustedMovement unavailable'));
      }
      pointerLockElement = body;
      fire('document', 'pointerlockchange', {});
      return Promise.resolve();
    },
  };
  document.body = body;
  document.documentElement = body;
  function bucketFor(target) {
    if (target === windowObj) return 'window';
    if (target === document) return 'document';
    return 'other';
  }
  function EventTarget() {}
  EventTarget.prototype.addEventListener = function (type, fn) { add(bucketFor(this), type, fn); };
  EventTarget.prototype.removeEventListener = function (type, fn) {
    const arr = listeners[bucketFor(this)][type] || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
  function Navigator() {}
  const pads = { list: [] };
  Navigator.prototype.getGamepads = function () { return pads.list; };
  function Gamepad() {}
  const windowObj = {
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
    },
    addEventListener(type, fn, opts) { return EventTarget.prototype.addEventListener.call(this, type, fn, opts); },
    dispatchEvent(e) { fire('window', e.type || 'event', e); return true; },
    __xboxplayUI: { toast() {}, badge() {}, isOpen: () => false },
    __XBOXPLAY_KEYMAP: DEFAULT_KEYMAP,
  };
  document.addEventListener = function (type, fn, opts) { return EventTarget.prototype.addEventListener.call(this, type, fn, opts); };
  const navigator = new Navigator();
  windowObj.navigator = navigator;
  const ctx = {
    window: windowObj, document, navigator, Navigator, Gamepad, EventTarget, Event, console,
    setTimeout, clearTimeout, setInterval, clearInterval, performance,
    Object, Array, Math, Number, String, Set, Map, WeakMap, Proxy, Reflect, Error, TypeError, JSON, parseFloat,
    innerWidth: 1280, innerHeight: 800,
  };
  ctx._fire = (type, ev) => fire('window', type, ev);
  ctx._fireDoc = (type, ev) => fire('document', type, ev);
  ctx._doc = document;
  ctx._store = store;
  ctx._pads = pads;
  return ctx;
}

function load(opts = {}) {
  const ctx = makeEnv();
  ctx._store['xboxplay.mkb'] = '1';
  ctx._store['xboxplay.sens'] = '1';
  ctx._store['xboxplay.trackpad'] = '1';
  if (opts.smooth != null) ctx._store['xboxplay.smooth'] = String(opts.smooth);
  vm.createContext(ctx);
  vm.runInContext(mkbSrc, ctx);
  const M = vm.runInContext('window.__xboxplayMKB', ctx);
  M.enabled = true;
  if (opts.lock === false) M.forceActive = false;
  else { M.forceActive = true; ctx._doc.body.requestPointerLock(); }
  return { ctx, M, gp() { return vm.runInContext('[...navigator.getGamepads()].find(g => g && g.id && g.id.includes("XInput"))', ctx); } };
}

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

function key(ctx, type, code, extra) { return ctx._fire(type, { code, repeat: false, ...(extra || {}) }); }

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xboxplay-keymap-')); }

(async () => {
  {
    const { M } = load();
    const names = M.controls().slice().sort();
    check(JSON.stringify(names) === JSON.stringify(ACTIONS.slice().sort()), 'page handles every keymap control');
  }

  // Every default binding is one key, full value, and still down on the next poll.
  {
    const { ctx, gp } = load();
    const seen = gp();
    check(seen && seen.connected && seen.mapping === 'standard' && seen.buttons.length === 17 && seen.axes.length === 4, 'virtual pad is a connected standard Xbox controller');
    for (const name of ACTIONS) {
      const code = DEFAULT_KEYMAP[name];
      key(ctx, 'keydown', code);
      const p = gp();
      let ok = false;
      if (name in BUTTON) ok = p.buttons[BUTTON[name]].pressed && p.buttons[BUTTON[name]].value === 1;
      else { const [axis, val] = AXIS[name]; ok = p.axes[axis] === val; }
      const again = gp();
      let held = false;
      if (name in BUTTON) held = again.buttons[BUTTON[name]].value === 1;
      else { const [axis, val] = AXIS[name]; held = again.axes[axis] === val; }
      key(ctx, 'keyup', code);
      const up = gp();
      const released = name in BUTTON ? up.buttons[BUTTON[name]].value === 0 : up.axes[AXIS[name][0]] === 0;
      check(ok && held && released, name + ' on ' + code + ' is a full press while held, then released');
    }
  }

  {
    const { ctx, gp } = load({ smooth: 100 });
    key(ctx, 'keydown', 'Equal');
    key(ctx, 'keydown', 'KeyD');
    const p = gp();
    check(p.buttons[7].value === 1 && p.buttons[7].pressed && p.axes[0] === 1, 'throttle and steering are full together on the first sample');
    const t1 = p.timestamp;
    await sleep(20);
    const q = gp();
    check(q.buttons[7].value === 1 && q.axes[0] === 1 && q.timestamp > t1, 'RT and steering stay full, and the timestamp keeps moving while held');
    key(ctx, 'keyup', 'Equal');
    key(ctx, 'keyup', 'KeyD');
    check(gp().buttons[7].value === 0 && gp().axes[0] === 0, 'releasing the keys releases throttle and steering');
  }

  {
    const { ctx, gp } = load();
    const t1 = gp().timestamp;
    await sleep(20);
    check(gp().timestamp === t1, 'an idle pad does not look like fresh input on every poll');
    key(ctx, 'keydown', 'KeyW');
    key(ctx, 'keydown', 'KeyW', { repeat: true });
    check(gp().axes[1] === -1, 'key repeat does not drop or stack the stick');
    key(ctx, 'keyup', 'KeyW');
  }

  {
    const { ctx, gp } = load();
    key(ctx, 'keydown', 'KeyW');
    key(ctx, 'keydown', 'KeyD');
    const p = gp();
    check(Math.abs(Math.hypot(p.axes[0], p.axes[1]) - 1) < 1e-9 && p.axes[0] > 0 && p.axes[1] < 0, 'diagonal stick is full magnitude, not past the edge');
    key(ctx, 'keyup', 'KeyW');
    key(ctx, 'keyup', 'KeyD');
    key(ctx, 'keydown', 'KeyA');
    key(ctx, 'keydown', 'KeyD');
    check(gp().axes[0] === 0, 'opposite directions cancel');
    key(ctx, 'keyup', 'KeyA');
    key(ctx, 'keyup', 'KeyD');
    const space = key(ctx, 'keydown', 'Space');
    check(space.prevented && !gp().buttons[0].pressed, 'Space is not A, and it does not scroll the page');
    key(ctx, 'keyup', 'Space');
    key(ctx, 'keydown', 'ShiftLeft');
    check(!gp().buttons[10].pressed, 'Shift is not a stick click');
    key(ctx, 'keyup', 'ShiftLeft');
    const chord = key(ctx, 'keydown', 'KeyW', { ctrlKey: true });
    check(!chord.prevented && gp().axes[1] === 0, 'Ctrl+W is left for the browser');
  }

  {
    const { ctx, gp } = load();
    const typed = key(ctx, 'keydown', 'KeyW', { target: { tagName: 'INPUT' } });
    check(!typed.prevented && gp().axes[1] === 0, 'keys typed into a field are not captured');
    ctx.window.__xboxplayUI.isOpen = () => true;
    const covered = key(ctx, 'keydown', 'KeyD');
    check(!covered.prevented && gp().axes[0] === 0, 'keys are ignored while the guide or settings are open');
  }

  {
    const { ctx, gp } = load({ lock: false });
    const ev = key(ctx, 'keydown', 'KeyA');
    check(ev.prevented && gp().axes[0] === -1, 'steering works without pointer lock while a stream is up');
    key(ctx, 'keyup', 'KeyA');
  }

  {
    const { ctx, gp } = load({ lock: false });
    ctx._doc._media[0].srcObject = null;
    const ev = key(ctx, 'keydown', 'KeyW');
    check(!ev.prevented && gp().axes[1] === 0, 'keys reach the page when nothing is streaming and the mouse is free');
  }

  {
    const { ctx, M, gp } = load();
    M.forceActive = false;
    ctx._doc.exitPointerLock();
    const ev = key(ctx, 'keydown', 'KeyW');
    check(!ev.prevented && gp().axes[1] === 0, 'Esc stops the keyboard until you click the stream');
    ctx._doc._noLock = true;
    ctx._fire('mousedown', { button: 0 });
    const again = key(ctx, 'keydown', 'KeyW');
    check(again.prevented && gp().axes[1] === -1, 'clicking the stream resumes the keyboard even if pointer lock fails');
    key(ctx, 'keyup', 'KeyW');
  }

  {
    const { ctx, gp } = load();
    let seen = 0;
    ctx.window.addEventListener('keydown', () => { seen++; });
    key(ctx, 'keydown', 'KeyW');
    check(seen === 0 && gp().axes[1] === -1, 'the page does not also see a key the pad is using');
    key(ctx, 'keyup', 'KeyW');
  }

  {
    const { ctx, gp } = load();
    let eventPad = null;
    ctx.window.addEventListener('gamepadconnected', e => { eventPad = e.gamepad; });
    check(eventPad && eventPad.connected && eventPad.mapping === 'standard' && eventPad.buttons.length === 17, 'a listener added after startup still receives the virtual pad');
    key(ctx, 'keydown', 'Minus');
    check(eventPad.buttons[6].value === 1 && eventPad.buttons[6].pressed, 'the pad from gamepadconnected stays live while LT is held');
    key(ctx, 'keyup', 'Minus');
    check(eventPad.buttons[6].value === 0, 'the live pad releases LT on keyup');
  }

  {
    const { ctx, gp } = load();
    const wheel = ctx._fire('wheel', { deltaY: 80, deltaX: 0 });
    check(!wheel.prevented && !gp().buttons[12].pressed && !gp().buttons[13].pressed, 'the wheel is not a D-pad press');
    key(ctx, 'keydown', 'KeyW');
    key(ctx, 'keydown', 'ArrowUp');
    ctx._fire('blur', {});
    const p = gp();
    check(p.axes[1] === 0 && !p.buttons[12].pressed && p.buttons[7].value === 0, 'blur releases keys');
  }

  {
    const { ctx, gp } = load();
    key(ctx, 'keydown', 'KeyD');
    ctx._doc.hidden = true;
    ctx._fireDoc('visibilitychange', {});
    check(gp().axes[0] === 0, 'hiding the window releases keys');
  }

  {
    const { ctx, gp } = load();
    ctx._fire('mousedown', { button: 0 });
    ctx._fire('mousedown', { button: 2 });
    check(gp().buttons[7].value === 1 && gp().buttons[6].value === 1, 'mouse buttons are full RT and LT while the pointer is locked');
    key(ctx, 'keydown', 'Equal');
    check(gp().buttons[7].value === 1, 'mouse RT and the RT key together stay at a full press');
    ctx._fire('mouseup', { button: 0 });
    ctx._fire('mouseup', { button: 2 });
    key(ctx, 'keyup', 'Equal');
    check(gp().buttons[7].value === 0 && gp().buttons[6].value === 0, 'releasing the mouse and the key releases the triggers');
    ctx._fire('mousedown', { button: 1 });
    check(gp().buttons[11].pressed, 'middle click is the right stick click');
    ctx._fire('mouseup', { button: 1 });
  }

  {
    const { ctx, gp } = load();
    ctx._fire('mousemove', { movementX: 0.25, movementY: 0, timeStamp: 1 });
    ctx._fire('pointermove', { movementX: 0.25, movementY: 0, timeStamp: 1 });
    await sleep(20);
    const first = gp().axes[2];
    check(first > 0, 'fractional trackpad delta reaches the look stick, got ' + first);
    ctx._fire('mousemove', { movementX: 0.25, movementY: 0, timeStamp: 2 });
    await sleep(20);
    check(gp().axes[2] > 0, 'a second tiny trackpad delta is not swallowed');
  }

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

  {
    const { ctx, gp } = load();
    ctx._fire('mousemove', { movementX: 1, movementY: 0, timeStamp: 11 });
    await sleep(12);
    check(gp().axes[2] >= 0.2, 'a 1px trackpad move gets past the stick deadzone, got ' + gp().axes[2]);
    await sleep(200);
    check(gp().axes[2] === 0, 'look stick returns to centre after the move');
  }

  // --- keymap file ---
  {
    const parsed = parseKeymap(fs.readFileSync(path.join(__dirname, '../keymap.example.json'), 'utf8'));
    check(!parsed.error && ACTIONS.every(n => parsed.map[n] === DEFAULT_KEYMAP[n]), 'example keymap matches the defaults');
    const dir = tmpDir();
    check(!loadKeymap(dir).error && loadKeymap(dir).map.RT === 'Equal', 'a missing keymap file uses the defaults');
    fs.copyFileSync(path.join(__dirname, '../keymap.example.json'), path.join(dir, 'keymap.json'));
    check(loadKeymap(dir).map.A === 'Enter' && !loadKeymap(dir).error, 'a valid keymap file loads');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"RT":"Space"}\n');
    const partial = loadKeymap(dir);
    check(!partial.error && partial.map.RT === 'Space' && partial.map.LT === 'Minus' && partial.map.LSUp === 'KeyW', 'a partial file overrides one control and keeps the rest');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"L3":"KeyG","R3":"KeyF"}\n');
    const swapped = loadKeymap(dir);
    check(!swapped.error && swapped.map.L3 === 'KeyG' && swapped.map.R3 === 'KeyF' && swapped.map.LB === 'KeyQ', 'two controls can swap keys');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"RT":"KeyW"}\n');
    const clash = loadKeymap(dir);
    check(clash.error === 'duplicate key' && clash.map.RT === 'Equal', 'a key used twice is ignored and the defaults stay');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"Nope":"KeyQ"}\n');
    check(loadKeymap(dir).error === 'unknown control' && loadKeymap(dir).map.A === 'Enter', 'an unknown control is ignored');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"A":"Escape"}\n');
    check(loadKeymap(dir).error === 'bad key', 'Escape cannot be bound');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"A":"F1"}\n');
    check(loadKeymap(dir).error === 'bad key', 'F-keys cannot be bound');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"LT":"ControlLeft"}\n');
    check(loadKeymap(dir).error === 'bad key', 'Ctrl cannot be bound');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{');
    check(loadKeymap(dir).error === 'not json', 'broken JSON is ignored');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '');
    check(loadKeymap(dir).error === 'empty', 'an empty file is ignored');
    fs.writeFileSync(path.join(dir, 'keymap.json'), '{"__proto__":{"A":"KeyQ"}}\n');
    const proto = loadKeymap(dir);
    check(!!proto.error && proto.map.A === 'Enter' && !Object.prototype.polluted, 'a prototype payload is ignored');
    fs.writeFileSync(path.join(dir, 'keymap.json'), 'x'.repeat(9000));
    check(loadKeymap(dir).error === 'too large', 'an oversized keymap is ignored');
    fs.rmSync(path.join(dir, 'keymap.json'));
    fs.symlinkSync('/etc/passwd', path.join(dir, 'keymap.json'));
    check(loadKeymap(dir).error === 'symlink', 'a symlink keymap is ignored');
    fs.unlinkSync(path.join(dir, 'keymap.json'));
    fs.mkdirSync(path.join(dir, 'keymap.json'));
    check(loadKeymap(dir).error === 'not a file', 'a directory called keymap.json is ignored');
  }

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
    check(api.holdReconnect() === false, 'reconnect can run while the window is in front');
    ctx.window.__xboxplayIdle = { pageHidden() { return true; } };
    check(api.holdReconnect() === true, 'reconnect waits while the window is really hidden');
    ctx.window.__xboxplayIdle = null;
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

  // Inactivity dialog, pointer-lock release, and the idle nudge.
  {
    const store = {};
    function el(tag, text, kids, extra) {
      extra = extra || {};
      return {
        tagName: tag,
        textContent: text,
        hidden: !!extra.hidden,
        disabled: !!extra.disabled,
        shadowRoot: extra.shadow || null,
        attrs: extra.attrs || {},
        kids: kids || [],
        clicked: 0,
        getAttribute(name) { return this.attrs[name] || null; },
        click() { this.clicked++; },
        contains(other) {
          const walk = (n) => (n.kids || []).some(k => k === other || walk(k));
          return walk(this);
        },
        querySelectorAll(sel) {
          const all = [];
          const walk = (nodes) => { for (const k of nodes) { all.push(k); walk(k.kids || []); } };
          walk(this.kids);
          if (sel === '*') return all;
          return all.filter(n => {
            const t = String(n.tagName || '').toUpperCase();
            const role = n.attrs && n.attrs.role;
            const type = n.attrs && n.attrs.type;
            return t === 'BUTTON' || role === 'button' || (t === 'INPUT' && (type === 'button' || type === 'submit'));
          });
        },
      };
    }
    const doc = el('DIV', '', []);
    doc.pointerLockElement = null;
    doc.exited = 0;
    doc.exitPointerLock = function () { this.exited++; this.pointerLockElement = null; };
    let pageHidden = true;
    function Document() {}
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return pageHidden; } });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return pageHidden ? 'hidden' : 'visible'; } });
    Document.prototype.hasFocus = function () { return false; };
    const real = { id: '8BitDo', axes: [0, 0, 0, 0], buttons: [{ pressed: false, value: 0 }] };
    function Navigator() {}
    Navigator.prototype.getGamepads = function () { return [real]; };
    let uiOpen = false;
    function Element() {}
    Element.prototype.attachShadow = function (init) {
      this.shadowRoot = init && init.mode === 'closed' ? null : (init && init.root);
      return init && init.root;
    };
    const ctx = {
      window: {
        localStorage: {
          getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
          setItem(k, v) { store[k] = String(v); },
        },
        __xboxplayUI: { isOpen() { return uiOpen; } },
        addEventListener() {},
      },
      document: doc,
      Document, Navigator, Element,
      console, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
      Date, Math, Number, String, Array, Object, Set, JSON,
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/idle.js'), 'utf8'), ctx);
    const api = vm.runInContext('window.__xboxplayIdle', ctx);
    check(api.idleOn() === true, 'anti-idle is on when nothing is saved');
    store['xboxplay.idle'] = '0';
    check(api.idleOn() === false, 'anti-idle turns off from the F3 setting');
    store['xboxplay.idle'] = '1';
    check(api.stillHereText("I'm still here") && api.stillHereText("I'M STILL HERE") && api.stillHereText('I’m still here'), 'the English confirm button matches, including a curly apostrophe');
    check(api.stillHereText("I'm still here.") && api.stillHereText('Je suis toujours là') && api.stillHereText('Ich bin noch da') && api.stillHereText('まだここにいます'), 'localised confirm labels match');
    check(!api.stillHereText('Resume') && !api.stillHereText('Cancel'), 'unrelated buttons are not the confirm button');

    const still = el('BUTTON', "I'm still here");
    const shadow = el('DIV', '', [still]);
    const host = el('DIV', '', [], { shadow });
    const resume = el('BUTTON', 'Resume', [], { attrs: { class: 'still-here' } });
    const tree = el('DIV', '', [host, resume]);
    check(api.findStillHere(tree) === still, 'the confirm button is found inside a shadow root, not by its class');
    check(api.findStillHere(el('DIV', '', [resume])) === null, 'a Resume button is left alone');
    const hiddenBtn = el('BUTTON', "I'm still here", [], { hidden: true });
    check(api.findStillHere(el('DIV', '', [hiddenBtn])) === null, 'a hidden confirm button is not clicked');
    const go = el('BUTTON', 'Continuar');
    const cancel = el('BUTTON', 'Cancel');
    const dialog = el('DIV', 'Are you still here? Due to inactivity, your game streaming session will end soon.', [cancel, go], { attrs: { role: 'dialog' } });
    check(api.findStillHere(el('DIV', '', [dialog])) === go, 'an inactivity dialog falls back to its confirm button');
    check(api.findStillHere(el('DIV', '', [el('DIV', 'Due to inactivity, your game streaming session will end soon.', [cancel], { attrs: { role: 'alertdialog' } })])) === null, 'a cancel-only dialog is not confirmed');
    const save = el('BUTTON', 'Save');
    check(api.findStillHere(el('DIV', '', [el('DIV', 'Stream quality', [save], { attrs: { role: 'dialog' } })])) === null, 'an ordinary dialog is not confirmed');

    const t = 1000;
    check(api.nudgeDue(t, t + 2 * 60 * 1000, true) === false, 'two quiet minutes is not a nudge');
    check(api.nudgeDue(t, t + api.NUDGE_AFTER, true) === true, 'a few quiet minutes is a nudge');
    check(api.nudgeDue(t, t + api.NUDGE_AFTER, false) === false, 'the nudge stays off when anti-idle is off');
    const nudged = api.nudgePad(real);
    check(Math.abs(nudged.axes[2] - 0.02) < 0.001 && nudged.axes[0] === 0 && nudged.axes[1] === 0 && nudged.axes[3] === 0, 'the nudge is a tiny right-stick move');
    check(real.axes[2] === 0 && nudged !== real, 'the original pad is unchanged');
    let released = 0;
    check(api.releaseCapture({ pointerLockElement: {}, exitPointerLock() { released++; } }, true) === true && released === 1, 'a dialog releases the mouse');
    check(api.releaseCapture({ pointerLockElement: {}, exitPointerLock() {} }, false) === false, 'the mouse stays captured when nothing is showing');

    const page = new ctx.Document();
    check(page.hidden === false && page.visibilityState === 'visible' && page.hasFocus() === false, 'while anti-idle is on the page is not treated as hidden, and focus stays real');
    store['xboxplay.idle'] = '0';
    check(page.hidden === true && page.visibilityState === 'hidden' && page.hasFocus() === false, 'turning anti-idle off reports the real page visibility');
    store['xboxplay.idle'] = '1';
    check(api.pageHidden() === true, 'anti-idle still knows when the window is really hidden');
    const prevQS = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = (sel) => (sel === 'video' ? [{ videoWidth: 1920, paused: false, srcObject: {} }] : prevQS(sel));
    const live = new ctx.Document();
    check(live.hidden === true && live.visibilityState === 'hidden', 'a playing picture is told the real visibility');
    doc.querySelectorAll = prevQS;
    check(new ctx.Document().hidden === false, 'with no picture, anti-idle still reports the page as visible');

    const nav = new ctx.Navigator();
    const early = nav.getGamepads();
    check(early[0] === real && real.axes[2] === 0, 'a fresh session is not nudged');
    api.markIdle(Date.now() - api.NUDGE_AFTER);
    const moved = nav.getGamepads();
    check(moved[0] !== real && Math.abs(moved[0].axes[2] - 0.02) < 0.001 && real.axes[2] === 0, 'the pad the page reads is nudged only after the quiet wait');
    real.axes[2] = 0.4;
    const busy = nav.getGamepads();
    check(busy[0] === real && real.axes[2] === 0.4, 'real stick movement is passed through');
    real.axes[2] = 0;
    store['xboxplay.idle'] = '0';
    api.markIdle(Date.now() - api.NUDGE_AFTER);
    check(nav.getGamepads()[0] === real, 'the nudge does not run when anti-idle is off');
    store['xboxplay.idle'] = '1';

    uiOpen = true;
    doc.pointerLockElement = {};
    api.tick();
    check(doc.exited === 1 && doc.pointerLockElement === null, 'the XboxPlay panel releases the mouse while it is open');
    uiOpen = false;
    const saveBtn = el('BUTTON', 'Save');
    doc.kids.push(el('DIV', 'Stream quality', [saveBtn], { attrs: { role: 'dialog' } }));
    doc.pointerLockElement = {};
    api.tick();
    check(saveBtn.clicked === 0 && doc.pointerLockElement === null, 'an ordinary dialog releases the mouse and is not clicked');
    doc.kids.pop();

    const trapped = el('BUTTON', "I'm still here");
    const closed = el('DIV', '', [trapped]);
    const hostEl = new ctx.Element();
    hostEl.attachShadow({ mode: 'closed', root: closed });
    check(hostEl.shadowRoot == null && api.findStillHere(doc) === trapped, 'a closed shadow confirm button is still found');
    doc.pointerLockElement = { locked: true };
    api.tick();
    check(trapped.clicked === 1 && doc.pointerLockElement === null, 'the confirm button is clicked even while the mouse was captured');
    const clicks = trapped.clicked;
    doc.pointerLockElement = { locked: true };
    api.tick();
    check(trapped.clicked === clicks, 'the confirm button is not clicked again straight away');
  }

  {
    const { readSession, writeSession, eraseSession, validSession } = require('../src/session-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xboxplay-session-'));
    const stopUrl = 'https://uks.core.gssv-play-prodxhome.xboxlive.com/v5/sessions/home/04DBC99C-77BA-4D2E-B8D0-0B39CC16869C';
    const authorization = 'Bearer test-token-value';
    check(validSession({ stopUrl: stopUrl + '?x=1', authorization }) === null, 'a session url with a query string is ignored');
    check(validSession({ stopUrl: 'http://xboxlive.com/v5/sessions/home/04DBC99C-77BA-4D2E-B8D0-0B39CC16869C', authorization }) === null, 'a session url has to be https on xboxlive.com');
    check(readSession(dir) === null, 'a missing session file is unset');
    check(writeSession(dir, { stopUrl, authorization }) === true, 'the console session is saved');
    const saved = readSession(dir);
    check(saved && saved.stopUrl === stopUrl && saved.authorization === authorization, 'the saved session can be read back');
    check((fs.statSync(path.join(dir, 'session.json')).mode & 0o777) === 0o600, 'the session file is not world-readable');
    const real = path.join(dir, 'real.json');
    fs.writeFileSync(real, '{"stopUrl":"https://evil.example/secret","authorization":"Bearer other-token"}\n');
    fs.unlinkSync(path.join(dir, 'session.json'));
    fs.symlinkSync('real.json', path.join(dir, 'session.json'));
    check(readSession(dir) === null && writeSession(dir, { stopUrl, authorization }) === false, 'a symlink session file is ignored');
    check(fs.readFileSync(real, 'utf8').includes('evil.example'), 'the symlink target is left alone');
    fs.unlinkSync(path.join(dir, 'session.json'));
    check(writeSession(dir, { stopUrl, authorization }) === true && eraseSession(dir) === undefined && readSession(dir) === null, 'the session file is removed after the stop');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const calls = [];
    const notes = [];
    const PLAY = 'https://uks.core.gssv-play-prodxhome.xboxlive.com/v5/sessions/home/play';
    const SESSION = 'https://uks.core.gssv-play-prodxhome.xboxlive.com/v5/sessions/home/04DBC99C-77BA-4D2E-B8D0-0B39CC16869C';
    const body = { sessionId: '04DBC99C-77BA-4D2E-B8D0-0B39CC16869C', sessionPath: 'v5/sessions/home/04DBC99C-77BA-4D2E-B8D0-0B39CC16869C' };
    function fetch(url, init) {
      calls.push({ url: String(url), method: String((init && init.method) || 'GET').toUpperCase() });
      if (String((init && init.method) || '').toUpperCase() === 'DELETE') return Promise.resolve({ ok: true, status: 204 });
      return Promise.resolve({
        ok: true,
        status: 200,
        clone() { return { json: () => Promise.resolve(body) }; },
      });
    }
    const ctx = {
      window: {
        fetch,
        addEventListener() {},
        xboxplayHost: {
          noteSession(info) { notes.push(info); },
          clearStreamCache() { return Promise.resolve(true); },
        },
      },
      location: { href: 'https://www.xbox.com/en-US/play' },
      console, Promise, URL, JSON, Object, String, Array, setTimeout, clearTimeout,
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/session.js'), 'utf8'), ctx);
    const api = vm.runInContext('window.__xboxplaySession', ctx);
    check(api.isHomePlay(PLAY, 'POST') === true, 'a home play request is recognised');
    check(api.isHomePlay('https://www.xbox.com/en-US/play', 'POST') === false, 'the website itself is not a console session');
    check(api.stopUrlFrom(PLAY, body) === SESSION, 'the stop url is the home session, not the play url');
    check(api.sessionFromUrl(SESSION + '/state', 'Bearer test-token-value').stopUrl === SESSION, 'a state poll points at the same session');
    await vm.runInContext('window.fetch(u, { method: "POST", headers: { Authorization: "Bearer test-token-value" } })', Object.assign(ctx, { u: PLAY }));
    await vm.runInContext('new Promise(r => setTimeout(r, 0))', ctx);
    check(notes.some(n => n && n.stopUrl === SESSION && n.authorization === 'Bearer test-token-value'), 'a home play response is remembered');
    calls.length = 0;
    await vm.runInContext('window.fetch(u, { method: "POST", headers: { Authorization: "Bearer test-token-value" } })', ctx);
    check(calls[0] && calls[0].method === 'DELETE' && calls[0].url === SESSION, 'a stale console session is deleted before the next start');
    check(calls.some(c => c.method === 'POST' && c.url === PLAY), 'the new session start still goes out');
    const stopped = await vm.runInContext('window.__xboxplaySession.stop()', ctx);
    check(stopped === true, 'stop deletes the console session');
  }

  if (failed) {
    console.log(failed + ' failed');
    process.exit(1);
  }
  console.log('All unit tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
