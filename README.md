# Present — Sunday Task

A PH-first church presenter. Deliberately minimal. Offline-first. Built for the Sunday-morning volunteer.

**Status:** Phase 0 scaffold · zero features · two empty windows launch

## Where things live

- **Planning docs:** `~/Obsidian/kalib/Projects/sundaytask-present/`
  - `CONCEPT.md` — product north star, Ate Rose persona, design principles
  - `FLOWS.md` — user flows, screens, keyboard map
  - `BLUEPRINT.md` — architecture, data model, build sequence
  - `ROADMAP.md` — v1.0 → v2.0 feature phasing
  - `FEATURE-MENU.md` — feature selection history
- **Code:** `~/Code/saas/sundaytask-presenter/` (this folder)
- **Distribution:** `sundaytask.com` via polar.sh

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

Electron 34 · electron-vite · React 18 · TypeScript · Tailwind v3 · shadcn/ui · Zustand · react-router

## License

MIT (repo). The distributed app uses a one-time paid license via polar.sh.
