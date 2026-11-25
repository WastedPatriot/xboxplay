// Keeps an xCloud session from ending when nobody is at the keyboard.
// On by default. F3 stores xboxplay.idle = 0 to turn it off.
(() => {
  if (window.__xboxplayIdle) return;
  const LS = window.localStorage;
  const NUDGE_AFTER = 3 * 60 * 1000;
  const NUDGE = 0.02;
  // Exact button labels, after lowercasing and stripping accents. Not class names.
  const STILL = [
    "i'm still here", 'i am still here', 'still here',
    'je suis toujours la', 'sigo aqui', 'todavia estoy aqui', 'aun estoy aqui',
    'ainda estou aqui', 'sono ancora qui', 'ich bin noch da', 'ik ben er nog',
    'jag ar fortfarande har', 'jeg er fortsatt her', 'jeg er her stadig',
    'nadal tu jestem', 'meg itt vagyok', 'porad jsem tady', 'olen yha taalla',
    'я еще здесь', 'hala buradayim',
    'まだここにいます', '我还在', '我還在', '아직 여기 있어요',
  ];
  const INACTIVITY = /still here|inactivity|session will end|toujours la|inactiv|sesion|inactividad|inattiv|bezczyn|nog steeds|まだここ|我还在|我還在|아직 여기/;
  const CANCEL = /^(cancel|close|exit|quit|disconnect|end session|no|annuler|abbrechen|cancelar|fechar|chiudi|sluiten|avbryt|отмена)$/i;

  function idleOn() {
    try {
      const v = LS && LS.getItem('xboxplay.idle');
      if (v == null || v === '') return true;
      return v !== '0';
    } catch (e) { return true; }
  }
  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
      .replace(/[\u2019\u2018`]/g, "'")
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function stillHereText(text) {
    const t = norm(text);
    if (!t || t.length > 40) return false;
    const bare = t.replace(/[.!]+$/, '');
    for (const s of STILL) {
      const n = norm(s);
      if (n === t || n === bare) return true;
    }
    return false;
  }
  function mentionsIdle(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return INACTIVITY.test(raw) || INACTIVITY.test(norm(text));
  }
  function isCancel(text) {
    const t = norm(text);
    return !t || CANCEL.test(t);
  }
  function visible(el) {
    if (!el || el.hidden || el.disabled) return false;
    try { if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; } catch (e) {}
    try { if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false; } catch (e) {}
    return true;
  }
  function roleOf(el) {
    try { return (el.getAttribute && el.getAttribute('role')) || ''; } catch (e) { return ''; }
  }
  function isButton(el) {
    const tag = String(el.tagName || '').toUpperCase();
    const role = roleOf(el);
    if (tag === 'BUTTON' || role === 'button') return true;
    if (tag === 'INPUT') {
      const t = (el.getAttribute && el.getAttribute('type')) || '';
      return t === 'button' || t === 'submit';
    }
    return false;
  }
  function textOf(el) {
    return String((el && (el.textContent || el.value)) || '').replace(/\s+/g, ' ').trim();
  }
  function list(node, sel) {
    if (!node || typeof node.querySelectorAll !== 'function') return [];
    try { return Array.from(node.querySelectorAll(sel)); } catch (e) { return []; }
  }

  // The confirm button, plus whether a modal is on screen. Shadow roots are included.
  // Only an inactivity dialog supplies a button we will press. Any other dialog just
  // means the mouse should be let go, so the user can click it.
  function inspect(root) {
    const buttons = [];
    const dialogs = [];
    const inactivity = [];
    if (!root) return { button: null, modal: false };
    function take(el) {
      if (!el || el === root || !visible(el)) return;
      const text = textOf(el);
      if (isButton(el)) buttons.push(el);
      const role = roleOf(el);
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
      if (role === 'dialog' || role === 'alertdialog') dialogs.push(el);
      if (text.length > 10 && text.length < 700 && mentionsIdle(text)) inactivity.push(el);
    }
    function walk(node, depth) {
      if (!node || depth > 6) return;
      for (const el of list(node, '*')) {
        take(el);
        if (el && el.shadowRoot) walk(el.shadowRoot, depth + 1);
      }
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
    }
    walk(root, 0);
    for (const s of extraRoots) {
      if (!s || s.isConnected === false || (s.host && s.host.isConnected === false)) {
        extraRoots.delete(s);
        continue;
      }
      walk(s, 1);
    }
    let button = null;
    for (const b of buttons) if (stillHereText(textOf(b))) { button = b; break; }
    if (!button) {
      for (const d of inactivity) {
        const inner = list(d, 'button, [role="button"], input[type="button"], input[type="submit"]').filter(el => isButton(el) && visible(el));
        const pool = inner.length ? inner : buttons.filter(b => d.contains ? d.contains(b) : false);
        for (const b of pool) if (stillHereText(textOf(b))) { button = b; break; }
        if (button) break;
        for (const b of pool) {
          const t = textOf(b);
          if (t && t.length <= 40 && !isCancel(t)) { button = b; break; }
        }
        if (button) break;
      }
    }
    return { button, modal: dialogs.length > 0 || inactivity.length > 0 || !!button };
  }
  function findStillHere(root) {
    return inspect(root).button;
  }

  function nudgeDue(lastInput, now, enabled) {
    if (!enabled) return false;
    if (!lastInput || !now) return false;
    return now - lastInput >= NUDGE_AFTER;
  }
  // One right-stick sample under a normal game deadzone. The original pad is left as it was.
  function nudgePad(pad) {
    if (!pad) return pad;
    const axes = Array.from(pad.axes || [0, 0, 0, 0]);
    while (axes.length < 4) axes.push(0);
    const sign = axes[2] < 0 ? -1 : 1;
    let x = axes[2] + sign * NUDGE;
    if (Math.abs(x) < NUDGE) x = sign * NUDGE;
    axes[2] = Math.max(-0.05, Math.min(0.05, x));
    return Object.assign({}, pad, { axes });
  }
  function padBusy(pad) {
    if (!pad) return false;
    try {
      if (Array.from(pad.buttons || []).some(b => b && (b.pressed || b.value > 0.15))) return true;
      if (Array.from(pad.axes || []).some(a => Math.abs(a) > 0.15)) return true;
    } catch (e) {}
    return false;
  }
  function releaseCapture(doc, show) {
    if (!show || !doc || !doc.pointerLockElement || typeof doc.exitPointerLock !== 'function') return false;
    try { doc.exitPointerLock(); return true; } catch (e) { return false; }
  }

  const extraRoots = new Set();
  function watchShadows() {
    const proto = typeof Element === 'function' ? Element.prototype : null;
    if (!proto || typeof proto.attachShadow !== 'function' || proto.attachShadow.__xboxplayIdle) return;
    const orig = proto.attachShadow;
    function wrapped(init) {
      const root = orig.call(this, init);
      try { extraRoots.add(root); } catch (e) {}
      return root;
    }
    wrapped.__xboxplayIdle = true;
    proto.attachShadow = wrapped;
  }

  const log = msg => { try { console.log('[XboxPlay] ' + msg); } catch (e) {} };
  let lastInput = Date.now();
  let sawStream = false;
  let nudgeUntil = 0;
  let lastClick = 0;
  let released = false;

  function noteInput(now) {
    lastInput = now || Date.now();
    nudgeUntil = 0;
  }
  function streaming() {
    try {
      for (const v of list(document, 'video')) {
        if (v && v.videoWidth > 0 && !v.paused) return true;
      }
    } catch (e) {}
    const net = window.__XBOXPLAY_NET;
    return !!(net && net.bitrateMbps > 0);
  }
  function considerNudge(now) {
    const t = now || Date.now();
    if (streaming()) sawStream = true;
    if (!idleOn() || !sawStream) { nudgeUntil = 0; return false; }
    if (t < nudgeUntil) return true;
    if (!nudgeDue(lastInput, t, true)) return false;
    nudgeUntil = t + 250;
    lastInput = t;
    log('idle nudge');
    return true;
  }
  function installWrap() {
    if (typeof Navigator !== 'function' || !Navigator.prototype) return;
    const cur = Navigator.prototype.getGamepads;
    if (typeof cur !== 'function' || cur.__xboxplayIdle) return;
    let nudged = false;
    function anyInput(pad) {
      if (!pad) return false;
      try {
        if (Array.from(pad.buttons || []).some(b => b && (b.pressed || b.value > 0))) return true;
        if (Array.from(pad.axes || []).some(a => Math.abs(a) > 0.05)) return true;
      } catch (e) {}
      return false;
    }
    function realList(list) {
      try {
        const pads = window.__xboxplayPads;
        if (pads && pads.realWins) return pads.realWins(list);
      } catch (e) {}
      return (list || []).filter(p => p && p.connected !== false && p.id !== 'Xbox 360 Controller (XInput STANDARD GAMEPAD)');
    }
    function wrapped() {
      const list = Array.from(cur.call(this) || []);
      // A real pad with any input wins immediately. The nudge is one sample, then the original pad is returned.
      if (realList(list).some(anyInput)) { noteInput(); nudged = false; return list; }
      if (list.some(padBusy)) noteInput();
      if (nudged) { nudged = false; nudgeUntil = 0; return list; }
      if (!considerNudge(Date.now())) return list;
      nudged = true;
      return list.map(p => (p ? nudgePad(p) : p));
    }
    wrapped.__xboxplayIdle = true;
    Navigator.prototype.getGamepads = wrapped;
  }
  // The stream pauses itself if the page looks hidden or unfocused. Keep it looking
  // visible and focused whenever anti-idle is on, and whenever a picture is up.
  function streamUp() {
    try {
      const doc = typeof document !== 'undefined' ? document : null;
      if (doc && typeof doc.querySelectorAll === 'function') {
        for (const v of doc.querySelectorAll('video')) {
          if (v && v.srcObject && v.videoWidth > 0) return true;
        }
      }
    } catch (e) {}
    try {
      const net = window.__XBOXPLAY_NET;
      if (net && (net.bitrateMbps > 0 || net.width > 0)) return true;
    } catch (e) {}
    return false;
  }
  function keepAwake() { return idleOn() || streamUp(); }
  let realHidden = null;
  function pageHidden() {
    try {
      if (realHidden) return !!realHidden.call(typeof document !== 'undefined' ? document : null);
    } catch (e) {}
    return false;
  }
  function overrideVisibility(obj, mark) {
    if (!obj || obj[mark]) return;
    const hidden = Object.getOwnPropertyDescriptor(obj, 'hidden');
    const state = Object.getOwnPropertyDescriptor(obj, 'visibilityState');
    if (hidden && hidden.get && !realHidden) realHidden = hidden.get;
    try {
      if (hidden && hidden.get && hidden.configurable !== false) {
        Object.defineProperty(obj, 'hidden', { configurable: true, get() { return keepAwake() ? false : hidden.get.call(this); } });
      }
      if (state && state.get && state.configurable !== false) {
        Object.defineProperty(obj, 'visibilityState', { configurable: true, get() { return keepAwake() ? 'visible' : state.get.call(this); } });
      }
      obj[mark] = true;
    } catch (e) {}
  }
  function keepVisible() {
    const Doc = typeof Document === 'function' ? Document.prototype : null;
    if (Doc && !Doc.__xboxplayIdle) {
      overrideVisibility(Doc, '__xboxplayIdle');
      try {
        if (typeof Doc.hasFocus === 'function' && !Doc.hasFocus.__xboxplayIdle) {
          const orig = Doc.hasFocus;
          const wrapped = function () { return keepAwake() ? true : orig.call(this); };
          wrapped.__xboxplayIdle = true;
          Doc.hasFocus = wrapped;
        }
      } catch (e) {}
    }
    if (typeof document !== 'undefined') overrideVisibility(document, '__xboxplayVis');
  }
  function scan() {
    try { keepVisible(); } catch (e) {}
    installWrap();
    const doc = typeof document !== 'undefined' ? document : null;
    const ui = window.__xboxplayUI;
    const open = !!(ui && ui.isOpen && ui.isOpen());
    const seen = inspect(doc);
    const modal = open || seen.modal;
    if (modal) {
      if (releaseCapture(doc, true) && !released) log('released the mouse for a dialog');
      released = true;
    } else released = false;
    if (!idleOn() || !seen.button) return;
    const now = Date.now();
    if (now - lastClick < 2000) return;
    lastClick = now;
    try { seen.button.click(); log("clicked I'm still here"); } catch (e) {}
  }
  function onActivity() { noteInput(); }

  window.__xboxplayIdle = {
    NUDGE_AFTER, idleOn, stillHereText, findStillHere, nudgeDue, nudgePad, releaseCapture, pageHidden,
    markIdle(since) { lastInput = since; sawStream = true; nudgeUntil = 0; },
    poll: considerNudge,
    tick: scan,
  };
  try { watchShadows(); } catch (e) {}
  try { keepVisible(); } catch (e) {}
  try { installWrap(); } catch (e) {}
  setTimeout(installWrap, 0);
  setTimeout(installWrap, 50);
  const listen = (type) => { try { window.addEventListener(type, onActivity, true); } catch (e) {} };
  ['keydown', 'keyup', 'mousedown', 'mousemove', 'wheel', 'pointerdown', 'touchstart'].forEach(listen);
  setInterval(() => { try { scan(); } catch (e) {} }, 1000);
})();
