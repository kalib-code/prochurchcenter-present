# KLB Redesign — manual verification checklist

**Branch:** `kalib/present-redesign-impl-7a3ea5` · 53 commits · spec `specs/2026-07-25-present-klb-redesign-design.md`

## Why this file exists

The redesign was implemented and reviewed without a display. `pnpm typecheck`,
`pnpm test` (179 tests / 11 files), and `pnpm build` all pass, and every task and
the whole branch were code-reviewed — but **nothing has been seen rendered.**

Automated coverage is pure logic in `src/shared/` and `src/renderer/src/lib/`.
There are no component-render tests, matching the pre-existing codebase. So every
"does it look right" and "does it behave right on screen" question is open.

Work through this in order — it's sorted by blast radius, not by screen.

---

## 1. Service Mode — grouped grid + keyboard navigation

The highest-risk area. Start a service with **≥4 items and ≥30 slides**.

- [ ] Advance with `SPACE` until the active card is near the bottom of the viewport, then press `⇧SPACE` several times to step back. **The active card must be fully visible** — not tucked under the sticky toolbar or its group header.
- [ ] Click a left-rail item near the top of a long list. Same check.
- [ ] Confirm the toolbar's rendered height really is 37px (`GRID_TOOLBAR_H`) and group headers pin flush beneath it with no gap or overlap.
- [ ] Toggle `GROUPED` ↔ `FLAT`. The active card stays active and visible in both.
- [ ] Confirm flat mode isn't over-scrolling (it uses a smaller margin than grouped).

> Fixed late as finding **C3** — sticky headers were added without `scroll-margin-top`. Verify the fix rather than assuming it.

## 2. Service Mode — cut states

- [ ] Press `B` mid-service. The mirror takes a signal border and shows `BLACKOUT` plus "The congregation sees nothing. Press again to resume."
- [ ] Press `L`. Same, reading `LOGO · STANDBY`.
- [ ] Confirm neither reads as an ordinary black slide. A dead frame the operator mistakes for content is the failure this design exists to prevent.

## 3. NEXT panel vs. what SPACE actually does

- [ ] Build a fixture setlist mixing song / scripture / video / PDF deck / section divider.
- [ ] Walk it end to end. At **every** advance, check the panel's prediction against where you land.
- [ ] Check each item boundary specifically: tag flips to `NEW ITEM` and the hint names the item being left and the one being entered, in that order.
- [ ] Check the final slide reads `END OF SERVICE`.

> A cross-check test pins `(itemIndex, slideIndex)` agreement with the store at every position, but nothing pins the *rendered panel*.

## 4. Video runway — brand-new IPC path, never run

- [ ] Play a **looping** video → `LOOPING · WILL NOT ADVANCE`.
- [ ] Play a **non-looping** video → `PLAYS ONCE · ADVANCES IN m:ss`, counting down.
- [ ] Watch the first moments before metadata loads: it must show `PLAYS ONCE` alone and `--:--`, never `0:00` or `NaN`.
- [ ] Confirm the progress bar tracks and never overflows its container.
- [ ] `P` and `M` move both the projector and the readout.

> The emit was dead plumbing until commit `b39029e`. This path has never executed.

## 5. Pre-flight — all four checks against real system state

- [ ] Unplug the second display → display check warns.
- [ ] Deny macOS Screen Recording → that check flips to `ACTION NEEDED` on `RE-CHECK`.
- [ ] `SHOW ME HOW` actually opens the macOS Screen Recording privacy pane.
- [ ] Move a file a setlist points at → media check warns; `OPEN SETLIST` navigates correctly.
- [ ] Delete or age the backups → backup check warns; `BACK UP NOW` navigates to Settings.
- [ ] **On Windows or Linux**, confirm the panel renders **3 columns**, not a broken 4-column grid. The macOS-only check is omitted entirely and the grid sizes off `checks.length`.

## 6. Zero-radius sweep, by eye

- [ ] Every screen: only status dots are round.
- [ ] Look hardest at the Service Mode slide grid and the Setlist Editor thumbnail rail — the corner "▶ / pdf" chips on media thumbnails were the last violation found (**C1**).

## 7. Setlist Editor — timing and relink round-trip

