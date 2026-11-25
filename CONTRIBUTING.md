# Contributing

PRs are welcome. Keep them small and say what you tested (distro, desktop, which Xbox site you got, and whether you used a controller or the keyboard).

Before opening one:

```bash
npm ci
npm run check
shellcheck install.sh uninstall.sh
xvfb-run -a npx electron --no-sandbox test/smoke.js   # optional, needs xvfb
```

Bugs and "please support this controller" go through the issue templates. A security problem does not: see [SECURITY.md](SECURITY.md).

Packaging changes belong in `packaging/` or `.github/workflows/release.yml`. Don't tag a release from a pull request. The owner pushes the `v*` tag.

Please don't add analytics, remote config, or anything that phones home.
