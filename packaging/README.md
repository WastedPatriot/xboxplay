# Packaging

The GitHub release [v1.0.0](https://github.com/WastedPatriot/xboxplay/releases/tag/v1.0.0) has `XboxPlay-1.0.0.AppImage`, `xboxplay_1.0.0_amd64.deb`, and `xboxplay-1.0.0.x86_64.rpm`. Publishing to the AUR and to Flathub uses your accounts. The commands below are the ones you run.

## AUR (`xboxplay-bin`)

`packaging/aur/PKGBUILD` installs that AppImage. The sha256 is `a10c1c4a6526c35b97296891baabe17989c947dfd268e52562e93237c282a93b`, which is the file on the release. `packaging/aur/.SRCINFO` is generated from the PKGBUILD. The icon is the `assets/icon.png` from the `v1.0.0` tag.

1. Create an account at https://aur.archlinux.org and add your SSH public key on the account page.
2. On a machine with `base-devel` and `namcap`:

```bash
git clone ssh://aur@aur.archlinux.org/xboxplay-bin.git
cd xboxplay-bin
cp /path/to/xboxplay/packaging/aur/PKGBUILD .
cp /path/to/xboxplay/packaging/aur/.SRCINFO .
namcap PKGBUILD
makepkg -f
git add PKGBUILD .SRCINFO
git commit -m "xboxplay-bin 1.0.0"
git push
```

The clone is an empty repository until the first push, which creates `xboxplay-bin` and makes you the maintainer. `makepkg --printsrcinfo > .SRCINFO` regenerates `.SRCINFO` if you edit the PKGBUILD. Do not push a PKGBUILD whose AppImage checksum is `SKIP`.

The name is `xboxplay-bin` because it ships the prebuilt AppImage, not a from-source package.

## Flathub

`packaging/flatpak/com.wastedpatriot.XboxPlay.yml` builds app id `com.wastedpatriot.XboxPlay` from git tag `v1.0.0` commit `911cb8cfd8831e5a5166e64dc63b47856cdb4e5e`. `generated-sources.json` is the offline npm and Electron download list from `flatpak-node-generator`. The build does not use the network. The desktop file, metainfo, and `xboxplay.sh` next to the manifest are installed as-is, so the copy on Flathub is the one with the screenshots and the 1.0.0 release notes, not the older copies inside the tag.

Screenshots are `docs/guide.png` and `docs/settings.png` from that tag. The metainfo OARS rating treats the client as having moderate chat and voice, because the Xbox site can. Confirm that rating before you open the pull request if you want it changed.

A local test, with the Freedesktop 25.08 SDK, `org.freedesktop.Sdk.Extension.node22`, and `org.electronjs.Electron2.BaseApp` 25.08:

```bash
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/com.wastedpatriot.XboxPlay.yml
```

Run that from the repository root. `flatpak-builder` resolves the manifest's file sources from the manifest's directory.

To publish:

1. Fork https://github.com/flathub/flathub with "Copy the master branch only" unchecked. The submission branch is `new-pr`, not `master`.
2. From the fork:

```bash
git clone --branch=new-pr git@github.com:YOUR_GITHUB_USERNAME/flathub.git
cd flathub
git checkout -b com.wastedpatriot.XboxPlay new-pr
cp /path/to/xboxplay/packaging/flatpak/com.wastedpatriot.XboxPlay.yml .
cp /path/to/xboxplay/packaging/flatpak/generated-sources.json .
cp /path/to/xboxplay/packaging/flatpak/com.wastedpatriot.XboxPlay.desktop .
cp /path/to/xboxplay/packaging/flatpak/com.wastedpatriot.XboxPlay.metainfo.xml .
cp /path/to/xboxplay/packaging/flatpak/xboxplay.sh .
git add com.wastedpatriot.XboxPlay.yml generated-sources.json com.wastedpatriot.XboxPlay.desktop com.wastedpatriot.XboxPlay.metainfo.xml xboxplay.sh
git commit -m "Add com.wastedpatriot.XboxPlay"
git push -u origin com.wastedpatriot.XboxPlay
```

3. Open a pull request into `flathub/flathub`, with the base branch set to `new-pr`, not `master`. Title it `Add com.wastedpatriot.XboxPlay`. A pull request against `master` is closed automatically.
4. In the pull request, say why `--device=all` is there: controllers are `/dev/input` nodes, and Flatpak has no narrower device permission. Comment `bot, build` when you want Flathub's test build.

After it is merged you are invited to https://github.com/flathub/com.wastedpatriot.XboxPlay. That invitation needs GitHub two-factor authentication and expires in a week. Later updates go to that repository, not through another `new-pr` pull request.
