'use strict';
// Default keyboard -> virtual Xbox pad, and the optional local override.
// Face buttons, D-pad, triggers, view, menu and the Xbox button follow Greenlight
// (one physical key, full press while held). Bumpers are Q and R. Stick clicks
// are F and G, because Q and R are the bumpers. Greenlight leaves the sticks
// unmapped; WASD and IJKL fill those in. L is the right stick, so it is not a click.
const fs = require('fs');
const path = require('path');

const DEFAULT_KEYMAP = Object.freeze({
  LSUp: 'KeyW',
  LSDown: 'KeyS',
  LSLeft: 'KeyA',
  LSRight: 'KeyD',
  RSUp: 'KeyI',
  RSDown: 'KeyK',
  RSLeft: 'KeyJ',
  RSRight: 'KeyL',
  DUp: 'ArrowUp',
  DDown: 'ArrowDown',
  DLeft: 'ArrowLeft',
  DRight: 'ArrowRight',
  A: 'Enter',
  B: 'Backspace',
  X: 'KeyX',
  Y: 'KeyY',
  LB: 'KeyQ',
  RB: 'KeyR',
  LT: 'Minus',
  RT: 'Equal',
  L3: 'KeyF',
  R3: 'KeyG',
  View: 'KeyV',
  Menu: 'KeyM',
  Guide: 'KeyN',
});

const ACTIONS = Object.freeze(Object.keys(DEFAULT_KEYMAP));

// Single key codes only. No Escape / F-keys (those are app shortcuts) and no
// Ctrl, Alt, or Meta (those are chords, not a controller button).
const CODE_RE = /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Numpad(?:Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(?:Up|Down|Left|Right)|Shift(?:Left|Right)|Enter|Space|Tab|Backspace|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Home|End|PageUp|PageDown|IntlBackslash|IntlYen)$/;

const MAX_BYTES = 8192;

function copyMap(src) {
  const out = Object.create(null);
  for (const name of ACTIONS) out[name] = src[name];
  return out;
}

function parseKeymap(text) {
  const fallback = () => copyMap(DEFAULT_KEYMAP);
  let json;
  try { json = JSON.parse(text); }
  catch { return { map: fallback(), error: 'not json' }; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { map: fallback(), error: 'not an object' };
  if (Object.getPrototypeOf(json) !== Object.prototype) return { map: fallback(), error: 'bad object' };
  const map = fallback();
  const keys = Object.keys(json);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_KEYMAP, key)) return { map: fallback(), error: 'unknown control' };
    const code = json[key];
    if (typeof code !== 'string' || !CODE_RE.test(code)) return { map: fallback(), error: 'bad key' };
    map[key] = code;
  }
  const used = Object.create(null);
  for (const name of ACTIONS) {
    const code = map[name];
    if (used[code]) return { map: fallback(), error: 'duplicate key' };
    used[code] = name;
  }
  return { map, error: null };
}

function loadKeymap(dir) {
  const fallback = () => ({ map: copyMap(DEFAULT_KEYMAP), error: null });
  if (typeof dir !== 'string' || !dir) return { map: copyMap(DEFAULT_KEYMAP), error: 'unreadable' };
  const file = path.join(dir, 'keymap.json');
  let lst;
  try { lst = fs.lstatSync(file); }
  catch (e) {
    if (e && e.code === 'ENOENT') return fallback();
    return { map: copyMap(DEFAULT_KEYMAP), error: 'unreadable' };
  }
  if (lst.isSymbolicLink()) return { map: copyMap(DEFAULT_KEYMAP), error: 'symlink' };
  if (!lst.isFile()) return { map: copyMap(DEFAULT_KEYMAP), error: 'not a file' };
  if (lst.size > MAX_BYTES) return { map: copyMap(DEFAULT_KEYMAP), error: 'too large' };
  if (lst.size === 0) return { map: copyMap(DEFAULT_KEYMAP), error: 'empty' };

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let fd;
  try { fd = fs.openSync(file, flags); }
  catch (e) {
    const code = e && e.code;
    if (code === 'ELOOP' || code === 'EPERM') return { map: copyMap(DEFAULT_KEYMAP), error: 'symlink' };
    return { map: copyMap(DEFAULT_KEYMAP), error: 'unreadable' };
  }
  try {
    const st = fs.fstatSync(fd);
    if (st.isSymbolicLink()) return { map: copyMap(DEFAULT_KEYMAP), error: 'symlink' };
    if (!st.isFile()) return { map: copyMap(DEFAULT_KEYMAP), error: 'not a file' };
    if (st.size > MAX_BYTES) return { map: copyMap(DEFAULT_KEYMAP), error: 'too large' };
    if (st.size === 0) return { map: copyMap(DEFAULT_KEYMAP), error: 'empty' };
    const buf = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buf, 0, st.size, 0);
    return parseKeymap(buf.toString('utf8', 0, n));
  } catch {
    return { map: copyMap(DEFAULT_KEYMAP), error: 'unreadable' };
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

module.exports = { DEFAULT_KEYMAP, ACTIONS, CODE_RE, MAX_BYTES, parseKeymap, loadKeymap };
