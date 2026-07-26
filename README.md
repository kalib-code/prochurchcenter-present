# ProChurchCenter Present

A PH-first church presenter. Deliberately minimal. Offline-first. Built for the Sunday-morning volunteer.

Pull slide decks straight from a connected Canva account into a setlist — exported as PDF and cached locally, so a service still runs if the internet drops mid-Sunday.

## For church volunteers — installing the app

👉 **[Read the installation guide (INSTALL.md)](./INSTALL.md)** — step-by-step instructions for Windows, macOS, and Linux, including how to get past the "unrecognized app" security warnings you'll see on first launch. (We're not code-signed yet; the guide explains exactly what to click.)

Grab the latest installer from the [releases page](https://github.com/kalib-code/prochurchcenter-present/releases/latest).

---

## For developers

## Where things live

- **Planning docs:** `~/Obsidian/kalib/Projects/sundaytask-present/`
  - `CONCEPT.md` — product north star, Ate Rose persona, design principles
  - `FLOWS.md` — user flows, screens, keyboard map
  - `BLUEPRINT.md` — architecture, data model, build sequence
  - `ROADMAP.md` — v1.0 → v2.0 feature phasing
  - `FEATURE-MENU.md` — feature selection history
- **Code:** `~/Code/saas/sundaytask-presenter/` (this folder)
- **Distribution:** `prochurchcenter.com` via polar.sh

## Develop

```bash
pnpm install
pnpm dev          # launches operator + output windows
pnpm typecheck    # verifies TS across main/preload/renderer
pnpm build        # production build
pnpm build:mac    # DMG
pnpm build:win    # NSIS installer
pnpm build:linux  # AppImage
```

### pnpm v10 gotcha — "Electron uninstall" on first `pnpm dev`

pnpm v10 blocks postinstall scripts by default as a safety feature. The first time you clone this repo and run `pnpm install`, electron's binary-download script may be skipped, and `pnpm dev` will then fail with:

```
Error: Electron uninstall
    at getElectronPath (.../electron-vite/dist/chunks/lib-*.mjs)
```

**Fix:** run once after the first install:

```bash
pnpm setup:electron
```

This runs `node node_modules/electron/install.js` directly and downloads the Electron binary to `node_modules/electron/dist/`. Only needed once per clone — subsequent `pnpm install` runs won't wipe it.

## Stack

Electron 34 · electron-vite · React 18 · TypeScript · Tailwind v3 · shadcn/ui · Zustand · react-router · @aiden0z/pptx-renderer (live .pptx projection)

PowerPoint decks project directly — pick a `.pptx` when adding a setlist item, and it projects with no PDF export step.
Only `.pptx` is supported; for `.ppt`, `.key`, or Google Slides, export to PDF
and add it as a PDF deck.

## License

MIT (repo). The distributed app uses a one-time paid license via polar.sh.
