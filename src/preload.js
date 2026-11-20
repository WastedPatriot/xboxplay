'use strict';
// Runs sandboxed in an isolated world. Asks the main process for the scripts this page should get,
// then runs them in the page's main world before any page script.
const { ipcRenderer, webFrame } = require('electron');

function safeGet(k) { try { return window.localStorage.getItem(k); } catch { return null; } }
async function inject() {
  let scripts = [];
  try { scripts = ipcRenderer.sendSync('xboxplay:scripts', { bx: safeGet('xboxplay.bx') !== '0' }) || []; } catch { scripts = []; }
  for (const { name, code } of scripts) {
    try { await webFrame.executeJavaScript(code + '\n;void 0'); }
    catch { console.error('[XboxPlay] ' + name + ' failed to run'); }
  }
}
inject();
