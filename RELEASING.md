# Releasing Present

This is the runbook for cutting a release of Present and shipping installers to users.

> **Status:** Phase 10a — unsigned builds via GitHub Actions. Code-signing setup (Phase 10b) is documented at the bottom of this file as the next milestone.

---

## TL;DR — cutting a release

```bash
# 1. Bump version
pnpm version patch   # or: minor / major

# 2. Push the tag (electron-builder uses this as the release version)
git push origin main --tags

# 3. Wait ~8-12 minutes for CI to build mac/win/linux in parallel
#    Watch progress: https://github.com/kalib-code/sundaytask-presenter/actions

# 4. Open the new DRAFT release on GitHub Releases, verify all
#    artifacts uploaded, write release notes, click Publish
#    https://github.com/kalib-code/sundaytask-presenter/releases
```

CI does the rest. Users on a previous version will receive the update on next launch via the in-app auto-updater (electron-updater polls GitHub Releases on startup with a 5-second delay).

---

## What gets built

| Platform | Format | Architecture | Signed? |
|---|---|---|---|
| macOS | `.dmg` | arm64 + x64 (universal-style, two files) | ❌ Phase 10b |
| Windows | NSIS `.exe` installer | x64 | ❌ Phase 10b |
| Linux | `.AppImage` | x64 | n/a |

Plus electron-updater manifest files (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) that the auto-updater reads to compare versions.

---

## Local builds (for testing only — won't be auto-signed)

```bash
pnpm build:mac      # produces dist/Present-{version}-{arch}.dmg
pnpm build:win      # produces dist/Present-{version}-setup.exe (on Windows)
pnpm build:linux    # produces dist/Present-{version}.AppImage (on Linux)
```

Local builds skip the publish step. Use them for smoke-testing the installer before cutting a release tag.

---

## Versioning

- `pnpm version patch` → bumps `0.0.0` → `0.0.1` → `0.0.2`. Use for bug fixes.
- `pnpm version minor` → bumps `0.1.0` → `0.2.0`. Use for new features (added kind, added IPC, etc).
- `pnpm version major` → bumps `1.0.0` → `2.0.0`. Use only for breaking changes that will require user action.

The release version comes from `package.json` — electron-builder reads it. Don't edit the version manually; always use `pnpm version` so the corresponding git tag is created in the same step.

---

## How auto-updates work

1. App boots, windows are created
2. After a 5-second delay, `electron-updater` calls `checkForUpdates()`
3. It hits `https://github.com/kalib-code/sundaytask-presenter/releases/latest/download/latest.yml` (or platform-specific manifest)
4. If the manifest's version is newer than the installed app, it downloads the installer in the background
5. When the download finishes, a native dialog asks the user to restart
6. They click yes → the app quits and the installer relaunches with the new version

**Critical**: don't publish a draft release until all artifacts (mac arm64, mac x64, win, linux, plus the three `latest*.yml` files) have uploaded successfully. A half-published release with a manifest pointing at non-existent installer files will break auto-updates for all users on previous versions.

---

## Phase 10b — code signing (TODO, requires money)

Without code-signing, users see scary warnings on first launch:

- **macOS:** "Apple cannot check it for malicious software" — user must right-click → Open the first time
- **Windows:** SmartScreen "publisher unknown" — user must click "More info → Run anyway"

These are fixable with paid certificates. Until then, accept the warnings or use the unsigned builds for technical-friend testing only.

### macOS code-signing

**Prerequisites:**
- Apple Developer Account ($99/year) — https://developer.apple.com/programs/
- Developer ID Application certificate downloaded as a `.p12` file
- App-specific password for notarization (Apple ID → Sign-In and Security)

**CI secrets to add at https://github.com/kalib-code/sundaytask-presenter/settings/secrets/actions:**

| Secret name | Value |
|---|---|
| `MAC_CERTS` | base64-encoded `.p12` file (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CERTS_PASSWORD` | password used when exporting the `.p12` |
| `APPLE_ID` | the Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your team ID from developer.apple.com |

**Workflow change:** in `.github/workflows/release.yml`, replace `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` with the secret refs, and flip `notarize: false` → `notarize: true` in `electron-builder.yml` under `mac:`.

### Windows code-signing

**Prerequisites — pick one:**

1. **Sectigo Standard OV cert** (~$70/year via SSL.com, Comodo, etc.) — cheapest, but Windows users still see SmartScreen the first ~50 downloads until "reputation" builds. Acceptable for an indie launch.
2. **Sectigo EV cert** (~$300/year) — instant SmartScreen trust, but requires a hardware token (USB or HSM) and is much more annoying to wire up in CI.

**CI secrets to add:**

| Secret name | Value |
|---|---|
| `WIN_CERTS` | base64-encoded `.pfx` file |
| `WIN_CERTS_PASSWORD` | password for the `.pfx` |

**Workflow change:** add `CSC_LINK: ${{ secrets.WIN_CERTS }}` and `CSC_KEY_PASSWORD: ${{ secrets.WIN_CERTS_PASSWORD }}` to the env block.

---

## Troubleshooting

### `electron-builder` fails with "GitHub Personal Access Token is not set"

GitHub's auto-injected `GITHUB_TOKEN` should work for own-repo releases. If you see this error, the workflow is missing `permissions: contents: write` at the top — make sure it's there.

### Auto-updater silent in dev mode

This is intentional. `electron-updater.checkForUpdates()` is a no-op when `app.isPackaged === false` because the version is `0.0.0` and there's no `app-update.yml` manifest in dev. To test the updater, run `pnpm build:mac` and launch the built `.app` from `dist/`.

### Two draft releases for the same tag (files split between them)

Fixed by the `create-draft` job in `release.yml`, which creates the draft once before the three builds start. Before it existed, each build's electron-builder created its own draft if none existed yet, and two builds checking in the same second produced two drafts (v0.3.1: Mac files in one, Windows + Linux in the other). If it ever happens again, **don't publish either draft**. Copy the missing files into one draft, check that every `latest*.yml` points at files that are there, then delete the other draft **by release ID** (`gh api -X DELETE repos/OWNER/REPO/releases/ID`). Deleting by tag is ambiguous, and `--cleanup-tag` would remove the tag the remaining draft needs.

### Tag pushed but no CI run

Check `.github/workflows/release.yml` exists on the branch you tagged from. The workflow also needs the `contents: write` permission, which is set at the workflow level.

### Mac DMG built but won't open

If you see "App is damaged and can't be opened" on a freshly downloaded DMG, that's because the binary is unsigned and macOS quarantine is enforcing. As a workaround until Phase 10b: `xattr -cr /Applications/Present.app` clears the quarantine bit. Or right-click → Open → Open (the first time only).
