'use strict';
// The console session we may still need to DELETE if the process dies mid-stream.
// The file holds a bearer token, so it stays in the profile, mode 0600, and a symlink is left alone.
const fs = require('fs');
const path = require('path');

const FILE = 'session.json';
const MAX = 12000;

function sessionPath(dir) {
  return path.join(dir, FILE);
}

function bearer(value) {
  const m = String(value || '').trim().match(/^Bearer\s+(\S+)$/i);
  if (!m || m[1].length < 8 || m[1].length > 6000) return '';
  return 'Bearer ' + m[1];
}

function validSession(info) {
  if (!info || typeof info !== 'object') return null;
  const authorization = bearer(info.authorization);
  if (!authorization || typeof info.stopUrl !== 'string') return null;
  let u;
  try { u = new URL(info.stopUrl); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'xboxlive.com' && !host.endsWith('.xboxlive.com')) return null;
  if (!/^\/v\d+\/sessions\/home\/[0-9a-f-]{8,}$/i.test(u.pathname)) return null;
  return { stopUrl: u.origin + u.pathname, authorization };
}

function readSession(dir) {
  if (!dir) return null;
  const file = sessionPath(dir);
  let st;
  try { st = fs.lstatSync(file); } catch { return null; }
  if (st.isSymbolicLink() || !st.isFile() || st.size === 0 || st.size > MAX) return null;
  try { return validSession(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return null; }
}

function writeSession(dir, info) {
  const saved = validSession(info);
  if (!dir || !saved) return false;
  const file = sessionPath(dir);
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return false;
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return false;
  }
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { return false; }
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(saved) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

function eraseSession(dir) {
  if (!dir) return;
  const file = sessionPath(dir);
  let st;
  try { st = fs.lstatSync(file); } catch { return; }
  if (st.isSymbolicLink() || st.isFile()) {
    try { fs.unlinkSync(file); } catch {}
  }
}

module.exports = { sessionPath, bearer, validSession, readSession, writeSession, eraseSession };
