// Headless smoke test: xvfb-run -a npx electron test/smoke.js
// Starts the real app, waits for the page, opens the F1 guide and F3 settings, checks they render,
// checks the virtual gamepad reacts to a key, and saves screenshots. Exits non-zero on failure.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const OUT = process.env.XBOXPLAY_SHOT_DIR || '/tmp';
let failed = false;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed = true; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.on('browser-window-created', (ev, win) => {
  if (BrowserWindow.getAllWindows().length > 1) return;
  win.webContents.once('did-finish-load', async () => {
    const wc = win.webContents, js = c => wc.executeJavaScript(c);
    try {
      await sleep(8000); await js("localStorage.setItem('xboxplay.mkb','1'); window.__xboxplayMKB.enabled = true");
      const u = new URL(wc.getURL());
      check(/xbox\.com$/.test(u.hostname), 'xbox page loaded: ' + u.origin + u.pathname + ' (' + wc.getTitle() + ')');
      check(await js('!!window.__xboxplayUI && !!window.__xboxplayMKB'), 'overlay + keyboard/mouse layer injected');
      wc.focus(); wc.sendInputEvent({ type: 'keyDown', keyCode: 'F1' }); await sleep(600);
      check(await js('window.__xboxplayUI.isOpen()'), 'F1 guide opens');
      fs.writeFileSync(OUT + '/xboxplay-guide.png', (await wc.capturePage()).toPNG());
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'F3' }); await sleep(600);
      check(await js('window.__xboxplayUI.isOpen()'), 'F3 settings opens');
      fs.writeFileSync(OUT + '/xboxplay-settings.png', (await wc.capturePage()).toPNG());
      check(!wc.isAudioMuted(), 'audio is not muted');
      await js('window.__xboxplayUI.close(); window.__xboxplayMKB.enabled = true; window.__xboxplayMKB.forceActive = true');
      const press = code => js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true, cancelable: true }))`);
      const release = code => js(`window.dispatchEvent(new KeyboardEvent('keyup', { code: ${JSON.stringify(code)}, bubbles: true, cancelable: true }))`);
      const pad = `(function () { const p = [...navigator.getGamepads()].find(g => g && g.id && g.id.includes('XInput')); return p && { mapping: p.mapping, connected: p.connected, n: p.buttons.length, a: p.buttons[0].pressed, enter: p.buttons[0].value, ly: p.axes[1], rt: p.buttons[7].value, lt: p.buttons[6].value, up: p.buttons[12].pressed }; })()`;
      await press('Enter');
      let s = await js(pad);
      check(s && s.mapping === 'standard' && s.connected && s.n === 17 && s.a && s.enter === 1, 'Enter presses A on a standard Xbox pad');
      await release('Enter');
      await press('KeyW');
      s = await js(pad);
      check(s && s.ly === -1, 'W is full left-stick up on the first sample');
      await sleep(40);
      s = await js(pad);
      check(s && s.ly === -1, 'W stays full left-stick up while held');
      await release('KeyW');
      await press('Equal');
      s = await js(pad);
      check(s && s.rt === 1, 'Equal is a full RT (throttle)');
      await release('Equal');
      await press('Minus');
      s = await js(pad);
      check(s && s.lt === 1, 'Minus is a full LT (brake)');
      await release('Minus');
      await press('ArrowUp');
      s = await js(pad);
      check(s && s.up && await js('window.__xboxplayMKB.phone == null && typeof window.__xboxplayMKB.setMode !== "function"'), 'Arrow up is the D-pad, with no phone mode or layout switch');
      await release('ArrowUp');
    } catch (e) { check(false, 'smoke error: ' + e.message); }
    app.exit(failed ? 1 : 0);
  });
});
setTimeout(() => { check(false, 'timeout'); app.exit(1); }, 60000);
require('../src/main.js');
