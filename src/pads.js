// Puts a real controller back in front after the window loses focus.
// xCloud's PollingModeManager drops polling to "none" on blur, and Chromium
// stops updating the Gamepad API until something asks again.
(() => {
  if (window.__xboxplayPads) return;
  const VIRTUAL = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
  const log = (...a) => { try { console.log('[XboxPlay]', ...a); } catch (e) {} };
  let native = null;
  try { native = Navigator.prototype.getGamepads; } catch (e) {}

  function normalizePoll(mode) {
    const m = String(mode == null ? '' : mode).trim().toLowerCase();
    if (m === 'all' || m === 'none' || m === 'buttons') return m;
    return '';
  }
  function realWins(list) {
    const out = [];
    for (const p of list || []) {
      if (p && p.connected !== false && p.id !== VIRTUAL) out.push(p);
    }
    return out;
  }
  function padSig(list) {
    const parts = [];
    for (const p of realWins(list)) {
      let buttons = '', axes = '';
      try { buttons = Array.from(p.buttons || []).map(b => (b && (b.pressed || b.value > 0) ? '1' : '0')).join(''); } catch (e) {}
      try { axes = Array.from(p.axes || []).map(a => String(Math.round((Number(a) || 0) * 20))).join(','); } catch (e) {}
      parts.push((p.index == null ? '' : p.index) + ':' + buttons + ':' + axes);
    }
    return parts.join(';');
  }
  function collectManagers(root) {
    const out = [];
    const seen = new Set();
    function walk(obj, depth) {
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function') || seen.has(obj) || depth > 3) return;
      seen.add(obj);
      let fn = null;
      try { fn = obj.setPollingMode; } catch (e) { return; }
      if (typeof fn === 'function') out.push(obj);
      if (depth === 3) return;
      let keys = [];
      try { keys = Object.keys(obj); } catch (e) { return; }
      let n = 0;
      for (const k of keys) {
        if (++n > 30) break;
        if (k === 'parent' || k === 'parentNode' || k === 'ownerDocument' || k === 'window' || k === 'document' || k === 'top') continue;
        try { walk(obj[k], depth + 1); } catch (e) {}
      }
    }
    walk(root, 0);
    return out;
  }
  // A physical pad changed, and either polling is off or the page is not being given that change.
  function shouldReattach(state, sample, now) {
    const t = now || 0;
    const prev = state || { since: 0, sig: '', cool: 0 };
    if (!sample || !sample.live) return { action: 'ok', state: { since: 0, sig: '', cool: 0 } };
    if (prev.cool && t < prev.cool) return { action: 'ok', state: { since: 0, sig: sample.physicalSig || '', cool: prev.cool } };
    const changed = !!(sample.physicalSig && prev.sig && sample.physicalSig !== prev.sig);
    const bad = sample.poll === 'none' || sample.delivered === false;
    if (changed && bad) {
      const since = prev.since || t;
      if (t - since >= 2000) return { action: 'reattach', state: { since: 0, sig: sample.physicalSig, cool: t + 5000 } };
      return { action: 'ok', state: { since, sig: sample.physicalSig, cool: 0 } };
    }
    if (!bad) return { action: 'ok', state: { since: 0, sig: sample.physicalSig || prev.sig || '', cool: 0 } };
    if (prev.since && t - prev.since >= 2000) return { action: 'reattach', state: { since: 0, sig: sample.physicalSig || prev.sig, cool: t + 5000 } };
    if (prev.since) return { action: 'ok', state: { since: prev.since, sig: sample.physicalSig || prev.sig, cool: 0 } };
    return { action: 'ok', state: { since: 0, sig: sample.physicalSig || prev.sig || '', cool: 0 } };
  }

  let poll = 'all';
  let deliveredSig = '';
  let reads = 0;
  let holdUntil = 0;
  const managers = new Set();
  let watch = { since: 0, sig: '', cool: 0 };
  let lastAt = 0;
  let pump = null;

  function streamLive() {
    try {
      const nodes = document.querySelectorAll ? document.querySelectorAll('video') : [];
      for (const v of nodes) if (v && v.srcObject && (v.videoWidth > 0 || v.readyState >= 2)) return true;
    } catch (e) {}
    try {
      const net = window.__XBOXPLAY_NET;
      if (net && (net.bitrateMbps > 0 || net.width > 0)) return true;
    } catch (e) {}
    return false;
  }
  function remember(obj) {
    if (!obj || typeof obj.setPollingMode !== 'function' || obj.setPollingMode.__xboxplayPads) return;
    const orig = obj.setPollingMode;
    function wrapped(mode) {
      let next = mode;
      if (normalizePoll(mode) === 'none' && streamLive()) next = 'all';
      const named = normalizePoll(next);
      if (named) poll = named;
      return orig.call(this, next);
    }
    wrapped.__xboxplayPads = true;
    try { obj.setPollingMode = wrapped; } catch (e) { return; }
    managers.add(obj);
  }
  function huntFiber() {
    let el = null;
    try { el = (document.querySelector && (document.querySelector('video') || document.body)) || null; } catch (e) {}
    if (!el) return;
    let key = '';
    try { key = Object.keys(el).find(k => k.indexOf('__reactFiber') === 0 || k.indexOf('__reactInternalInstance') === 0) || ''; } catch (e) {}
    let fiber = key && el[key];
    const seen = new Set();
    let steps = 0;
    while (fiber && !seen.has(fiber) && steps < 80) {
      seen.add(fiber);
      steps++;
      try { remember(fiber.stateNode); } catch (e) {}
      try { remember(fiber.memoizedProps); } catch (e) {}
      try { remember(fiber.memoizedState); } catch (e) {}
      try {
        const node = fiber.stateNode;
        if (node && typeof node === 'object') {
          let n = 0;
          for (const k of Object.keys(node)) {
            if (++n > 20) break;
            try { remember(node[k]); } catch (e) {}
          }
        }
      } catch (e) {}
      fiber = fiber.return || fiber.child;
    }
  }
  function hunt() {
    try {
      for (const k of Object.getOwnPropertyNames(window)) {
        if (!/poll|gamepad|xcloud|inputchannel|streamplayer/i.test(k)) continue;
        try {
          for (const obj of collectManagers(window[k])) remember(obj);
        } catch (e) {}
      }
    } catch (e) {}
    try { huntFiber(); } catch (e) {}
  }
  function forceAll() {
    poll = 'all';
    try { if (navigator && 'gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'gamepad'; } catch (e) {}
    hunt();
    for (const obj of managers) {
      try { obj.setPollingMode('all'); } catch (e) {}
    }
    try { if (window.BX_STREAM_SETTINGS) window.BX_STREAM_SETTINGS.xCloudPollingMode = 'all'; } catch (e) {}
  }
  function nativePads() {
    try { return Array.from((native ? native.call(navigator) : navigator.getGamepads()) || []); }
    catch (e) { return []; }
  }
  function announce(pad, type) {
    try {
      const e = new Event(type);
      Object.defineProperty(e, 'gamepad', { value: pad });
      window.dispatchEvent(e);
    } catch (e) {}
  }
  function pumpPads() {
    if (pump) { try { clearInterval(pump); } catch (e) {} }
    let n = 0;
    pump = setInterval(() => {
      try { if (native) native.call(navigator); } catch (e) {}
      if (++n >= 15) { clearInterval(pump); pump = null; }
    }, 100);
  }
  function reattach(reason) {
    const now = Date.now();
    if (reason !== 'watch' && reason !== 'manual' && now - lastAt < 400) return false;
    lastAt = now;
    try { if (window.__xboxplayMKB && window.__xboxplayMKB.releaseVirtual) window.__xboxplayMKB.releaseVirtual(); } catch (e) {}
    forceAll();
    const pads = realWins(nativePads());
    for (const p of pads) announce(p, 'gamepadconnected');
    holdUntil = pads.length ? 0 : Date.now() + 2000;
    pumpPads();
    log('controller re-attached');
    if (reason === 'manual') { try { if (window.__xboxplayUI && window.__xboxplayUI.toast) window.__xboxplayUI.toast('Controller re-attached'); } catch (e) {} }
    return true;
  }
  function sample(now) {
    const physical = nativePads();
    const physicalSig = padSig(physical);
    const delivered = reads > 0 && deliveredSig === physicalSig && poll !== 'none';
    return { live: streamLive(), poll, physicalSig, delivered, now };
  }
  function tickWatch(now) {
    const decided = shouldReattach(watch, sample(now), now || Date.now());
    watch = decided.state;
    reads = 0;
    if (decided.action === 'reattach') reattach('watch');
  }

  window.__xboxplayPads = {
    normalizePoll, realWins, padSig, collectManagers, shouldReattach,
    noteDelivered(list) { reads++; deliveredSig = padSig(list); },
    polling() { return poll; },
    holding() { return Date.now() < holdUntil; },
    reattach,
  };
  try { window.addEventListener('blur', () => { holdUntil = Date.now() + 8000; }, true); } catch (e) {}
  try { window.addEventListener('focus', () => { reattach('focus'); }, true); } catch (e) {}
  try { window.addEventListener('pageshow', () => { reattach('show'); }, true); } catch (e) {}
  try {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reattach('show'); }, true);
  } catch (e) {}
  setInterval(() => { try { tickWatch(Date.now()); } catch (e) {} }, 500);
})();
