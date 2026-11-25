// Headless unit tests for the keyboard/mouse layer, keymap file, and audio startup. Run: node test/unit.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { DEFAULT_KEYMAP, ACTIONS, parseKeymap, loadKeymap } = require('../src/keymap');

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
  Navigator.prototype.getGamepads = function () { return []; };
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

  if (failed) {
    console.log(failed + ' failed');
    process.exit(1);
  }
  console.log('All unit tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
