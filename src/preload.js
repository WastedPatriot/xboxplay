'use strict';
// Runs sandboxed in an isolated world. Asks the main process for the scripts this page should get,
// then runs them in the page's main world before any page script.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('xboxplayHost', {
  setController(mode) { return ipcRenderer.invoke('xboxplay:controller-set', mode); },
});

function safeGet(k) { try { return window.localStorage.getItem(k); } catch { return null; } }
let scripts = [];
try { scripts = ipcRenderer.sendSync('xboxplay:scripts', { bx: safeGet('xboxplay.bx') !== '0' }) || []; } catch { scripts = []; }
for (const { name, code } of scripts) {
  webFrame.executeJavaScript(code + '\n;void 0').catch(() => console.error('[XboxPlay] ' + name + ' failed to run'));
}
