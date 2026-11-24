'use strict';
// Which controllers are plugged in, and the saved wired / Bluetooth / keyboard choice.
// Electron already exposes a standard-mapped pad for USB devices such as the
// 8BitDo Ultimate 2C (2dc8:310a on xpad). This module only looks at sysfs so the
// UI can say whether that pad is wired or Bluetooth. It does not open the device.
const fs = require('fs');
const path = require('path');

const BUS_USB = 0x0003;
const BUS_BLUETOOTH = 0x0005;
const BTN_A = 0x130;

function wordBits(arch) {
  return (arch || process.arch) === 'ia32' ? 32 : 64;
}

// Kernel prints capability bitmaps as hex unsigned longs, most significant word first.
function parseBitmap(text, bitsPerWord) {
  const set = new Set();
  if (typeof text !== 'string' || !text.trim()) return set;
  const width = bitsPerWord === 32 ? 32 : 64;
  const words = text.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (!/^[0-9a-fA-F]+$/.test(words[i])) continue;
    const word = BigInt('0x' + words[i]);
    const base = (words.length - 1 - i) * width;
    for (let b = 0; b < width; b++) {
      if ((word & (1n << BigInt(b))) !== 0n) set.add(base + b);
    }
  }
  return set;
}

function normalizeController(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'usb' || v === 'wired') return 'wired';
  if (v === 'bt' || v === 'bluetooth') return 'bluetooth';
  if (v === 'keys' || v === 'mkb' || v === 'keyboard') return 'keyboard';
  if (v === 'auto') return 'auto';
  return '';
}

function controllerFromArgv(argv) {
  const args = argv || [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--controller') return normalizeController(args[i + 1]);
    if (typeof a === 'string' && a.startsWith('--controller=')) return normalizeController(a.slice('--controller='.length));
  }
  return '';
}

// Flag, then env, then the saved file, then auto (real pad if one is plugged in).
function resolveController({ argv, env, saved } = {}) {
  const fromArg = controllerFromArgv(argv);
  if (fromArg) return { mode: fromArg, source: 'flag' };
  const fromEnv = normalizeController(env && env.XBOXPLAY_CONTROLLER);
  if (fromEnv) return { mode: fromEnv, source: 'env' };
  const fromSaved = normalizeController(saved);
  if (fromSaved) return { mode: fromSaved, source: 'saved' };
  return { mode: 'auto', source: 'default' };
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

function findDriver(inputDir) {
  let dir = inputDir;
  for (let i = 0; i < 6; i++) {
    const parent = path.join(dir, 'device');
    if (!fs.existsSync(parent)) return '';
    try { dir = fs.realpathSync(parent); } catch { return ''; }
    const link = path.join(dir, 'driver');
    if (!fs.existsSync(link)) continue;
    try { return path.basename(fs.realpathSync(link)); } catch { return ''; }
  }
  return '';
}

function classifyDevice(info) {
  if (!info || (!info.hasJs && !info.hasGamepadButtons)) return null;
  const driver = String(info.driver || '').toLowerCase();
  const phys = String(info.phys || '').toLowerCase();
  const bluetooth = info.bustype === BUS_BLUETOOTH || /xpadneo/.test(driver) || phys.includes('bluetooth');
  if (bluetooth) return 'bluetooth';
  const wired = info.bustype === BUS_USB || phys.startsWith('usb-') || /xpad|xone|gip/.test(driver);
  if (wired) return 'wired';
  return null;
}

// sysClassInput defaults to /sys/class/input. js* and event* nodes that share an input device are one controller.
function listInputDevices(sysClassInput, opts) {
  const base = sysClassInput || '/sys/class/input';
  const bits = (opts && opts.bitsPerWord) || wordBits();
  let names;
  try { names = fs.readdirSync(base); } catch { return []; }
  const byInput = new Map();
  for (const name of names) {
    if (!/^(js|event)\d+$/.test(name)) continue;
    let inputDir;
    try { inputDir = fs.realpathSync(path.join(base, name, 'device')); } catch { continue; }
    let rec = byInput.get(inputDir);
    if (!rec) {
      const bustype = parseInt(readText(path.join(inputDir, 'id/bustype')), 16);
      const vendor = parseInt(readText(path.join(inputDir, 'id/vendor')), 16);
      const product = parseInt(readText(path.join(inputDir, 'id/product')), 16);
      const key = parseBitmap(readText(path.join(inputDir, 'capabilities/key')), bits);
      rec = {
        name: readText(path.join(inputDir, 'name')),
        phys: readText(path.join(inputDir, 'phys')),
        driver: findDriver(inputDir),
        bustype: Number.isFinite(bustype) ? bustype : 0,
        vendor: Number.isFinite(vendor) ? vendor : 0,
        product: Number.isFinite(product) ? product : 0,
        hasGamepadButtons: key.has(BTN_A),
        hasJs: false,
      };
      byInput.set(inputDir, rec);
    }
    if (name.startsWith('js')) rec.hasJs = true;
  }
  const out = [];
  for (const rec of byInput.values()) {
    const kind = classifyDevice(rec);
    if (!kind) continue;
    out.push({
      kind,
      name: rec.name || (kind === 'wired' ? 'Wired controller' : 'Bluetooth controller'),
      vendor: rec.vendor,
      product: rec.product,
      driver: rec.driver,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  return out;
}

function summarizeDevices(devices) {
  const wired = [];
  const bluetooth = [];
  for (const d of devices || []) {
    if (d.kind === 'wired') wired.push(d.name);
    else if (d.kind === 'bluetooth') bluetooth.push(d.name);
  }
  return { wired, bluetooth, scanned: true };
}

function settingsPath(dir) {
  return path.join(dir, 'settings.json');
}

function readControllerSetting(dir) {
  if (!dir) return '';
  const file = settingsPath(dir);
  let st;
  try { st = fs.lstatSync(file); } catch { return ''; }
  if (st.isSymbolicLink() || !st.isFile() || st.size > 8192 || st.size === 0) return '';
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!json || typeof json !== 'object' || Array.isArray(json)) return '';
    return normalizeController(json.controller);
  } catch { return ''; }
}

function writeControllerSetting(dir, mode) {
  const m = normalizeController(mode);
  if (!dir || !m) return false;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = settingsPath(dir);
  let cur = {};
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cur = parsed;
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      try { if (fs.lstatSync(file).isSymbolicLink()) return false; } catch (e2) { if (!e2 || e2.code !== 'ENOENT') return false; }
    }
  }
  cur.controller = m;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
  return true;
}

module.exports = {
  BUS_USB, BUS_BLUETOOTH, BTN_A,
  parseBitmap, normalizeController, controllerFromArgv, resolveController,
  classifyDevice, listInputDevices, summarizeDevices,
  readControllerSetting, writeControllerSetting,
};
