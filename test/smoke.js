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
      await js('window.__xboxplayUI.close(); window.__xboxplayMKB.enabled = true; window.__xboxplayMKB.forceActive = true; window.__xboxplayMKB.setMode("foot", true)');
      await sleep(300);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); await sleep(100);
      check(await js(`(() => { const p = [...navigator.getGamepads()].find(g => g && g.id.includes('XInput')); return !!p && p.mapping === 'standard' && p.buttons[0].pressed; })()`), 'Space presses A (jump) on the virtual pad');
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await sleep(600);   // mode switches are debounced by 0.5s
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'V' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'V' });
      await sleep(120);   // Y is held at least 60ms, then a short tap flips the layout
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'W' }); await sleep(300);
      check(await js(`(() => { const p = [...navigator.getGamepads()].find(g => g && g.id.includes('XInput')); const ok = window.__xboxplayMKB.mode === 'drive' && !window.__xboxplayMKB.phone && p.buttons[7].value >= 0.98 && p.axes[1] === 0; if (!ok) console.log('[XboxPlay] smoke V/W', window.__xboxplayMKB.mode, window.__xboxplayMKB.phone, p.buttons[7].value, p.axes[1]); return ok; })()`), 'V switches to driving, W = full RT');
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'W' });
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Up' }); await sleep(80);
      check(await js('window.__xboxplayMKB.phone === true'), 'Up arrow enters phone mode');
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'C' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'C' }); await sleep(80);
      check(await js('window.__xboxplayMKB.phone === false'), 'C leaves phone mode');
    } catch (e) { check(false, 'smoke error: ' + e.message); }
    app.exit(failed ? 1 : 0);
  });
});
setTimeout(() => { check(false, 'timeout'); app.exit(1); }, 60000);
require('../src/main.js');
