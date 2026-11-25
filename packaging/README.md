# Packaging

The GitHub workflow `.github/workflows/release.yml` builds the AppImage, the `.deb`, and the `.rpm` when someone pushes a `v*` tag, and attaches them to that release. Do not create the tag from a pull request.

## AUR (`xboxplay-bin`)

`packaging/aur/PKGBUILD` installs the AppImage from the GitHub release.

1. Push `v1.0.0` and wait until the release has `XboxPlay-1.0.0.AppImage`.
2. Download that file and replace the `SKIP` checksum:

   ```bash
   sha256sum XboxPlay-1.0.0.AppImage
   ```

3. From an AUR account, clone `ssh://aur@aur.archlinux.org/xboxplay-bin.git`.
4. Copy `PKGBUILD` in, run `makepkg --printsrcinfo > .SRCINFO`, and check it with `makepkg -f`.
5. Commit `PKGBUILD` and `.SRCINFO` and push to the AUR. Do not push while the AppImage checksum is still `SKIP`.

The name is `xboxplay-bin` because it ships the prebuilt AppImage, not a from-source package.

## Flathub

`packaging/flatpak/com.wastedpatriot.XboxPlay.yml` builds from a local checkout. That is fine on your machine. Flathub builders have no network, so they will reject `type: dir` and `npm ci`.

Before opening the submission:

1. Point `sources` at the `v1.0.0` git tag and its commit, not `type: dir`.
2. Generate offline npm sources with `flatpak-node-generator` (from flatpak-builder-tools) and add that file as a source. Remove `--share=network` from `build-options`.
3. Confirm the OARS content rating in the metainfo. The file has an empty rating so the build has a place for it.
4. Fork [flathub/flathub](https://github.com/flathub/flathub) and open a pull request, or use the new-app form at https://github.com/flathub/flathub/wiki/App-Submission. The app id is `com.wastedpatriot.XboxPlay`.

A local test, once you have the Freedesktop 25.08 SDK and the Node 22 extension:

```bash
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/com.wastedpatriot.XboxPlay.yml
```
