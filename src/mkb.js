// XboxPlay built-in keyboard + mouse -> virtual standard gamepad (www.xbox.com and play.xbox.com).
// Runs in the page's main world. Only intercepts input while the mouse is captured (pointer lock).
// Two layouts: on foot (WASD = left stick) and driving (W/S = RT/LT, A/D = steering).
// Phone mode: opened with D-pad up; wheel scrolls the list, click selects, right click / C closes.
(() => {
  if (window.__xboxplayMKB) return;
  const LS = window.localStorage, origGP = Navigator.prototype.getGamepads;
  const get = (k, d) => { const v = LS.getItem('xboxplay.' + k); return v === null ? d : v; };
  if (LS.getItem('xboxplay.v2') === null) { if (LS.getItem('xboxplay.sens') === '1') LS.setItem('xboxplay.sens', '2'); if (LS.getItem('xboxplay.trackpad') === '1') LS.setItem('xboxplay.trackpad', '2.5'); LS.setItem('xboxplay.v2', '1'); }
  const num = (k, d) => { const v = parseFloat(get(k, '')); return Number.isFinite(v) ? v : d; };
  // xCloud has its own keyboard handling (Space = A and so on). While the mouse is captured, page listeners for
  // keys and mouse never see the events, so only the virtual pad drives the game.
  const ET = typeof EventTarget === 'function' ? EventTarget.prototype : null;
  const ADD = ET ? ET.addEventListener : function (t, f, o) { return window.addEventListener(t, f, o); }, REMOVE = ET && ET.removeEventListener;
  const KM = new Set(['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'mousemove', 'click', 'auxclick', 'dblclick',
    'pointerdown', 'pointerup', 'pointermove', 'pointerrawupdate', 'wheel']);
  const wraps = new WeakMap();
  const muted = e => { const m = window.__xboxplayMKB; return !!(m && m.active() && !(e.target && e.target.closest && e.target.closest('xboxplay-ui'))); };
  if (ET) ET.addEventListener = function (type, fn, opts) {
    if (!KM.has(type) || !fn) return ADD.call(this, type, fn, opts);
    let w = wraps.get(fn);
    if (!w) { w = function (e) { if (muted(e)) return; return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e); }; wraps.set(fn, w); }
    return ADD.call(this, type, w, opts);
  };
  if (ET) ET.removeEventListener = function (type, fn, opts) {
    return REMOVE.call(this, type, (fn && wraps.get(fn)) || fn, opts);
  };
  const debug = (...a) => { if (window.__XBOXPLAY_DEBUG) console.log('[XboxPlay]', ...a); };

  // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 D-pad, 16 Guide
  // Layout follows GTA 6's default controller scheme (gtabase.com controls guide), with PC-style keys.
  const SHARED = { KeyE: 3, KeyF: 3, KeyV: 3, KeyC: 1, ControlLeft: 1, ControlRight: 1, Backspace: 1, KeyR: 2,
    KeyQ: 5, Tab: 4, KeyM: 8, Enter: 9, KeyP: 9, KeyX: 10, KeyZ: 11, Space: 0, ShiftLeft: 10, ShiftRight: 10,
    ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15, Home: 16 };
  const FOOT = { ...SHARED };
  const DRIVE = { ...SHARED, KeyH: 10 };
  const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL', 'KeyG', 'KeyT']);
  const V_MIN = 60, V_HOLD = 400, SWITCH_DEBOUNCE = 500;

  const held = new Set(), mouse = new Set();
  const cur = { lx: 0, ly: 0, lt: 0, rt: 0 };            // smoothed analog values
  let accX = 0, accY = 0, rx = 0, ry = 0, ts = performance.now(), announced = false, lastSwitch = -1e9, last = performance.now();
  let vKey = 'KeyV', phoneWheel = 0, phoneWheelTimer = 0, vDownAt = 0, vTimer = 0, vToggle = false;
  let hasRaw = false, lastMoveTs = -1, lastMX = 0, lastMY = 0, lastScreenX, lastScreenY, dbgAt = 0;
  const pref = LS.getItem('xboxplay.mkb');
  const M = window.__xboxplayMKB = {
    enabled: pref ? pref === '1' : true, forceActive: false, phone: false,
    mode: get('mode', 'foot') === 'drive' ? 'drive' : 'foot',
    active() { return this.enabled && (this.forceActive || !!document.pointerLockElement); },
    toggle() { this.enabled = !this.enabled; LS.setItem('xboxplay.mkb', this.enabled ? '1' : '0'); if (!this.enabled) { reset(); document.exitPointerLock && document.exitPointerLock(); } else announce();
      toast(this.enabled ? 'Keyboard & mouse on · click the stream, Esc releases' : 'Keyboard & mouse off'); badge(); },
    set(on) { if (on !== this.enabled) this.toggle(); },
    setMode(m, quiet) {
      const next = m === 'drive' ? 'drive' : 'foot';
      if (this.mode === next) return;
      this.mode = next; LS.setItem('xboxplay.mode', this.mode); lastSwitch = performance.now();
      if (!quiet) toast(this.mode === 'drive' ? 'Driving mode' : 'On foot'); badge();
    },
    setSensitivity(v) { LS.setItem('xboxplay.sens', String(v)); },
    state() { return { mode: this.mode, phone: this.phone, ...cur, rx, ry }; },
    refreshBadge() { badge(); },
  };
  // If Better xCloud is loaded and the user never chose, leave input to Better xCloud.
  setTimeout(() => { if (!pref && window.BX_EXPOSED) { M.enabled = false; badge(); } }, 0);

  function reset() {
    held.clear(); mouse.clear(); accX = accY = rx = ry = 0; phoneWheel = 0;
    if (vTimer) { clearTimeout(vTimer); vTimer = 0; }
    if (phoneWheelTimer) { clearTimeout(phoneWheelTimer); phoneWheelTimer = 0; }
    Object.keys(cur).forEach(k => { cur[k] = 0; });
    M.phone = false; ts = performance.now(); lastScreenX = lastScreenY = undefined; badge();
  }
  function toast(t) { if (window.__xboxplayUI) window.__xboxplayUI.toast(t); }
  function badge() {
    if (!window.__xboxplayUI || !window.__xboxplayUI.badge) return;
    window.__xboxplayUI.badge(M.enabled && get('badge', '1') !== '0' ? (M.phone ? 'phone' : M.mode) : null);
  }
  const clamp = v => Math.max(-1, Math.min(1, v));
  const h = c => held.has(c) ? 1 : 0;

  function enterPhone() {
    if (M.phone) return;
    M.phone = true; accX = accY = rx = ry = 0;
    toast('Phone · wheel to scroll, click to select, right click or C to close');
    badge();
  }
  function leavePhone(quiet) {
    if (!M.phone) return;
    M.phone = false; phoneWheel = 0;
    if (phoneWheelTimer) { clearTimeout(phoneWheelTimer); phoneWheelTimer = 0; }
    if (!quiet) toast('Phone closed');
    badge();
  }

  // What the keys/mouse ask for right now (before smoothing). Clicks never fight W/S: take the max.
  function targets() {
    const lt = Math.max((!M.phone && mouse.has(2)) ? 1 : 0, h('KeyK'));
    const rt = Math.max((!M.phone && M.mode === 'foot' && mouse.has(0)) ? 1 : 0, h('KeyL'));
    let lx = h('KeyD') - h('KeyA');
    if (M.mode === 'drive') return { lx, ly: 0, lt: Math.max(lt, h('KeyS')), rt: Math.max(rt, h('KeyW')) };
    let ly = h('KeyS') - h('KeyW');
    const len = Math.hypot(lx, ly); if (len > 1) { lx /= len; ly /= len; }                // diagonals
    return { lx, ly, lt, rt };
  }

  // Ramp towards the target with an exponential ease: ~smoothing ms to settle, twice as fast to release.
  function tick() {
    const now = performance.now(), dt = now - last; last = now;
    const ms = num('smooth', 100), t = targets();
    for (const k of Object.keys(cur)) {
      const from = cur[k], to = t[k];
      if (from === to) continue;
      const releasing = Math.abs(to) < Math.abs(from) && Math.sign(to) !== -Math.sign(from);
      if (ms <= 0) { cur[k] = to; }
      else {
        // Factor 5: ease-out that settles in about `smooth` ms (linear used to hit the target at exactly that).
        const a = 1 - Math.exp(-5 * dt / Math.max(1, releasing ? ms / 2 : ms));
        cur[k] = from + (to - from) * a;
        if (Math.abs(to - cur[k]) < 0.02) cur[k] = to;
      }
      ts = now;
    }
    if (M.phone) { rx = ry = 0; accX = accY = 0; }
    else {
      // Mouse/trackpad -> right stick with a short decay, so swipes feel continuous.
      const s = num('sens', parseFloat(window.__XBOXPLAY_SENS) || 2) * 0.04, inv = get('invertY', '0') === '1' ? -1 : 1;
      const curve = v => get('curve', 'linear') === 'smooth' ? Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 0.6) : v;
      let nx = clamp(curve(accX * s)), ny = clamp(curve(accY * s) * inv);
      // Push small values past the game's stick deadzone, otherwise slow trackpad moves do nothing.
      const mag = Math.hypot(nx, ny), ad = num('antidz', 0.22);
      if (mag > 0.002) { const k = Math.min(1, ad + (1 - ad) * Math.min(1, mag)) / mag; nx = clamp(nx * k); ny = clamp(ny * k); }
      else { nx = 0; ny = 0; }
      if (nx !== rx || ny !== ry) ts = now;
      // Decay by time (about 45ms) rather than per tick, so it doesn't flicker between game frames.
      const d = Math.exp(-Math.max(1, dt) / 45);
      rx = nx; ry = ny; accX *= d; accY *= d;
      // No aim deadzone: only drop true float dust so tiny trackpad deltas still add up.
      if (Math.abs(accX) < 0.05) accX = 0; if (Math.abs(accY) < 0.05) accY = 0;
    }
  }
  setInterval(tick, 8);

  function pad(index) {
    const map = M.mode === 'drive' ? DRIVE : FOOT, on = new Array(17).fill(0);
    for (const c of held) if (c in map) on[map[c]] = 1;
    if (held.has('KeyT')) { on[10] = 1; on[11] = 1; }
    if (!M.phone && mouse.has(1)) on[11] = 1;
    if (!M.phone && M.mode === 'drive' && mouse.has(0)) on[5] = 1;
    if (M.phone) {
      if (mouse.has(0)) on[0] = 1;
      if (mouse.has(2)) on[1] = 1;
      if (phoneWheel) on[phoneWheel] = 1;
    }
    on[6] = cur.lt; on[7] = cur.rt;
    const b = on.map((v, i) => { const p = i === 6 || i === 7 ? v > 0.05 : v > 0; return { pressed: p, touched: p, value: v }; });
    const g = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index, connected: true, mapping: 'standard',
      timestamp: ts, axes: [cur.lx, cur.ly, rx, ry].map(clamp), buttons: b, vibrationActuator: null, hapticActuators: [] };
    try { Object.setPrototypeOf(g, Gamepad.prototype); } catch (e) {}
    return g;
  }
  let slot = 0;
  Navigator.prototype.getGamepads = function () {
    const real = Array.from(origGP.call(this) || []);
    // Turning the layer off keeps a neutral pad plugged in (unless a real controller is there), so the game
    // doesn't throw a controller-disconnected error.
    if (!M.enabled && (!announced || real.some(Boolean))) return real;
    slot = real.findIndex(p => !p); if (slot < 0) slot = real.length;
    while (real.length < 4) real.push(null);
    real[slot] = pad(slot); gpCalls++; return real;
  };
  let gpCalls = 0;
  setInterval(() => { if (gpCalls || M.active()) debug('game read the virtual pad ' + gpCalls + ' times in 3s, mode=' + M.mode); gpCalls = 0; }, 3000);
  function announce() { if (announced) return; announced = true; try { const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: pad(slot) }); window.dispatchEvent(e); } catch (e) {} }

  // The stream is a <video> on www.xbox.com, but the new play.xbox.com can draw it on a <canvas> or inside a
  // shadow root. Treat a click on any big video/canvas (or anywhere while one is playing) as a click on the stream.
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
  // Only treat it as the game once a stream is really running: a live WebRTC connection or a live MediaStream
  // on a video. Home page trailers and store videos don't count.
  const peers = new Set();
  try {
    const PC = window.RTCPeerConnection;
    if (PC) window.RTCPeerConnection = new Proxy(PC, { construct(t, args) { const pc = Reflect.construct(t, args); peers.add(pc); return pc; } });
  } catch (e) {}
  function streaming() {
    for (const pc of peers) { try { if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return true; if (pc.connectionState === 'closed') peers.delete(pc); } catch (e) {} }
    return findMedia(document, []).some(v => v.tagName === 'VIDEO' && v.srcObject && v.srcObject.active);
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

  // Try raw (unadjusted) pointer lock first; some Linux/Electron builds throw or reject that option.
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
    if (!M.active() || M.phone) return;
    let mx = e.movementX, my = e.movementY;
    if (!Number.isFinite(mx)) mx = 0;
    if (!Number.isFinite(my)) my = 0;
    // Some Linux pointer-lock paths report 0,0 on movementX/Y but still update screenX/Y.
    if (mx === 0 && my === 0 && typeof e.screenX === 'number' && typeof e.screenY === 'number') {
      if (lastScreenX !== undefined) { mx = e.screenX - lastScreenX; my = e.screenY - lastScreenY; }
      lastScreenX = e.screenX; lastScreenY = e.screenY;
    } else if (typeof e.screenX === 'number') { lastScreenX = e.screenX; lastScreenY = e.screenY; }
    if (e.timeStamp === lastMoveTs && mx === lastMX && my === lastMY) return;
    lastMoveTs = e.timeStamp; lastMX = mx; lastMY = my;
    // Keep fractional trackpad deltas; boost small movements (no rounding, no deadzone).
    const boost = Math.abs(mx) + Math.abs(my) <= 4 ? num('trackpad', 2.5) : 1;
    accX += mx * boost; accY += my * boost;
    if (window.__XBOXPLAY_DEBUG && performance.now() - dbgAt > 500) {
      dbgAt = performance.now();
      debug('aim lock=' + !!document.pointerLockElement + ' ev=' + e.type + ' dX=' + mx + ' dY=' + my +
        ' acc=' + accX.toFixed(3) + ',' + accY.toFixed(3) + ' stick=' + rx.toFixed(3) + ',' + ry.toFixed(3));
    }
  }

  const on = (t, f) => ADD.call(window, t, f, true);
  const mapped = c => c in FOOT || c in DRIVE || MOVE.has(c);
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); };

  function releaseV(code) {
    code = code || vKey;
    if (vTimer || !held.has(code)) return;
    const dur = performance.now() - vDownAt;
    vToggle = get('autoSwitch', '1') !== '0' && dur < V_HOLD && performance.now() - lastSwitch > SWITCH_DEBOUNCE;
    const later = () => {
      vTimer = 0; held.delete(code); ts = performance.now();
      if (vToggle) M.setMode(M.mode === 'drive' ? 'foot' : 'drive');
    };
    const wait = Math.max(0, V_MIN - dur);
    if (wait > 0) vTimer = setTimeout(later, wait);
    else later();
  }

  on('keydown', e => {
    if (!M.active() || !mapped(e.code)) return;
    eat(e); if (e.repeat) return;                                      // one physical press, ignore OS key repeat
    if (e.code === 'KeyG') { M.setMode(M.mode === 'drive' ? 'foot' : 'drive'); return; }
    if (e.code === 'KeyV' || e.code === 'KeyF') {
      if (vTimer) { clearTimeout(vTimer); vTimer = 0; held.delete(vKey); }
      vKey = e.code;
      vDownAt = performance.now(); vToggle = false;
    }
    if (e.code === 'ArrowUp') enterPhone();
    held.add(e.code); ts = performance.now();
  });
  on('keyup', e => {
    const c = e.code;
    if (c === 'KeyV' || c === 'KeyF') {
      if (held.has(c) || (vTimer && vKey === c)) releaseV(c);
      if (M.active()) eat(e);
      return;
    }
    if (!held.has(c)) return; held.delete(c); ts = performance.now();
    if (M.phone && (c === 'KeyC' || c === 'Backspace')) leavePhone();
    if (M.active()) eat(e);
  });
  // pointerrawupdate has uncoalesced fractional deltas; pointermove/mousemove are fallbacks (deduped).
  on('pointerrawupdate', e => { hasRaw = true; applyMove(e); });
  on('pointermove', e => { if (!hasRaw) applyMove(e); });
  on('mousemove', e => { if (!hasRaw) applyMove(e); });
  on('mousedown', e => {
    const streamEl = M.enabled && !document.pointerLockElement && streamTarget(e);
    if (window.__XBOXPLAY_DEBUG && M.enabled && !document.pointerLockElement) {
      const t = (e.composedPath && e.composedPath()[0]) || e.target;
      debug('click on ' + (t && t.tagName) + ', stream element ' + (streamEl ? streamEl.tagName : 'not found'));
    }
    if (streamEl) {
      const lockEl = [streamEl, document.body, document.documentElement]
        .find(el => el && typeof el.requestPointerLock === 'function');
      if (lockEl) lockPointer(lockEl);
      announce(); badge(); eat(e); return;
    }
    if (!M.active() || e.button > 2) return;
    mouse.add(e.button); eat(e);
  });
  on('mouseup', e => {
    if (!mouse.delete(e.button)) return;
    if (M.phone && e.button === 2) leavePhone();
    if (M.active()) eat(e);
  });
  on('wheel', e => {
    // Only handle the wheel in phone mode. Outside it, two-finger trackpad scroll is a wheel event
    // and must reach the page (and not be mistaken for a D-pad press).
    if (!M.active() || !M.phone) return;
    if (e.deltaY === 0 && e.deltaX === 0) return;
    eat(e);
    const dir = (e.deltaY !== 0 ? e.deltaY : e.deltaX) < 0 ? 12 : 13;
    phoneWheel = dir; ts = performance.now();
    clearTimeout(phoneWheelTimer);
    phoneWheelTimer = setTimeout(() => { phoneWheel = 0; phoneWheelTimer = 0; ts = performance.now(); }, V_MIN);
  });
  on('contextmenu', e => { if (M.active()) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => {
    debug('pointer lock ' + (document.pointerLockElement ? 'on' : 'off'));
    if (!document.pointerLockElement) reset();
  });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  if (M.enabled) announce();
  const showBadge = () => setTimeout(badge, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBadge); else showBadge();
})();
