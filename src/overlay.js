// XboxPlay overlay: F1 controls guide, F3 settings, toasts. Runs in the page's main world.
// Built with DOM APIs only (no innerHTML) inside a closed shadow root so the page can't restyle it.
(() => {
  if (window.__xboxplayUI) return;
  const LS = window.localStorage;
  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 2147483647;
      background: rgba(0,0,0,.35); opacity: 0; transition: opacity .18s ease; font-family: "Segoe UI", Inter, system-ui, sans-serif; }
    .wrap.show { opacity: 1; }
    .card { min-width: 560px; max-width: 760px; color: #e8e8e8; padding: 22px 26px 18px; border-radius: 16px;
      background: rgba(18,20,22,.82); backdrop-filter: blur(18px) saturate(140%); border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 20px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.05); transform: translateY(6px); transition: transform .18s ease; }
    .wrap.show .card { transform: none; }
    h1 { font-size: 17px; font-weight: 600; margin: 0 0 4px; color: #fff; display: flex; align-items: center; gap: 10px; }
    h1::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #3ddc5b; box-shadow: 0 0 10px #3ddc5b; }
    .sub { font-size: 12.5px; color: #9aa0a6; margin: 0 0 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
    section h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #3ddc5b; margin: 0 0 8px; font-weight: 600; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13.5px; padding: 3px 0; }
    .row span:first-child { color: #c9cdd1; white-space: nowrap; }
    .keys { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    kbd { font: 600 11.5px/1 ui-monospace, "JetBrains Mono", monospace; color: #f2f2f2; padding: 5px 7px; min-width: 14px; text-align: center;
      border-radius: 6px; background: linear-gradient(#2c2f33, #222427); border: 1px solid #3a3d42; border-bottom-width: 2px; }
    .or { color: #6b7075; font-size: 11px; align-self: center; }
    .foot { margin-top: 16px; font-size: 12px; color: #8a9096; display: flex; justify-content: space-between; }
    .status { color: #3ddc5b; } .status.off { color: #e06c6c; }
    label.set { display: flex; justify-content: space-between; align-items: center; font-size: 14px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    input[type=range] { width: 220px; accent-color: #3ddc5b; }
    input[type=checkbox] { width: 18px; height: 18px; accent-color: #3ddc5b; }
    .val { font: 600 12px ui-monospace, monospace; color: #3ddc5b; width: 40px; text-align: right; }
    .toast { position: fixed; left: 50%; bottom: 42px; transform: translate(-50%, 10px); z-index: 2147483647; opacity: 0;
      transition: opacity .2s, transform .2s; padding: 10px 16px 10px 14px; border-radius: 10px; color: #f0f0f0; font: 500 14px "Segoe UI", system-ui, sans-serif;
      background: rgba(18,20,22,.9); border: 1px solid rgba(61,220,91,.35); box-shadow: 0 10px 30px rgba(0,0,0,.5); display: flex; gap: 10px; align-items: center; }
    .toast::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #3ddc5b; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .grid.three { grid-template-columns: 1fr 1fr 1fr; } .card.wide { max-width: 980px; }
    .badge { position: fixed; top: 14px; left: 14px; z-index: 2147483646; display: flex; align-items: center; gap: 6px; padding: 5px 9px;
      border-radius: 8px; background: rgba(18,20,22,.6); border: 1px solid rgba(255,255,255,.08); color: #cfd3d6;
      font: 600 11px "Segoe UI", system-ui, sans-serif; letter-spacing: .04em; pointer-events: none; opacity: .75; }
    .badge svg { width: 15px; height: 15px; fill: #3ddc5b; }
    select { background: #222427; color: #eee; border: 1px solid #3a3d42; border-radius: 6px; padding: 4px 6px; font: inherit; }
    .note { font-size: 12.5px; color: #9aa0a6; margin: 0 0 8px; min-height: 1.2em; }
    .note.ok { color: #3ddc5b; } .note.bad { color: #e6a23c; }`;

  let host, root, panel = null, toastTimer;
  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('xboxplay-ui');
    root = host.attachShadow({ mode: 'closed' });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch { const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st); }
    document.documentElement.appendChild(host);
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
    for (const c of kids.flat(Infinity)) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const keys = (...groups) => el('div', { class: 'keys' }, groups.map((g, i) => [i ? el('span', { class: 'or' }, 'or') : [], g.split(' ').map(k => el('kbd', null, k))]));
  const row = (label, ...groups) => el('div', { class: 'row' }, el('span', null, label), keys(...groups));
  const sec = (title, ...rows) => el('section', null, el('h2', null, title), ...rows);

  function close() { if (!panel) return; const p = panel; panel = null; p.classList.remove('show'); setTimeout(() => p.remove(), 180); }
  function open(kind, build) {
    mount(); const was = panel && panel.dataset.kind; close(); if (was === kind) return;
    const wrap = el('div', { class: 'wrap', onclick: e => { if (e.target === wrap) close(); } }, build());
    wrap.dataset.kind = kind; root.appendChild(wrap); panel = wrap;
    if (document.pointerLockElement) document.exitPointerLock();
    requestAnimationFrame(() => wrap.classList.add('show'));
  }
  const mkbOn = () => !!(window.__xboxplayMKB && window.__xboxplayMKB.enabled);

  function guide() {
    open('guide', () => el('div', { class: 'card wide' },
      el('h1', null, 'XboxPlay controls'),
      el('p', { class: 'sub' }, 'Matches GTA 6 default controls. Click the stream to capture the mouse, Esc lets it go. A short tap of F or V gets in or out of a vehicle and switches the layout; G if it gets out of step.'),
      el('div', { class: 'grid three' },
        sec('On foot', row('Move', 'W A S D'), row('Run (L3)', 'Shift'), row('Jump / climb (A)', 'Space'), row('Crouch (B)', 'C', 'Ctrl'),
          row('Interact / enter (Y)', 'E', 'F', 'V'), row('Melee (X)', 'R'), row('Cover (RB)', 'Q'), row('Loadout (LB)', 'Tab'),
          row('Aim (LT)', 'RMB', 'K'), row('Shoot (RT)', 'LMB', 'L'), row('Zoom / look back (R3)', 'MMB', 'Z'), row('Focus (L3+R3)', 'T')),
        sec('Driving', row('Accelerate (RT)', 'W', 'L'), row('Brake / reverse (LT)', 'S', 'RMB', 'K'), row('Steer', 'A D'),
          row('Handbrake (A)', 'Space'), row('Horn / nitrous (L3)', 'Shift', 'H'), row('Shoot (RB)', 'LMB'), row('Exit (Y)', 'F', 'V', 'E'),
          row('Duck (B)', 'C', 'Ctrl'), row('Kick / door (X)', 'R'), row('Sidearm (LB)', 'Tab'), row('Yell (R3)', 'MMB', 'Z')),
        sec('Shared', row('Map (View)', 'M'), row('Pause (Menu)', 'Enter', 'P'), row('Phone', '↑'), row('Show HUD', '↓'),
          row('Partner / switch', '→'), row('Radio / vehicle menu', '←'), row('Switch layout', 'G'), row('Back (B)', 'Backspace'), row('L3', 'X'), row('Guide', 'Home'))),
      el('div', { class: 'grid', style: 'margin-top:14px' },
        sec('Phone', row('Open', '↑'), row('Scroll', 'Wheel'), row('Select (A)', 'LMB'), row('Close (B)', 'RMB', 'C', 'Backspace')),
        sec('App', row('This guide', 'F1'), row('Keyboard & mouse on/off', 'F2'), row('Settings', 'F3'),
          row('Reload', 'F5'), row('Fullscreen', 'F11'), row('Release mouse', 'Esc'))),
      el('div', { class: 'foot' },
        el('span', { class: 'status' + (mkbOn() ? '' : ' off') }, mkbOn() ? '● Keyboard & mouse on · ' + (window.__xboxplayMKB.mode === 'drive' ? 'driving' : 'on foot') : '● Keyboard & mouse off'),
        el('span', null, 'F1 or Esc to close'))));
  }

  function settings() {
    open('settings', () => {
      const slider = (key, label, min, max, step, def, fmt) => {
        const cur = parseFloat(LS.getItem('xboxplay.' + key)); const v = Number.isFinite(cur) ? cur : def;
        const val = el('span', { class: 'val' }, fmt(v));
        const inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v),
          oninput: e => { val.textContent = fmt(+e.target.value); LS.setItem('xboxplay.' + key, e.target.value); } });
        return el('label', { class: 'set' }, el('span', null, label), el('span', null, inp, ' ', val));
      };
      const toggle = (key, label, def, after) => {
        const c = el('input', { type: 'checkbox', onchange: e => { LS.setItem('xboxplay.' + key, e.target.checked ? '1' : '0'); if (after) after(e.target.checked); } });
        c.checked = (LS.getItem('xboxplay.' + key) || def) === '1';
        return el('label', { class: 'set' }, el('span', null, label), c);
      };
      const curve = el('select', { onchange: e => LS.setItem('xboxplay.curve', e.target.value) },
        el('option', { value: 'linear' }, 'Linear'), el('option', { value: 'smooth' }, 'Smooth'));
      curve.value = LS.getItem('xboxplay.curve') || 'linear';
      const sensDef = parseFloat(window.__XBOXPLAY_SENS) || 2;
      const check = (key, on, fn) => { const c = el('input', { type: 'checkbox', onchange: e => fn(e.target.checked) }); c.checked = on; return c; };
      const refresh = () => window.__xboxplayMKB && window.__xboxplayMKB.refreshBadge();
      const current = (window.__xboxplayMKB && window.__xboxplayMKB.controllerMode) ? window.__xboxplayMKB.controllerMode() : (LS.getItem('xboxplay.controller') || 'auto');
      const pick = el('select', { onchange: e => { if (window.__xboxplayMKB) window.__xboxplayMKB.setController(e.target.value); controllerHint(); } },
        el('option', { value: 'auto' }, 'Controller if plugged in'),
        el('option', { value: 'wired' }, 'Wired USB'),
        el('option', { value: 'bluetooth' }, 'Bluetooth'),
        el('option', { value: 'keyboard' }, 'Keyboard'));
      pick.value = current;
      statusEl = el('p', { class: 'note' }, '');
      controllerHint();
      return el('div', { class: 'card' },
        el('h1', null, 'Settings'),
        el('p', { class: 'sub' }, 'Saved on this computer. Changes apply straight away.'),
        el('label', { class: 'set' }, el('span', null, 'Controller'), pick),
        statusEl,
        slider('sens', 'Mouse sensitivity', 0.2, 8, 0.1, sensDef, v => v.toFixed(1)),
        slider('trackpad', 'Trackpad boost (small movements)', 1, 6, 0.1, 2.5, v => v.toFixed(1) + '×'),
        slider('antidz', 'Aim kick (beats the game deadzone)', 0, 0.5, 0.01, 0.22, v => v.toFixed(2)),
        el('label', { class: 'set' }, el('span', null, 'Mouse curve'), curve),
        slider('smooth', 'Key smoothing (0 = instant)', 0, 250, 10, 100, v => v + 'ms'),
        toggle('invertY', 'Invert Y axis', '0'),
        toggle('autoSwitch', 'Auto-switch on foot / driving on a short V tap', '1'),
        toggle('badge', 'Show mode badge', '1', refresh),
        el('label', { class: 'set' }, el('span', null, 'Built-in keyboard & mouse'),
          check('mkb', mkbOn(), on => window.__xboxplayMKB && window.__xboxplayMKB.set(on))),
        toggle('bx', 'Better xCloud on xbox.com/play (needs reload)', '1'),
        el('div', { class: 'foot' }, el('span', null, ''), el('span', null, 'F3 or Esc to close')));
    });
  }

  let statusEl = null, lastBad = '';
  function controllerLine() {
    const mode = (window.__xboxplayMKB && window.__xboxplayMKB.controllerMode) ? window.__xboxplayMKB.controllerMode() : 'auto';
    if (mode === 'keyboard') return { text: 'Using the keyboard. A plugged-in controller is ignored.', kind: 'ok' };
    const dev = window.__XBOXPLAY_DEVICES;
    if (!dev || !dev.scanned) return { text: '', kind: '' };
    const wired = dev.wired || [], bluetooth = dev.bluetooth || [];
    if (mode === 'auto') {
      if (wired.length || bluetooth.length) return { text: 'Using ' + (wired[0] || bluetooth[0]), kind: 'ok' };
      return { text: '', kind: '' };
    }
    const list = mode === 'wired' ? wired : bluetooth;
    const other = mode === 'wired' ? bluetooth : wired;
    if (list.length) return { text: (mode === 'wired' ? 'Wired USB: ' : 'Bluetooth: ') + list[0], kind: 'ok' };
    if (other.length) {
      return { text: mode === 'wired'
        ? 'No wired USB controller found. A Bluetooth controller is connected.'
        : 'No Bluetooth controller found. A wired USB controller is connected.', kind: 'bad' };
    }
    return { text: mode === 'wired'
      ? 'No wired USB controller found. Plug it in (xpad or xone). It should show up as /dev/input/js*.'
      : 'No Bluetooth controller found. Pair it and check that xpadneo or the kernel HID driver is in use.', kind: 'bad' };
  }
  function controllerHint() {
    const line = controllerLine();
    if (statusEl) {
      statusEl.textContent = line.text;
      statusEl.className = 'note' + (line.kind === 'bad' ? ' bad' : line.kind === 'ok' ? ' ok' : '');
    }
    if (line.kind !== 'bad') { lastBad = ''; return; }
    if (!line.text || line.text === lastBad) return;
    lastBad = line.text;
    let seen = '';
    try { seen = sessionStorage.getItem('xboxplay.padMsg') || ''; } catch (e) {}
    if (seen === line.text) return;
    try { sessionStorage.setItem('xboxplay.padMsg', line.text); } catch (e) {}
    toast(line.text);
  }

  function toast(text) {
    mount(); const t = el('div', { class: 'toast' }, text); root.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2400);
  }

  // Small corner badge showing the current layout (null hides it).
  let badgeEl = null;
  const ICONS = {
    drive: 'M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11a2 2 0 012 2v4h-2v2h-3v-2H8v2H5v-2H3v-4a2 2 0 012-2zm2.1 0h9.8l-1-3H8.1l-1 3zM6.5 15a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm11 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    foot: 'M13.5 5.5a2 2 0 100-4 2 2 0 000 4zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0019 13v-2a5 5 0 01-4.3-2.4l-1-1.6a2 2 0 00-1.7-1 2 2 0 00-.8.2L6 8.3V13h2V9.6l1.8-.7',
    phone: 'M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zm5 18.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM8 4h8v13H8V4z',
  };
  function badge(mode) {
    if (!document.documentElement) return;
    mount();
    if (!mode) { if (badgeEl) badgeEl.remove(); badgeEl = null; return; }
    if (!badgeEl) { badgeEl = el('div', { class: 'badge' }); root.appendChild(badgeEl); }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICONS[mode] || ICONS.foot); svg.appendChild(path);
    badgeEl.replaceChildren(svg, document.createTextNode(mode === 'drive' ? 'DRIVING' : mode === 'phone' ? 'PHONE' : 'ON FOOT'));
  }

  window.addEventListener('keydown', e => { if (e.code === 'Escape' && panel) { close(); e.preventDefault(); } }, true);
  window.__xboxplayUI = Object.freeze({ guide, settings, toast, badge, close, controllerHint, isOpen: () => !!panel });
  setInterval(() => { try { controllerHint(); } catch (e) {} }, 1000);
})();
