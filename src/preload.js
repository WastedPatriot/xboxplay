'use strict';
// Runs sandboxed in an isolated world. Asks the main process for the scripts this page should get,
// then runs them in the page's main world before any page script.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('xboxplayHost', {
  setController(mode) { return ipcRenderer.invoke('xboxplay:controller-set', mode); },
  noteSession(info) { return ipcRenderer.invoke('xboxplay:session-note', info); },
  clearStreamCache() { return ipcRenderer.invoke('xboxplay:clear-stream-cache'); },
});

function safeGet(k) { try { return window.localStorage.getItem(k); } catch { return null; } }
function pageCode(name, code) {
  if (name !== 'better-xcloud') return code + '\n;void 0';
  // The userscript appends to document.head. At document-start that node is still null.
  return '(function(){function __xboxplayBx(){try{\n' + code + '\n}catch(e){console.error("[XboxPlay] better-xcloud failed to run", e&&e.message?e.message:e)}}'
    + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",__xboxplayBx,{once:true});else __xboxplayBx();})()';
}
let scripts = [];
try { scripts = ipcRenderer.sendSync('xboxplay:scripts', { bx: safeGet('xboxplay.bx') !== '0' }) || []; } catch { scripts = []; }
for (const { name, code } of scripts) {
  webFrame.executeJavaScript(pageCode(name, code)).catch(() => console.error('[XboxPlay] ' + name + ' failed to run'));
}
