# Contributing

PRs are welcome. Keep them small and say what you tested (distro, desktop, which Xbox site you got).

Before opening one:

```bash
npm ci
npm run check
shellcheck install.sh uninstall.sh
xvfb-run -a npx electron --no-sandbox test/smoke.js   # optional, needs xvfb
```

Please don't add analytics, remote config or anything that phones home.
