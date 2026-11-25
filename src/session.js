// Remembers the console (xHome) session the page starts, and DELETEs it before the next one.
// The main process calls stop() again when the window closes.
(() => {
  if (window.__xboxplaySession) return;
  const log = (...a) => { try { console.log('[XboxPlay]', ...a); } catch (e) {} };

  function bearer(value) {
    const m = String(value || '').trim().match(/^Bearer\s+(\S+)$/i);
    if (!m || m[1].length < 8 || m[1].length > 6000) return '';
    return 'Bearer ' + m[1];
  }
  function headerMap(h) {
    const out = {};
    if (!h) return out;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
        return out;
      }
    } catch (e) {}
    if (Array.isArray(h)) {
      for (const pair of h) if (pair && pair.length >= 2) out[String(pair[0]).toLowerCase()] = String(pair[1]);
      return out;
    }
    if (typeof h === 'object') {
      for (const k of Object.keys(h)) out[String(k).toLowerCase()] = String(h[k]);
    }
    return out;
  }
  function authOf(init, input) {
    const direct = bearer(headerMap(init && init.headers).authorization);
    if (direct) return direct;
    try {
      const h = input && input.headers;
      if (h && typeof h.get === 'function') return bearer(h.get('authorization') || h.get('Authorization'));
    } catch (e) {}
    return bearer(headerMap(input && input.headers).authorization);
  }
  function absUrl(raw) {
    try { return new URL(String(raw || ''), (typeof location !== 'undefined' && location.href) || 'https://www.xbox.com/').href; }
    catch (e) { return ''; }
  }
  function xboxLive(url) {
    let u;
    try { u = new URL(absUrl(url)); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host !== 'xboxlive.com' && !host.endsWith('.xboxlive.com')) return null;
    return u;
  }
  function isHomePlay(url, method) {
    const u = xboxLive(url);
    if (!u || String(method || 'GET').toUpperCase() !== 'POST') return false;
    return /\/v\d+\/sessions\/home\/(?:[0-9a-z-]+\/)?play\/?$/i.test(u.pathname);
  }
  function stopUrlFrom(playUrl, body) {
    const u = xboxLive(playUrl);
    if (!u) return '';
    let data = body;
    if (typeof body === 'string') { try { data = JSON.parse(body); } catch (e) { data = null; } }
    const fromPath = data && data.sessionPath ? String(data.sessionPath).split('?')[0].split('/').filter(Boolean).pop() : '';
    const id = String((data && data.sessionId) || fromPath || '');
    if (!/^[0-9a-f-]{8,}$/i.test(id)) return '';
    const ver = (u.pathname.match(/\/(v\d+)\/sessions\/home\//i) || [])[1];
    const path = (data && data.sessionPath)
      ? ('/' + String(data.sessionPath).replace(/^\/+/, '').split('?')[0])
      : (ver ? ('/' + ver + '/sessions/home/' + id) : '');
    if (!/^\/v\d+\/sessions\/home\/[0-9a-f-]{8,}$/i.test(path)) return '';
    return u.origin + path;
  }
  function sessionFromUrl(url, authorization) {
    const u = xboxLive(url);
    const token = bearer(authorization);
    if (!u || !token) return null;
    const m = u.pathname.match(/\/(v\d+)\/sessions\/home\/([0-9a-f-]{8,})(?:\/|$)/i);
    if (!m) return null;
    return { stopUrl: u.origin + '/' + m[1] + '/sessions/home/' + m[2], authorization: token };
  }
  function requestUrl(input) {
    if (typeof input === 'string') return input;
    try { if (input && typeof input.url === 'string') return input.url; } catch (e) {}
    return '';
  }
  function requestMethod(input, init) {
    try { return String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); }
    catch (e) { return 'GET'; }
  }

  let current = null;
  function same(a, b) {
    return !!a && !!b && a.stopUrl === b.stopUrl && a.authorization === b.authorization;
  }
  function note(next) {
    if (same(current, next)) return;
    current = next || null;
    try {
      const host = window.xboxplayHost;
      if (host && host.noteSession) host.noteSession(current ? { stopUrl: current.stopUrl, authorization: current.authorization } : null);
    } catch (e) {}
  }
  function rawFetch() {
    return window.__xboxplayOrigFetch || window.fetch;
  }
  function stop() {
    const s = current;
    if (!s || !s.stopUrl || !s.authorization) return Promise.resolve(false);
    const fetch = rawFetch();
    if (typeof fetch !== 'function') return Promise.resolve(false);
    return Promise.resolve(fetch(s.stopUrl, {
      method: 'DELETE',
      headers: { Authorization: s.authorization },
      keepalive: true,
    })).then(r => {
      const gone = !!(r && (r.ok || r.status === 404 || r.status === 401 || r.status === 403));
      if (gone) note(null);
      if (r && (r.ok || r.status === 404)) log('stopped the console session');
      else log('console session stop returned ' + (r && r.status));
      return !!(r && (r.ok || r.status === 404));
    }).catch(() => { log('could not stop the console session'); return false; });
  }
  function remember(playUrl, authorization, body) {
    const stopUrl = stopUrlFrom(playUrl, body);
    const token = bearer(authorization);
    if (!stopUrl || !token) return null;
    const next = { stopUrl, authorization: token };
    if (!same(current, next)) log('console session started');
    note(next);
    return next;
  }
  function soon(p) {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(finish, 1500);
      function finish() { if (done) return; done = true; clearTimeout(timer); resolve(); }
      try { Promise.resolve(p).then(finish, finish); } catch (e) { finish(); }
    });
  }
  function clearCache() {
    try {
      const host = window.xboxplayHost;
      if (host && host.clearStreamCache) return soon(host.clearStreamCache());
    } catch (e) {}
    return Promise.resolve();
  }
  function beforeStart(url, method) {
    if (!isHomePlay(url, method)) return Promise.resolve();
    return clearCache().then(() => (current ? stop() : undefined));
  }
  function watch(url, method, authorization, res) {
    const seen = sessionFromUrl(url, authorization);
    if (seen) note(seen);
    if (!isHomePlay(url, method) || !res || typeof res.clone !== 'function') return res;
    try { res.clone().json().then(body => { remember(url, authorization, body); }).catch(() => {}); } catch (e) {}
    return res;
  }

  function installFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__xboxplaySession) return;
    const orig = window.fetch.bind(window);
    window.__xboxplayOrigFetch = orig;
    function wrapped(input, init) {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const authorization = authOf(init, input);
      const run = () => Promise.resolve(orig(input, init)).then(res => watch(url, method, authorization, res));
      if (!isHomePlay(url, method)) {
        const seen = sessionFromUrl(url, authorization);
        if (seen) note(seen);
        return run();
      }
      return Promise.resolve(beforeStart(url, method)).then(run, run);
    }
    wrapped.__xboxplaySession = true;
    window.fetch = wrapped;
  }
  function installXHR() {
    const Orig = window.XMLHttpRequest;
    if (typeof Orig !== 'function' || Orig.__xboxplaySession) return;
    function Wrapped() {
      const xhr = new Orig();
      let method = 'GET';
      let url = '';
      let authorization = '';
      const open = xhr.open;
      xhr.open = function (m, u) {
        method = String(m || 'GET').toUpperCase();
        url = String(u || '');
        return open.apply(xhr, arguments);
      };
      const setHeader = xhr.setRequestHeader;
      xhr.setRequestHeader = function (k, v) {
        if (String(k || '').toLowerCase() === 'authorization') authorization = bearer(v);
        return setHeader.apply(xhr, arguments);
      };
      const send = xhr.send;
      xhr.send = function (body) {
        const go = () => send.call(xhr, body);
        xhr.addEventListener('load', () => {
          try {
            const text = xhr.responseText || '';
            watch(url, method, authorization, {
              clone() { return { json: () => Promise.resolve(text ? JSON.parse(text) : null) }; },
            });
          } catch (e) {}
        });
        if (!isHomePlay(url, method)) { go(); return; }
        Promise.resolve(beforeStart(url, method)).then(go, go);
      };
      return xhr;
    }
    Wrapped.__xboxplaySession = true;
    Wrapped.prototype = Orig.prototype;
    window.XMLHttpRequest = Wrapped;
  }

  window.__xboxplaySession = {
    isHomePlay, stopUrlFrom, authOf, sessionFromUrl, remember, stop, beforeStart,
    current() { return current; },
  };
  try { installFetch(); } catch (e) { log('could not watch session requests'); }
  try { installXHR(); } catch (e) {}
  try { window.addEventListener('pagehide', () => { stop(); }); } catch (e) {}
})();
