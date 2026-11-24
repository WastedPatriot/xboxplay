// Watches the game stream's WebRTC connection. Runs in the page, before the site's scripts.
// Auto leaves the offer alone. Stable / High add a video bandwidth cap the next time it connects.
(() => {
  if (window.__xboxplayStream) return;
  const LS = window.localStorage;
  const log = (...a) => { try { console.log('[XboxPlay]', ...a); } catch (e) {} };

  function normalizeQuality(v) {
    v = String(v || '').trim().toLowerCase();
    if (v === 'stable' || v === 'low' || v === 'safe') return 'stable';
    if (v === 'high' || v === 'max') return 'high';
    if (v === 'auto') return 'auto';
    return '';
  }
  function qualityMode() {
    return normalizeQuality(LS && LS.getItem('xboxplay.quality')) || normalizeQuality(window.__XBOXPLAY_QUALITY) || 'auto';
  }
  // kbps. 0 means don't touch the SDP.
  function bitrateCap() {
    const m = qualityMode();
    if (m === 'stable') return 6000;
    if (m === 'high') return 15000;
    return 0;
  }
  function lowLatency() { return qualityMode() !== 'stable'; }
  function reconnectEnabled() {
    try {
      const v = LS.getItem('xboxplay.reconnect');
      if (v == null || v === '') return true;
      return v !== '0';
    } catch (e) { return true; }
  }

  // Put b=AS on each video section. Audio is left as it is. Line endings are preserved.
  function applyBitrate(sdp, kbps) {
    const cap = Math.round(Number(kbps));
    if (typeof sdp !== 'string' || !sdp || !Number.isFinite(cap) || cap < 500 || cap > 50000) return sdp;
    const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r\n|\n/);
    const sections = [];
    let cur = [];
    for (const line of lines) {
      if (line.startsWith('m=') && cur.length) { sections.push(cur); cur = []; }
      cur.push(line);
    }
    if (cur.length) sections.push(cur);
    const out = [];
    for (const sec of sections) {
      if (!sec[0].startsWith('m=video')) { out.push(...sec); continue; }
      let has = false;
      const next = [];
      for (const line of sec) {
        if (/^b=AS:/i.test(line)) { next.push('b=AS:' + cap); has = true; continue; }
        if (/^b=TIAS:/i.test(line)) { next.push('b=TIAS:' + (cap * 1000)); continue; }
        next.push(line);
      }
      if (!has) {
        let at = next.findIndex(l => l.startsWith('a='));
        if (at < 0) at = next.length;
        next.splice(at, 0, 'b=AS:' + cap);
      }
      out.push(...next);
    }
    return out.join(nl);
  }

  function hardwareDecoder(name) {
    return /vaapi|v4l2|nvdec|d3d11|videotoolbox|mediacodec|external/i.test(String(name || ''));
  }

  // reports is an array of RTCStats objects. prev is the last video counters, or null.
  function readStats(reports, prev) {
    let video = null, pair = null, remote = null;
    for (const r of reports || []) {
      if (!r || r.isRemote) continue;
      if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) {
        if (!video || (Number(r.bytesReceived) || 0) >= (Number(video.bytesReceived) || 0)) video = r;
      } else if (r.type === 'candidate-pair' && (r.nominated || r.selected || r.state === 'succeeded') && r.currentRoundTripTime != null) {
        pair = r;
      } else if (r.type === 'remote-inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video') && r.roundTripTime != null) {
        remote = r;
      }
    }
    if (!video) return null;
    const t = Number(video.timestamp);
    const bytes = Number(video.bytesReceived) || 0;
    const recv = Number(video.packetsReceived) || 0;
    const lost = Number(video.packetsLost) || 0;
    let bitrateMbps = null, lossPct = null;
    if (prev && Number.isFinite(t) && Number.isFinite(prev.t) && t > prev.t) {
      const dt = (t - prev.t) / 1000;
      if (dt > 0.2 && dt < 30 && bytes >= prev.bytes) bitrateMbps = ((bytes - prev.bytes) * 8) / dt / 1e6;
      const dPackets = (recv + lost) - (prev.recv + prev.lost);
      const dLost = lost - prev.lost;
      if (dPackets > 0 && dLost >= 0) lossPct = (dLost / dPackets) * 100;
    }
    if (bitrateMbps != null && (bitrateMbps < 0 || bitrateMbps > 80)) bitrateMbps = null;
    const rttSec = pair && pair.currentRoundTripTime != null ? Number(pair.currentRoundTripTime)
      : (remote && remote.roundTripTime != null ? Number(remote.roundTripTime) : null);
    return {
      rttMs: rttSec != null && Number.isFinite(rttSec) ? rttSec * 1000 : null,
      lossPct, bitrateMbps,
      width: Number(video.frameWidth) || 0,
      height: Number(video.frameHeight) || 0,
      decoder: video.decoderImplementation || '',
      hardware: hardwareDecoder(video.decoderImplementation),
      prev: { t, bytes, recv, lost },
    };
  }

  // Two poor samples in a row, so one spike doesn't nag.
  function healthOf(sample) {
    if (!sample) return 'idle';
    const rtt = sample.rttMs, loss = sample.lossPct;
    if ((rtt != null && rtt >= 150) || (loss != null && loss >= 5)) return 'poor';
    if ((rtt != null && rtt >= 80) || (loss != null && loss >= 2)) return 'fair';
    return 'good';
  }
  function noteHealth(state, health) {
    if (health === 'poor') state.poorRun = (state.poorRun || 0) + 1;
    else { state.poorRun = 0; state.warned = false; }
    const warn = health === 'poor' && state.poorRun >= 2 && !state.warned;
    if (warn) state.warned = true;
    return warn;
  }
  function statusText(sample) {
    if (!sample) return '';
    const parts = [];
    if (sample.rttMs != null) parts.push(Math.round(sample.rttMs) + ' ms');
    if (sample.bitrateMbps != null) parts.push(sample.bitrateMbps.toFixed(1) + ' Mb/s');
    if (sample.lossPct != null && sample.lossPct >= 1) parts.push(Math.round(sample.lossPct) + '% loss');
    if (sample.hardware) parts.push('HW');
    return parts.join(' · ');
  }
  function poorMessage(sample) {
    const bits = [];
    if (sample && sample.rttMs != null) bits.push(Math.round(sample.rttMs) + ' ms');
    if (sample && sample.lossPct != null) bits.push(Math.round(sample.lossPct) + '% packet loss');
    return 'Connection is poor' + (bits.length ? ' (' + bits.join(', ') + ')' : '') + '. The stream may stutter.';
  }

  function freshLink() {
    return { wasUp: false, sawMedia: false, downSince: 0, attempts: 0, lastTry: 0, gaveUp: false, lastMediaAt: 0, stalled: false, told: false, stat: null };
  }
  function onLinkState(link, iceState, now) {
    if (iceState === 'connected' || iceState === 'completed') {
      link.wasUp = true;
      link.downSince = 0;
      link.attempts = 0;
      link.gaveUp = false;
      link.stalled = false;
      link.told = false;
      link.lastMediaAt = now;
      return 'up';
    }
    if (!link.wasUp || link.gaveUp) return 'ignore';
    if (iceState === 'disconnected' || iceState === 'failed') {
      if (!link.downSince) link.downSince = now;
      return 'down';
    }
    return 'ignore';
  }
  // moving is true when video bytes are still arriving. A stall is only counted after video had started.
  function onMedia(link, moving, now) {
    if (moving) {
      link.wasUp = true;
      link.sawMedia = true;
      link.lastMediaAt = now;
      link.downSince = 0;
      link.stalled = false;
      link.told = false;
      link.attempts = 0;
      link.gaveUp = false;
      return;
    }
    if (!link.sawMedia || link.downSince || link.gaveUp) return;
    if (link.lastMediaAt && now - link.lastMediaAt >= 8000) {
      link.downSince = link.lastMediaAt;
      link.stalled = true;
    }
  }
  // First recovery is restartIce, unless the video just froze. Later tries click the page's button.
  function nextReconnect(link, now, enabled) {
    if (!enabled || !link.wasUp || !link.downSince || link.gaveUp) return 'none';
    if (now - link.downSince < 4000) return 'none';
    if (link.attempts >= 3) { link.gaveUp = true; return 'giveup'; }
    if (link.lastTry && now - link.lastTry < 8000) return 'none';
    link.attempts += 1;
    link.lastTry = now;
    if (link.stalled) return 'click';
    return link.attempts === 1 ? 'restart' : 'click';
  }

  function visible(el) {
    if (!el || el.hidden || el.disabled) return false;
    try { if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; } catch (e) {}
    try { if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false; } catch (e) {}
    return true;
  }
  function findReconnect(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    const want = /^(reconnect|try again|retry)[.!]?$/i;
    let found = null;
    function consider(el) {
      if (found || !visible(el)) return;
      const tag = String(el.tagName || '').toUpperCase();
      let role = '';
      try { role = el.getAttribute ? (el.getAttribute('role') || '') : ''; } catch (e) {}
      if (tag !== 'BUTTON' && tag !== 'A' && role !== 'button') return;
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length <= 32 && want.test(text)) found = el;
    }
    function walk(node, depth) {
      if (!node || found || depth > 5 || typeof node.querySelectorAll !== 'function') return;
      let buttons = [], all = [];
      try { buttons = node.querySelectorAll('button, a, [role="button"]'); } catch (e) { buttons = []; }
      for (const el of buttons) consider(el);
      try { all = node.querySelectorAll('*'); } catch (e) { all = []; }
      for (const el of all) if (el && el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
    walk(root, 0);
    return found;
  }

  const links = new Map();
  let primary = null;
  const health = { poorRun: 0, warned: false };

  function tuneReceivers(pc) {
    if (!lowLatency() || !pc || typeof pc.getReceivers !== 'function') return;
    let list = [];
    try { list = pc.getReceivers() || []; } catch (e) { return; }
    for (const r of list) {
      if (!r || !r.track || r.track.kind !== 'video') continue;
      try { r.playoutDelayHint = 0; } catch (e) {}
    }
  }
  function mungeLocal(desc) {
    const kbps = bitrateCap();
    if (!kbps || !desc || typeof desc.sdp !== 'string') return desc;
    const sdp = applyBitrate(desc.sdp, kbps);
    if (sdp === desc.sdp) return desc;
    return { type: desc.type, sdp };
  }
  function watch(pc) {
    if (!pc || pc.__xboxplayWatched) return;
    try { pc.__xboxplayWatched = true; } catch (e) { return; }
    const link = freshLink();
    links.set(pc, link);
    const onState = () => {
      const ice = pc.iceConnectionState || pc.connectionState;
      const action = onLinkState(link, ice, Date.now());
      if (action === 'up') primary = pc;
      if (pc.connectionState === 'closed' || pc.iceConnectionState === 'closed') {
        links.delete(pc);
        if (primary === pc) primary = null;
      }
    };
    try {
      pc.addEventListener('iceconnectionstatechange', onState);
      pc.addEventListener('connectionstatechange', onState);
      pc.addEventListener('track', () => tuneReceivers(pc));
    } catch (e) {}
  }

  function install() {
    const Orig = window.RTCPeerConnection;
    if (!Orig || Orig.__xboxplayWrapped) return;
    const origSetLocal = Orig.prototype.setLocalDescription;
    const origSetRemote = Orig.prototype.setRemoteDescription;
    if (typeof origSetLocal === 'function') {
      Orig.prototype.setLocalDescription = function (desc) {
        let next = desc;
        try { next = mungeLocal(desc); } catch (e) {}
        return origSetLocal.call(this, next);
      };
    }
    if (typeof origSetRemote === 'function') {
      Orig.prototype.setRemoteDescription = function (desc) {
        const pc = this;
        return Promise.resolve(origSetRemote.call(pc, desc)).then(v => { tuneReceivers(pc); return v; });
      };
    }
    function XboxPC(...args) {
      const pc = new Orig(...args);
      watch(pc);
      return pc;
    }
    XboxPC.prototype = Orig.prototype;
    XboxPC.__xboxplayWrapped = true;
    try { if (typeof Orig.generateCertificate === 'function') XboxPC.generateCertificate = Orig.generateCertificate.bind(Orig); } catch (e) {}
    window.RTCPeerConnection = XboxPC;
    if (window.webkitRTCPeerConnection === Orig) window.webkitRTCPeerConnection = XboxPC;
  }

  function toast(text) {
    const ui = window.__xboxplayUI;
    if (ui && ui.toast) ui.toast(text);
    else log(text);
  }
  function show(sample, recovering) {
    const level = healthOf(sample);
    const warn = noteHealth(health, recovering ? 'idle' : level);
    let text = statusText(sample);
    if (recovering) text = text ? (text + ' · reconnecting') : 'Reconnecting…';
    const ui = window.__xboxplayUI;
    if (ui && ui.streamStatus) ui.streamStatus(text ? { text, level: recovering ? 'fair' : level } : null);
    window.__XBOXPLAY_NET = sample ? {
      rttMs: sample.rttMs, lossPct: sample.lossPct, bitrateMbps: sample.bitrateMbps,
      width: sample.width, height: sample.height, hardware: sample.hardware, level,
    } : null;
    if (warn && sample) toast(poorMessage(sample));
  }
  function hidden() {
    try { return !!(document && document.hidden); } catch (e) { return false; }
  }
  function recover(pc, link, step) {
    if (!link.told) { link.told = true; toast('Stream dropped. Trying to reconnect.'); log('stream dropped, trying to reconnect'); }
    if (step === 'restart') {
      try { if (typeof pc.restartIce === 'function') { pc.restartIce(); return; } } catch (e) {}
    }
    const doc = typeof document !== 'undefined' ? document : null;
    const btn = findReconnect(doc);
    if (btn && typeof btn.click === 'function') {
      try { btn.click(); log('clicked', (btn.textContent || '').trim().slice(0, 32)); } catch (e) {}
    }
  }

  async function tick(now) {
    const t = now || Date.now();
    let best = null, bestPc = null, anyMoving = false;
    for (const [pc, link] of links) {
      if (pc.connectionState === 'closed' || pc.iceConnectionState === 'closed') {
        links.delete(pc);
        if (primary === pc) primary = null;
        continue;
      }
      tuneReceivers(pc);
      let sample = null;
      try {
        if (typeof pc.getStats === 'function') {
          const stats = await pc.getStats();
          const reports = [];
          if (stats && typeof stats.forEach === 'function') stats.forEach(r => reports.push(r));
          const read = readStats(reports, link.stat);
          if (read) { link.stat = read.prev; sample = read; }
        }
      } catch (e) {}
      if (sample && sample.bitrateMbps != null) {
        const moving = sample.bitrateMbps >= 0.2;
        if (moving) anyMoving = true;
        onMedia(link, moving, t);
      }
      if (sample && (!best || (sample.bitrateMbps || 0) >= (best.bitrateMbps || 0))) { best = sample; bestPc = pc; }
    }
    const link = primary && links.get(primary);
    const recovering = !!(reconnectEnabled() && link && link.downSince && !link.gaveUp);
    show(anyMoving || best ? best : null, recovering);
    if (hidden() || anyMoving || !link) return;
    const step = nextReconnect(link, t, reconnectEnabled());
    if (step === 'giveup') { toast("Couldn't reconnect. Press F5 to reload."); log('gave up reconnecting'); return; }
    if (step === 'restart' || step === 'click') recover(primary || bestPc, link, step);
  }

  window.__xboxplayStream = {
    qualityMode, bitrateCap, applyBitrate, readStats, healthOf, noteHealth, statusText, poorMessage,
    freshLink, onLinkState, onMedia, nextReconnect, findReconnect, tick,
  };
  try { install(); } catch (e) { log('could not watch the stream'); }
  setInterval(() => { tick().catch(() => {}); }, 2000);
})();
