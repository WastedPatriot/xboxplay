// XboxPlay overlay: F1 controls guide, F3 settings, toasts. Runs in the page's main world.
// Built with DOM APIs only (no innerHTML) inside a closed shadow root so the page can't restyle it.
(() => {
  if (window.__xboxplayUI) return;
  const LS = window.localStorage;
  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 2147483647; overflow: auto;
      background: rgba(0,0,0,.35); opacity: 0; transition: opacity .18s ease; font-family: "Segoe UI", Inter, system-ui, sans-serif; }
    .wrap.show { opacity: 1; }
    .card { min-width: 560px; max-width: 760px; max-height: calc(100vh - 40px); overflow: auto; color: #e8e8e8; padding: 22px 26px 18px; border-radius: 16px;
      background: rgba(18,20,22,.82); backdrop-filter: blur(18px) saturate(140%); border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 20px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.05); transform: translateY(6px); transition: transform .18s ease; }
    .wrap.show .card { transform: none; }
    h1 { font-size: 17px; font-weight: 600; margin: 0 0 4px; color: #fff; display: flex; align-items: center; gap: 10px; }
    h1::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #3ddc5b; box-shadow: 0 0 10px #3ddc5b; }
    .sub { font-size: 12.5px; color: #9aa0a6; margin: 0 0 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 56px; }
    .card.wide { min-width: 880px; max-width: 980px; }
    section h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #3ddc5b; margin: 0 0 8px; font-weight: 600; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13.5px; padding: 3px 0; }
    .row span:first-child { color: #c9cdd1; white-space: nowrap; }
    .keys { display: flex; gap: 4px; flex-wrap: nowrap; justify-content: flex-end; }
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
    .badge { position: fixed; top: 14px; left: 14px; z-index: 2147483646; display: flex; align-items: center; gap: 6px; padding: 5px 9px;
      border-radius: 8px; background: rgba(18,20,22,.6); border: 1px solid rgba(255,255,255,.08); color: #cfd3d6;
      font: 600 11px "Segoe UI", system-ui, sans-serif; letter-spacing: .04em; pointer-events: none; opacity: .75; }
    .net { position: fixed; top: 14px; right: 14px; z-index: 2147483646; padding: 5px 9px; border-radius: 8px;
      background: rgba(18,20,22,.6); border: 1px solid rgba(255,255,255,.08); color: #cfd3d6;
      font: 600 11px "Segoe UI", system-ui, sans-serif; letter-spacing: .02em; pointer-events: none; opacity: .85; }
    .net.fair { color: #e6c07b; } .net.poor { color: #e06c6c; border-color: rgba(224,108,108,.45); }
    .note { font-size: 12.5px; color: #9aa0a6; margin: 0 0 8px; min-height: 1.2em; }
    .note.ok { color: #3ddc5b; } .note.bad { color: #e6a23c; }
    select { background: #222427; color: #eee; border: 1px solid #3a3d42; border-radius: 6px; padding: 4px 6px; font: inherit; }
    button.btn { background: #222427; color: #eee; border: 1px solid #3a3d42; border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; }`;

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
      el('p', { class: 'sub' }, 'One controller. Click the stream to capture the mouse, Esc lets it go. A key stays down while you hold it. Triggers are a full press.'),
      el('div', { class: 'grid' },
        sec('Move',
          row('Left stick', 'W A S D'), row('Right stick', 'I J K L'), row('Look', 'Mouse'), row('D-pad', 'Arrows'),
          row('LT, brake', '-'), row('RT, throttle', '='), row('LB', 'Q'), row('RB', 'R'),
          row('Left stick click', 'F'), row('Right stick click', 'G', 'MMB'), row('Aim', 'RMB'), row('Shoot', 'LMB')),
        sec('Buttons',
          row('A', 'Enter'), row('B', 'Backspace'), row('X', 'X'), row('Y', 'Y'),
          row('View', 'V'), row('Menu', 'M'), row('Xbox', 'N'),
          row('This guide', 'F1'), row('Keyboard and mouse', 'F2'), row('Settings', 'F3'),
          row('Re-attach controller', 'F4'),
          row('Reload', 'F5'), row('Fullscreen', 'F11'), row('Release mouse', 'Esc'))),
      el('div', { class: 'foot' },
        el('span', { class: 'status' + (mkbOn() ? '' : ' off') }, mkbOn() ? 'Keyboard and mouse on' : 'Keyboard and mouse off'),
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
      const quality = el('select', { onchange: e => LS.setItem('xboxplay.quality', e.target.value) },
        el('option', { value: 'auto' }, 'Auto'),
        el('option', { value: 'stable' }, 'Stable, about 6 Mb/s'),
        el('option', { value: 'high' }, 'High, about 15 Mb/s'));
      quality.value = LS.getItem('xboxplay.quality') || (window.__XBOXPLAY_QUALITY || 'auto');
      if (quality.value !== 'auto' && quality.value !== 'stable' && quality.value !== 'high') quality.value = 'auto';
      return el('div', { class: 'card' },
        el('h1', null, 'Settings'),
        el('p', { class: 'sub' }, 'Saved on this computer. Changes apply straight away.'),
        el('label', { class: 'set' }, el('span', null, 'Controller'), pick),
        el('label', { class: 'set' }, el('span', null, 'Controller not responding'),
          el('button', { class: 'btn', type: 'button', onclick: () => { if (window.__xboxplayPads) window.__xboxplayPads.reattach('manual'); } }, 'Re-attach')),
        statusEl,
        el('label', { class: 'set' }, el('span', null, 'Stream quality'), quality),
        el('p', { class: 'note' }, 'Bitrate applies the next time the stream connects.'),
        toggle('reconnect', 'Reconnect if the stream drops', '1'),
        toggle('idle', 'Keep the stream awake when you step away', '1'),
        slider('sens', 'Mouse sensitivity', 0.2, 8, 0.1, sensDef, v => v.toFixed(1)),
        slider('trackpad', 'Trackpad boost (small movements)', 1, 6, 0.1, 2.5, v => v.toFixed(1) + '×'),
        slider('antidz', 'Aim kick (beats the game deadzone)', 0, 0.5, 0.01, 0.22, v => v.toFixed(2)),
        el('label', { class: 'set' }, el('span', null, 'Mouse curve'), curve),
        toggle('invertY', 'Invert Y axis', '0'),
        toggle('badge', 'Show keyboard badge', '1', refresh),
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

  // Small corner badge. Pass false to hide it.
  let badgeEl = null;
  function badge(on) {
    if (!document.documentElement) return;
    mount();
    if (!on) { if (badgeEl) badgeEl.remove(); badgeEl = null; return; }
    if (!badgeEl) { badgeEl = el('div', { class: 'badge' }); root.appendChild(badgeEl); }
    badgeEl.textContent = 'KB';
  }

  window.addEventListener('keydown', e => { if (e.code === 'Escape' && panel) { close(); e.preventDefault(); } }, true);
  let netEl = null;
  function streamStatus(info) {
    if (!document.documentElement) return;
    mount();
    if (!info || !info.text) { if (netEl) netEl.remove(); netEl = null; return; }
    if (!netEl) { netEl = el('div', { class: 'net' }); root.appendChild(netEl); }
    netEl.className = 'net' + (info.level === 'poor' ? ' poor' : info.level === 'fair' ? ' fair' : '');
    netEl.textContent = info.text;
  }

  window.__xboxplayUI = Object.freeze({ guide, settings, toast, badge, close, controllerHint, streamStatus, isOpen: () => !!panel });
  setInterval(() => { try { controllerHint(); } catch (e) {} }, 1000);
})();
