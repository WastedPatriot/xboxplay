// Renders assets/icon.svg to assets/icon.png (256x256). Run: npx electron scripts/render-icon.js
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 256, height: 256, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadFile(path.join(__dirname, '..', 'assets', 'icon.svg'));
  await new Promise(r => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), img.resize({ width: 256, height: 256 }).toPNG());
  app.quit();
});