- [ ] Set `SERVICE STARTS`; add durations; confirm per-item clock times, `≈ N MIN`, and `ENDS H:MM AM/PM`.
- [ ] Put a duration on a **section divider** — it must contribute 0.
- [ ] Cross noon and cross midnight; check the meridiem.
- [ ] Break a media path → banner + `RELINK`; relink and confirm the banner clears **without a manual refresh**.
- [ ] Switch to `COMPACT` and confirm the broken item is still findable (signal border + `MISSING` badge).
- [ ] Reload the app; `startTime` and `durationMinutes` persisted.

## 8. Backward compatibility

- [ ] Restore a **pre-branch backup zip**. Setlists with no `startTime` default to 10:00; items with no `durationMinutes` contribute 0; songs render normally.

## 9. Cross-screen consistency

- [ ] Open Song Editor and Setlist Editor side by side. Drive the save pill through idle → typing → saving → saved. Both must look identical (one shared `SaveStatePill` now).
- [ ] Compare Settings' body text against the other screens — same weight and colour for the same role.

## 10. The two late-converted Service Mode states

- [ ] Trigger `idle` (start on an empty/broken setlist).
- [ ] Trigger `ended` (run a service to completion). This is the last thing an operator sees every Sunday.
- [ ] Both should be KLB, not the old white-button chrome.

## 11. PowerPoint + Canva integration (added by the merge with `main`)

These two features were built on `main` while the redesign was in flight. The
merge reconciled them; **none of the combined surfaces has been seen rendered.**

- [ ] Add a `.pptx` via the gap-insert picker. It should show a `PPT` badge, a
      live first-slide thumbnail, and `N SLIDES` in the run of show.
- [ ] Give it a duration and confirm it participates in the running clock like
      any other item.
- [ ] **Move the .pptx file on disk**, reopen the setlist. It must show
      `MEDIA MISSING` with a working `RELINK` that offers only `.pptx`, and it
      must appear in Home's pre-flight media check. *(This is the wiring the
      exhaustiveness guard forced — verify it actually works end to end.)*
- [ ] Present a pptx deck. Confirm slides advance, the NEXT panel describes
      them as `PowerPoint slide N`, and the grouped grid shows thumbnails.
- [ ] Confirm the deck-warming lookahead still works: advancing from the last
      slide of the item *before* a pptx deck should pre-parse it, so the first
      pptx slide doesn't stall. This is why the stage lookahead crosses the
      item boundary.
- [ ] Open Settings → **Connections**, the new sixth tab, and confirm the Canva
      card renders correctly inside the KLB shell.
- [ ] Import a Canva deck; confirm the staleness indicator appears when the
      design is newer in Canva than the imported copy.

## 12. Fonts

- [ ] **Disconnect the network**, relaunch, and confirm Inter and JetBrains Mono still load (they're bundled via `@fontsource-variable`, not fetched).
- [ ] Confirm the mono micro-labels aren't falling back to a system mono — the whole design reads through them.

---

## Known-deferred items (reviewed, judged non-blocking)

- `.light` theme block in `main.css` is unmaintained and unreachable at runtime.
- `checkMedia` in `main/ipc/system.ts` probes paths sequentially rather than reusing the batched `files.checkExists`.
- `SongLibrary` shows `0§` for a song with zero sections.
- Home's hero uses `<Panel>` (a `div`), losing a `<section>` landmark.
- The `rounded\b` gate pattern also matches the sanctioned `rounded-full` and comment prose; a CI consumer would need to filter those.
- Pre-existing, untouched: `Home.tsx` clones `setlists[0]` rather than the hero setlist, and `REHEARSE` links to the same route as `START SERVICE`.
- **`CanvaPicker.tsx` and the deck/pptx editor bodies inside `SetlistItemCard` still carry shadcn-era classes** (`rounded-md`, `bg-brand/15`, `hover:border-brand/50`). They *render* correctly — `tailwind.config.js` maps every radius key including `DEFAULT` to `var(--radius: 0)`, so they are square — but they were written against the old design language and were not converted, because they arrived from `main` after the redesign's per-screen passes were done. Converting them is a separate, scoped piece of work on a feature this branch does not own.
