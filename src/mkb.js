// Keyboard and mouse -> one virtual Xbox controller (www.xbox.com and play.xbox.com).
// Buttons follow Greenlight's defaults: one key, full value while it is held, no modes.
// Sticks are WASD and IJKL (Greenlight does not map those). Triggers are 0 or 1.
// The pad is a standard Xbox controller, so games that ignore the keyboard still see it.
(() => {
  if (window.__xboxplayMKB) return;
  const LS = window.localStorage, origGP = Navigator.prototype.getGamepads;
  const get = (k, d) => { const v = LS.getItem('xboxplay.' + k); return v === null ? d : v; };
  if (LS.getItem('xboxplay.v2') === null) { if (LS.getItem('xboxplay.sens') === '1') LS.setItem('xboxplay.sens', '2'); if (LS.getItem('xboxplay.trackpad') === '1') LS.setItem('xboxplay.trackpad', '2.5'); LS.setItem('xboxplay.v2', '1'); }
  const num = (k, d) => { const v = parseFloat(get(k, '')); return Number.isFinite(v) ? v : d; };

  // While we are driving the pad, page listeners must not also see the keys (xCloud has its own shortcuts).
  const ET = typeof EventTarget === 'function' ? EventTarget.prototype : null;
  const ADD = ET ? ET.addEventListener : function (t, f, o) { return window.addEventListener(t, f, o); }, REMOVE = ET && ET.removeEventListener;
  const KM = new Set(['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'mousemove', 'click', 'auxclick', 'dblclick',
    'pointerdown', 'pointerup', 'pointermove', 'pointerrawupdate', 'wheel']);
  const wraps = new WeakMap();
  const muted = e => {
    const m = window.__xboxplayMKB;
    if (!m || !e) return false;
    if (e.target && e.target.closest && e.target.closest('xboxplay-ui')) return false;
    const key = e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress';
    if (key) return !!(m.takingKeys && m.takingKeys(e));
    return !!(m.takingMouse && m.takingMouse());
  };
  let replayConnected = () => {};
  if (ET) ET.addEventListener = function (type, fn, opts) {
    if (type === 'gamepadconnected' && this === window && fn) {
      const ret = ADD.call(this, type, fn, opts);
      try { replayConnected(fn); } catch (e) {}
      return ret;
    }
    if (!KM.has(type) || !fn) return ADD.call(this, type, fn, opts);
    let w = wraps.get(fn);
    if (!w) { w = function (e) { if (muted(e)) return; return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e); }; wraps.set(fn, w); }
    return ADD.call(this, type, w, opts);
  };
  if (ET) ET.removeEventListener = function (type, fn, opts) {
    return REMOVE.call(this, type, (fn && wraps.get(fn)) || fn, opts);
  };
  const debug = (...a) => { if (window.__XBOXPLAY_DEBUG) console.log('[XboxPlay]', ...a); };

  // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 D-pad, 16 Guide.
  // Axis pairs are [axis index, value]. Y is negative up, matching the Gamepad spec.
  const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, L3: 10, R3: 11, DUp: 12, DDown: 13, DLeft: 14, DRight: 15, Guide: 16 };
  const AXIS = { LSUp: [1, -1], LSDown: [1, 1], LSLeft: [0, -1], LSRight: [0, 1], RSUp: [3, -1], RSDown: [3, 1], RSLeft: [2, -1], RSRight: [2, 1] };
  const NAMES = Object.keys(BUTTON).concat(Object.keys(AXIS));
  const CODE_OK = /^[A-Za-z0-9]+$/;

  const held = new Set(), mouse = new Set();
  let accX = 0, accY = 0, rx = 0, ry = 0, ts = performance.now(), exposed = false, slot = 0;
  let hasRaw = false, lastMoveTs = -1, lastMX = 0, lastMY = 0, lastScreenX, lastScreenY, dbgAt = 0, last = performance.now();
  let streamLive = false, wasLocked = false, suspended = false, gpCalls = 0;
  const pref = LS.getItem('xboxplay.mkb');

  function overlayOpen() { return !!(window.__xboxplayUI && window.__xboxplayUI.isOpen && window.__xboxplayUI.isOpen()); }
  function pointerOn() { return M.enabled && !overlayOpen() && (M.forceActive || !!document.pointerLockElement); }
  function keysLive() {
    if (!M.enabled || overlayOpen() || suspended) return false;
    return pointerOn() || streamLive;
  }
  function isTyping(e) {
    const nodes = (e && e.composedPath && e.composedPath()) || (e && e.target ? [e.target] : []);
    return nodes.some(n => n && (n.isContentEditable || n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT'));
  }

  const M = window.__xboxplayMKB = {
    enabled: pref ? pref === '1' : true, forceActive: false,
    takingKeys(e) { return keysLive() && !isTyping(e); },
    takingMouse() { return pointerOn(); },
    controls() { return NAMES.slice(); },
    active() { return this.takingKeys(); },
    toggle() {
      this.enabled = !this.enabled; LS.setItem('xboxplay.mkb', this.enabled ? '1' : '0');
      if (!this.enabled) { reset(); document.exitPointerLock && document.exitPointerLock(); }
      else { suspended = false; exposed = true; }
      toast(this.enabled ? 'Keyboard and mouse on' : 'Keyboard and mouse off'); badge();
    },
    set(on) { if (on !== this.enabled) this.toggle(); },
    setSensitivity(v) { LS.setItem('xboxplay.sens', String(v)); },
    state() { const s = sample(); return { lx: s.axes[0], ly: s.axes[1], rx: s.axes[2], ry: s.axes[3], lt: s.down[6], rt: s.down[7] }; },
    refreshBadge() { badge(); },
    controllerMode() { return controllerMode(); },
    releaseVirtual() {
      if (controllerMode() === 'keyboard' || !exposed) return;
      exposed = false;
      try {
        const e = new Event('gamepaddisconnected');
        Object.defineProperty(e, 'gamepad', { value: pad(slot) });
        window.dispatchEvent(e);
      } catch (e) {}
    },
    setController(mode) {
      const m = normalizeMode(mode);
      if (!m) return;
      window.__XBOXPLAY_CONTROLLER = m;
      LS.setItem('xboxplay.controller', m);
      try { if (window.xboxplayHost && window.xboxplayHost.setController) window.xboxplayHost.setController(m); } catch (e) {}
    },
  };
  function normalizeMode(v) {
    v = String(v || '').toLowerCase();
    if (v === 'usb') return 'wired';
    if (v === 'bt') return 'bluetooth';
    if (v === 'keys' || v === 'mkb') return 'keyboard';
    if (v === 'wired' || v === 'bluetooth' || v === 'keyboard' || v === 'auto') return v;
    return '';
  }
  // auto: a real pad if one is plugged in, otherwise the keyboard. keyboard forces the virtual pad.
  function controllerMode() {
    return normalizeMode(window.__XBOXPLAY_CONTROLLER) || normalizeMode(get('controller', '')) || 'auto';
  }
  // If Better xCloud is loaded and the user never chose, leave input to Better xCloud.
  setTimeout(() => { if (!pref && window.BX_EXPOSED) { M.enabled = false; badge(); } }, 0);

  function reset() {
    held.clear(); mouse.clear(); accX = accY = rx = ry = 0;
    suspended = false; ts = performance.now(); lastScreenX = lastScreenY = undefined; badge();
  }
  function toast(t) { if (window.__xboxplayUI) window.__xboxplayUI.toast(t); }
  function badge() {
    if (!window.__xboxplayUI || !window.__xboxplayUI.badge) return;
    window.__xboxplayUI.badge(M.enabled && get('badge', '1') !== '0');
  }
  const clamp = v => Math.max(-1, Math.min(1, v));

  function byCode() {
    const src = window.__XBOXPLAY_KEYMAP, out = Object.create(null), seen = Object.create(null);
    if (!src || typeof src !== 'object') return out;
    for (const name of NAMES) {
      const code = src[name];
      if (typeof code !== 'string' || code.length > 24 || !CODE_OK.test(code) || seen[code]) continue;
      seen[code] = 1; out[code] = name;
    }
    return out;
  }

  // Read at poll time, not on a timer, so the first sample after a key is already a full press.
  function sample() {
    if (!pointerOn()) { mouse.clear(); accX = accY = rx = ry = 0; }
    if (!keysLive()) held.clear();
    const map = byCode();
    const down = new Array(17).fill(0);
    let lx = 0, ly = 0, kx = 0, ky = 0;
    for (const code of held) {
      const name = map[code];
      if (!name) continue;
      if (name in BUTTON) down[BUTTON[name]] = 1;
      else if (name in AXIS) {
        const axis = AXIS[name][0], val = AXIS[name][1];
        if (axis === 0) lx += val; else if (axis === 1) ly += val; else if (axis === 2) kx += val; else ky += val;
      }
    }
    const norm = (x, y) => {
      x = clamp(x); y = clamp(y);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      return [x, y];
    };
    [lx, ly] = norm(lx, ly);
    if (pointerOn()) {
      if (mouse.has(2)) down[6] = 1;
      if (mouse.has(0)) down[7] = 1;
      if (mouse.has(1)) down[11] = 1;
      if (kx === 0) kx = rx;
      if (ky === 0) ky = ry;
    }
    kx = clamp(kx); ky = clamp(ky);
    const axes = [lx, ly, kx, ky];
    const active = down.some(v => v > 0) || axes.some(v => v !== 0);
    return { down, axes, active };
  }

  function tick() {
    const now = performance.now(), dt = now - last; last = now;
    if (!pointerOn()) { accX = accY = rx = ry = 0; return; }
    const s = num('sens', parseFloat(window.__XBOXPLAY_SENS) || 2) * 0.04, inv = get('invertY', '0') === '1' ? -1 : 1;
    const curve = v => get('curve', 'linear') === 'smooth' ? Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 0.6) : v;
    let nx = clamp(curve(accX * s)), ny = clamp(curve(accY * s) * inv);
    const mag = Math.hypot(nx, ny), ad = num('antidz', 0.22);
    if (mag > 0.002) { const k = Math.min(1, ad + (1 - ad) * Math.min(1, mag)) / mag; nx = clamp(nx * k); ny = clamp(ny * k); }
    else { nx = 0; ny = 0; }
    if (nx !== rx || ny !== ry) ts = now;
    const d = Math.exp(-Math.max(1, dt) / 45);
    rx = nx; ry = ny; accX *= d; accY *= d;
    if (Math.abs(accX) < 0.05) accX = 0; if (Math.abs(accY) < 0.05) accY = 0;
  }
  setInterval(tick, 8);

  const PAD_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
  function livePad(index) {
    const g = {};
    const snap = () => { const s = sample(); if (s.active) ts = performance.now(); return s; };
    Object.defineProperties(g, {
      id: { value: PAD_ID, enumerable: true },
      index: { value: index, enumerable: true },
      connected: { value: true, enumerable: true },
      mapping: { value: 'standard', enumerable: true },
      timestamp: { get() { snap(); return ts; }, enumerable: true },
      axes: { get() { return snap().axes; }, enumerable: true },
      buttons: { get() {
        return snap().down.map(v => { const p = v > 0; return { pressed: p, touched: p, value: v }; });
      }, enumerable: true },
      vibrationActuator: { value: null, enumerable: true },
      hapticActuators: { value: [], enumerable: true },
    });
    try { Object.setPrototypeOf(g, Gamepad.prototype); } catch (e) {}
    return g;
  }
  let live = null;
  function pad(index) {
    if (!live || live.index !== index) live = livePad(index);
    return live;
  }

  function place(real) {
    while (real.length < 4) real.push(null);
    if (slot >= 0 && slot < 4 && !real[slot]) return slot;
    const free = real.findIndex(p => !p);
    if (free >= 0) { slot = free; return slot; }
    return -1;
  }
  function isRealPad(p) {
    return !!(p && p.connected !== false && p.id !== PAD_ID);
  }
  let lastReal = null;
  let lastPhysicalAt = 0;
  function deliver(list) {
    try {
      const pads = window.__xboxplayPads;
      if (pads && pads.noteDelivered) pads.noteDelivered(list);
    } catch (e) {}
    return list;
  }
  Navigator.prototype.getGamepads = function () {
    const real = Array.from(origGP.call(this) || []);
    const phys = real.filter(isRealPad);
    // A real controller (wired or Bluetooth, including the 8BitDo on xpad) is what the game reads.
    // It is returned on its own, not mixed with the keyboard pad. Keyboard mode forces the virtual pad.
    // A focus change can make Chromium return an empty list for a moment. Keep the real pad for that gap
    // so the keyboard pad does not take the slot.
    if (controllerMode() !== 'keyboard' && phys.length) {
      lastReal = real.slice();
      lastPhysicalAt = performance.now();
      return deliver(real);
    }
    // Only while focus is coming back. An unplugged pad still falls through to the keyboard.
    let gap = false;
    try { gap = !!(window.__xboxplayPads && window.__xboxplayPads.holding && window.__xboxplayPads.holding()); } catch (e) {}
    if (controllerMode() !== 'keyboard' && gap && lastReal && performance.now() - lastPhysicalAt < 8000) return deliver(lastReal);
    if (!M.enabled && !exposed) return deliver(controllerMode() === 'keyboard' ? [] : real);
    const base = controllerMode() === 'keyboard' ? [] : real.slice();
    const at = place(base);
    if (at < 0) return deliver(base);
    exposed = true;
    base[at] = pad(at); gpCalls++; return deliver(base);
  };
  setInterval(() => { if (gpCalls || keysLive()) debug('game read the virtual pad ' + gpCalls + ' times in 3s'); gpCalls = 0; }, 3000);

  function sendPad(fn, gamepad) {
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: gamepad });
    if (typeof fn === 'function') fn.call(window, e);
    else if (fn && fn.handleEvent) fn.handleEvent(e);
  }
  function emitTo(fn) {
    if (controllerMode() !== 'keyboard' && lastReal) {
      const phys = lastReal.filter(isRealPad);
      if (phys.length) { for (const p of phys) sendPad(fn, p); return; }
    }
    if (!M.enabled) return;
    exposed = true;
    sendPad(fn, pad(slot));
  }
  replayConnected = emitTo;
  function announce() {
    if (!M.enabled) return;
    exposed = true;
    try { const e = new Event('gamepadconnected'); Object.defineProperty(e, 'gamepad', { value: pad(slot) }); window.dispatchEvent(e); } catch (e) {}
  }

  function findMedia(root, out) {
    try {
      root.querySelectorAll('video, canvas').forEach(el => out.push(el));
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) findMedia(el.shadowRoot, out); });
    } catch (e) {}
    return out;
  }
  function big(el) {
    try { const r = el.getBoundingClientRect(); return r.width * r.height > 0.35 * innerWidth * innerHeight; } catch (e) { return false; }
  }
  const peers = new Set();
  try {
    const PC = window.RTCPeerConnection;
    if (PC) window.RTCPeerConnection = new Proxy(PC, { construct(t, args) { const pc = Reflect.construct(t, args); peers.add(pc); return pc; } });
  } catch (e) {}
  function streaming() {
    for (const pc of peers) { try { if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return true; if (pc.connectionState === 'closed') peers.delete(pc); } catch (e) {} }
    return findMedia(document, []).some(v => v.tagName === 'VIDEO' && v.srcObject && v.srcObject.active);
  }
  function refreshStream() {
    streamLive = streaming();
    return streamLive;
  }
  function streamTarget(e) {
    if (!streaming()) return null;
    const path = (e.composedPath && e.composedPath()) || [e.target];
    if (path.some(n => n && n.tagName === 'XBOXPLAY-UI')) return null;
    const hit = path.find(n => n && (n.tagName === 'VIDEO' || n.tagName === 'CANVAS') && big(n));
    if (hit) return hit;
    return findMedia(document, []).find(el => big(el) && (el.tagName === 'CANVAS' || el.readyState >= 2)) || document.body;
  }
  function unmuteMedia() {
    try { document.querySelectorAll('video, audio').forEach(el => { el.muted = false; const p = el.play && el.play(); if (p && p.catch) p.catch(() => {}); }); }
    catch (e) {}
  }

  function lockPointer(el) {
    unmuteMedia();
    const fallback = () => {
      try { el.requestPointerLock(); debug('pointer lock requested'); }
      catch (err) { debug('pointer lock failed', err && err.message); }
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.then === 'function') {
        p.then(() => debug('pointer lock on (unadjusted)')).catch(err => {
          debug('unadjustedMovement failed, retrying', err && err.message);
          fallback();
        });
        return;
      }
    } catch (err) {
      debug('pointer lock options not supported', err && err.message);
      fallback();
    }
  }

  function applyMove(e) {
    if (!pointerOn()) return;
    let mx = e.movementX, my = e.movementY;
    if (!Number.isFinite(mx)) mx = 0;
    if (!Number.isFinite(my)) my = 0;
    if (mx === 0 && my === 0 && typeof e.screenX === 'number' && typeof e.screenY === 'number') {
      if (lastScreenX !== undefined) { mx = e.screenX - lastScreenX; my = e.screenY - lastScreenY; }
      lastScreenX = e.screenX; lastScreenY = e.screenY;
    } else if (typeof e.screenX === 'number') { lastScreenX = e.screenX; lastScreenY = e.screenY; }
    if (e.timeStamp === lastMoveTs && mx === lastMX && my === lastMY) return;
    lastMoveTs = e.timeStamp; lastMX = mx; lastMY = my;
    const boost = Math.abs(mx) + Math.abs(my) <= 4 ? num('trackpad', 2.5) : 1;
    accX += mx * boost; accY += my * boost;
    if (window.__XBOXPLAY_DEBUG && performance.now() - dbgAt > 500) {
      dbgAt = performance.now();
      debug('aim lock=' + !!document.pointerLockElement + ' ev=' + e.type + ' dX=' + mx + ' dY=' + my +
        ' acc=' + accX.toFixed(3) + ',' + accY.toFixed(3) + ' stick=' + rx.toFixed(3) + ',' + ry.toFixed(3));
    }
  }

  const on = (t, f) => ADD.call(window, t, f, true);
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const SWALLOW = new Set(['Space', 'Tab']);

  on('keydown', e => {
    refreshStream();
    if (!M.takingKeys(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const name = byCode()[e.code];
    if (!name && !SWALLOW.has(e.code)) return;
    eat(e);
    if (e.repeat || !name) return;
    held.add(e.code); ts = performance.now();
  });
  on('keyup', e => {
    const had = held.delete(e.code);
    if (!had && !(SWALLOW.has(e.code) && M.takingKeys(e))) return;
    ts = performance.now();
    eat(e);
  });
  on('pointerrawupdate', e => { hasRaw = true; applyMove(e); });
  on('pointermove', e => { if (!hasRaw) applyMove(e); });
  on('mousemove', e => { if (!hasRaw) applyMove(e); });
  on('mousedown', e => {
    refreshStream();
    // Clicking the picture captures the mouse. Also clears the Esc pause, even if the lock fails.
    const streamEl = M.enabled && !document.pointerLockElement && !M.forceActive && streamTarget(e);
    if (window.__XBOXPLAY_DEBUG && M.enabled && !document.pointerLockElement) {
      const t = (e.composedPath && e.composedPath()[0]) || e.target;
      debug('click on ' + (t && t.tagName) + ', stream element ' + (streamEl ? streamEl.tagName : 'not found'));
    }
    if (streamEl) {
      suspended = false;
      const lockEl = [streamEl, document.body, document.documentElement]
        .find(el => el && typeof el.requestPointerLock === 'function');
      if (lockEl) lockPointer(lockEl);
      exposed = true; badge(); eat(e); return;
    }
    if (!pointerOn() || e.button > 2) return;
    mouse.add(e.button); ts = performance.now(); eat(e);
  });
  on('mouseup', e => {
    if (!mouse.delete(e.button)) return;
    ts = performance.now();
    if (pointerOn()) eat(e);
  });
  on('contextmenu', e => { if (pointerOn()) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    debug('pointer lock ' + (locked ? 'on' : 'off'));
    if (locked) { wasLocked = true; suspended = false; return; }
    mouse.clear(); accX = accY = rx = ry = 0; lastScreenX = lastScreenY = undefined;
    // Esc drops the lock. Stop the keyboard too, until they click the stream again.
    // A lock that never landed does not take this path, so keys still work when pointer lock fails.
    if (wasLocked && !M.forceActive) { suspended = true; held.clear(); }
    wasLocked = false; ts = performance.now();
  });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  refreshStream();
  if (M.enabled) {
    let physical = false;
    try { physical = Array.from(origGP.call(navigator) || []).some(Boolean); } catch (e) {}
    if (controllerMode() === 'keyboard' || !physical) { exposed = true; announce(); }
  }
  setInterval(refreshStream, 250);
  const showBadge = () => setTimeout(badge, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBadge); else showBadge();
})();
