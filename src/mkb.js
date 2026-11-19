// XboxPlay built-in keyboard + mouse -> virtual standard gamepad (www.xbox.com and play.xbox.com).
// Runs in the page's main world. Only intercepts input while the mouse is captured (pointer lock).
// Two layouts: on foot (WASD = left stick) and driving (W/S = RT/LT, A/D = steering).
(() => {
  if (window.__xboxplayMKB) return;
  const LS = window.localStorage, origGP = Navigator.prototype.getGamepads;
  const get = (k, d) => { const v = LS.getItem('xboxplay.' + k); return v === null ? d : v; };
  const num = (k, d) => { const v = parseFloat(get(k, '')); return Number.isFinite(v) ? v : d; };

  // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 D-pad, 16 Guide
  const SHARED = { KeyE: 0, ShiftLeft: 0, ShiftRight: 0, KeyC: 1, Backspace: 1, KeyR: 2, KeyV: 3, KeyQ: 4, KeyF: 5,
    Tab: 8, Enter: 9, KeyX: 10, KeyZ: 11, ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15, Home: 16 };
  const FOOT = { ...SHARED, Space: 0 };
  const DRIVE = { ...SHARED, Space: 5 };
  const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL', 'KeyG', 'ControlLeft', 'ControlRight']);

  const held = new Set(), mouse = new Set();
  const cur = { lx: 0, ly: 0, lt: 0, rt: 0 };            // smoothed analog values
  let accX = 0, accY = 0, rx = 0, ry = 0, ts = performance.now(), announced = false, lastSwitch = 0, last = performance.now();
  const pref = LS.getItem('xboxplay.mkb');
  const M = window.__xboxplayMKB = {
    enabled: pref ? pref === '1' : true, forceActive: false, mode: get('mode', 'foot') === 'drive' ? 'drive' : 'foot',
    active() { return this.enabled && (this.forceActive || !!document.pointerLockElement); },
    toggle() { this.enabled = !this.enabled; LS.setItem('xboxplay.mkb', this.enabled ? '1' : '0'); if (!this.enabled) { reset(); document.exitPointerLock && document.exitPointerLock(); } else announce();
      toast(this.enabled ? 'Keyboard & mouse on · click the stream, Esc releases' : 'Keyboard & mouse off'); badge(); },
    set(on) { if (on !== this.enabled) this.toggle(); },
    setMode(m, quiet) { this.mode = m === 'drive' ? 'drive' : 'foot'; LS.setItem('xboxplay.mode', this.mode); lastSwitch = performance.now();
      if (!quiet) toast(this.mode === 'drive' ? 'Driving mode' : 'On foot'); badge(); },
    setSensitivity(v) { LS.setItem('xboxplay.sens', String(v)); },
    state() { return { mode: this.mode, ...cur, rx, ry }; },
    refreshBadge() { badge(); },
  };
  // If Better xCloud is loaded and the user never chose, leave input to Better xCloud.
  setTimeout(() => { if (!pref && window.BX_EXPOSED) { M.enabled = false; badge(); } }, 0);

  function reset() { held.clear(); mouse.clear(); accX = accY = rx = ry = 0; Object.keys(cur).forEach(k => { cur[k] = 0; }); ts = performance.now(); }
  function toast(t) { if (window.__xboxplayUI) window.__xboxplayUI.toast(t); }
  function badge() { if (window.__xboxplayUI && window.__xboxplayUI.badge) window.__xboxplayUI.badge(M.enabled && get('badge', '1') !== '0' ? M.mode : null); }
  const clamp = v => Math.max(-1, Math.min(1, v));
  const h = c => held.has(c) ? 1 : 0;

  // What the keys/mouse ask for right now (before smoothing).
  function targets() {
    const lt = Math.max(mouse.has(2) ? 1 : 0, h('KeyK')), rt = Math.max(mouse.has(0) ? 1 : 0, h('KeyL'));
    let lx = h('KeyD') - h('KeyA');
    if (M.mode === 'drive') return { lx, ly: 0, lt: Math.max(lt, h('KeyS')), rt: Math.max(rt, h('KeyW')) };
    let ly = h('KeyS') - h('KeyW');
    const len = Math.hypot(lx, ly); if (len > 1) { lx /= len; ly /= len; }                // diagonals
    const walk = held.has('ControlLeft') || held.has('ControlRight') ? 0.5 : 1;
    return { lx: lx * walk, ly: ly * walk, lt, rt };
  }

  // Ramp towards the target: ~smoothing ms to full, twice as fast to release or recenter.
  function tick() {
    const now = performance.now(), dt = now - last; last = now;
    const ms = num('smooth', 100), t = targets();
    for (const k of Object.keys(cur)) {
      const from = cur[k], to = t[k];
      if (from === to) continue;
      const releasing = Math.abs(to) < Math.abs(from) && Math.sign(to) !== -Math.sign(from);
      const step = ms <= 0 ? 2 : dt / (releasing ? ms / 2 : ms);
      cur[k] = Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step;
      ts = now;
    }
    // Mouse/trackpad -> right stick with a short decay, so swipes feel continuous.
    const s = num('sens', parseFloat(window.__XBOXPLAY_SENS) || 1) * 0.04, inv = get('invertY', '0') === '1' ? -1 : 1;
    const curve = v => get('curve', 'linear') === 'smooth' ? Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 0.6) : v;
    const nx = clamp(curve(accX * s)), ny = clamp(curve(accY * s) * inv);
    if (nx !== rx || ny !== ry) ts = now;
    rx = nx; ry = ny; accX *= 0.6; accY *= 0.6;
    if (Math.abs(accX) < 0.3) accX = 0; if (Math.abs(accY) < 0.3) accY = 0;
  }
  setInterval(tick, 8);

  function pad(index) {
    const map = M.mode === 'drive' ? DRIVE : FOOT, on = new Array(17).fill(0);
    for (const c of held) if (c in map) on[map[c]] = 1;
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
    if (!M.enabled) return real;
    slot = real.findIndex(p => !p); if (slot < 0) slot = real.length;
    while (real.length < 4) real.push(null);
    real[slot] = pad(slot); return real;
  };
  function announce() { if (announced) return; announced = true; try { const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: pad(slot) }); window.dispatchEvent(e); } catch (e) {} }

  const on = (t, f) => window.addEventListener(t, f, true);
  const mapped = c => c in FOOT || c in DRIVE || MOVE.has(c);
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  on('keydown', e => {
    if (!M.active() || !mapped(e.code)) return;
    eat(e); if (e.repeat) return;
    if (e.code === 'KeyG') { M.setMode(M.mode === 'drive' ? 'foot' : 'drive'); return; }    // manual resync
    held.add(e.code); ts = performance.now();
  });
  on('keyup', e => {
    const c = e.code; if (!held.has(c)) return; held.delete(c); ts = performance.now();
    // V is Y (enter/exit vehicle): flip the layout when it's released.
    if (c === 'KeyV' && get('autoSwitch', '1') !== '0' && performance.now() - lastSwitch > 500) M.setMode(M.mode === 'drive' ? 'foot' : 'drive');
    if (M.active()) eat(e);
  });
  on('mousemove', e => {
    if (!M.active()) return;
    const boost = Math.abs(e.movementX) + Math.abs(e.movementY) <= 4 ? num('trackpad', 1) : 1;     // small deltas = trackpad / slow moves
    accX += e.movementX * boost; accY += e.movementY * boost;
  });
  on('mousedown', e => {
    if (M.enabled && !document.pointerLockElement && [...document.querySelectorAll('video')].some(v => v.readyState >= 2)) {
      (document.body || document.documentElement).requestPointerLock(); announce(); badge(); eat(e); return; }
    if (!M.active() || (e.button !== 0 && e.button !== 2)) return; mouse.add(e.button); eat(e);
  });
  on('mouseup', e => { if (mouse.delete(e.button) && M.active()) eat(e); });
  on('contextmenu', e => { if (M.active()) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) reset(); });
  window.addEventListener('blur', reset);
  if (M.enabled) announce();
  const showBadge = () => setTimeout(badge, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBadge); else showBadge();
})();
