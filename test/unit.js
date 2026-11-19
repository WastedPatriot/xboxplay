// Headless unit tests for the keyboard/mouse layer and audio startup. Run: node test/unit.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  const videos = [{ readyState: 4, muted: true, play: () => Promise.resolve() }];
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
  function Navigator() {}
  Navigator.prototype.getGamepads = function () { return []; };
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
    Object, Array, Math, Number, String, Set, Map, Error, TypeError, JSON, parseFloat,
  };
  ctx._fire = (type, ev) => fire('window', type, ev);
  ctx._fireDoc = (type, ev) => fire('document', type, ev);
  ctx._doc = document;
  ctx._store = store;
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

(async () => {
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

  if (failed) {
    console.log(failed + ' failed');
    process.exit(1);
  }
  console.log('All unit tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
