'use strict';
// Hosts the app window may navigate to or open as a popup (top-level only; subresources are not restricted).
const ALLOWED_HOST_SUFFIXES = [
  'xbox.com', 'xboxlive.com', 'xboxservices.com',
  'live.com', 'live.net', 'microsoft.com', 'microsoftonline.com',
  'msauth.net', 'msftauth.net', 'gfx.ms', 'microsoftcasualgames.com',
];
// Pages where our scripts are injected.
const INJECT_HOSTS = ['www.xbox.com', 'play.xbox.com'];
// Permissions granted to allowlisted origins. Everything else is denied.
const ALLOWED_PERMISSIONS = new Set(['pointerLock', 'fullscreen', 'media', 'speaker-selection', 'keyboardLock', 'clipboard-sanitized-write']);

// Better xCloud (optional, only works on www.xbox.com/play). Pinned release + SHA-256.
const BX = {
  version: '6.7.13',
  url: 'https://github.com/redphx/better-xcloud/releases/download/v6.7.13/better-xcloud.user.js',
  sha256: '2293b470bae29cd099162e5a28d77fbd532bf75bea9930e7eb5417ff5714db94',
  match: /^https:\/\/www\.xbox\.com\/[^/]+\/(play|auth\/msa\?.*loggedIn)/i,
  exclude: /xbox-game-pass\/play-day-one/,
};

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOST_SUFFIXES.some(s => u.hostname === s || u.hostname.endsWith('.' + s));
  } catch { return false; }
}
// For logs: never print query strings or fragments (they can carry auth codes/tokens).
function safeUrl(raw) {
  try { const u = new URL(raw); return u.origin + u.pathname; } catch { return '(invalid url)'; }
}

module.exports = { ALLOWED_HOST_SUFFIXES, INJECT_HOSTS, ALLOWED_PERMISSIONS, BX, isAllowedUrl, safeUrl };
