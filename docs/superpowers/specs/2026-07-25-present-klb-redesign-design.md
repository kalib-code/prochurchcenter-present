# Present — KLB Redesign

**Date:** 2026-07-25
**Source:** Claude Design project `5f91f817-f1bb-4109-9a7b-482e122a93c8`, file `Present Redesign.dc.html`
**Target:** `prochurchcenter-present` v0.1.2

## Summary

Convert the Present operator UI from its current shadcn-lineage visual language
(rounded corners, blur, shadow, warm gold) to the KLB hairline-grid system
(zero radius, opaque 1px rules, no shadows, signal orange), and close the four
workflow gaps the redesign exists to address:

1. **Pre-flight** — check what breaks Sunday on Saturday night, with the remedy attached.
2. **Service timing** — per-item durations, a running clock, and an ends-at estimate.
3. **Item-grouped slide grid** — slide cards grouped under sticky item headers.
4. **A real NEXT** — show what pressing SPACE will actually do, plus a video runway.

Data model, keyboard model, and output-window rendering are unchanged except for
three additive fields (§4). The projector, stage monitor, and lower-thirds windows
render the *user's* theme and are out of scope entirely.

## Goals

- Every operator-facing screen speaks one visual language, matching the design file.
- The four features above are functional, not decorative.
- Existing setlists, songs, themes, and backup zips load unchanged.
- No file is rewritten twice: each screen is converted and gains its feature in one pass.

## Non-goals

- Changing the output, stage, or lower-thirds window appearance.
- Tagalog UI localization (design references it as "Phase 7"; still deferred).
- Reworking the parser, slideify, or the service state machine's transitions.
- A light-mode variant. The `.light` block in `main.css` is left in place but is
  not maintained against the new palette; it is unreachable at runtime today.

---

## 1. Visual system

### 1.1 Palette

Tokens stay in HSL-components format (`13 88% 47%`, not `#E23C0F`) so Tailwind's
alpha syntax keeps working. This is load-bearing: the design uses
`rgba(226,60,15,.45)` borders and `rgba(226,60,15,.08)` fills on every warning
surface and active chip, which become `border-signal/45` and `bg-signal/[0.08]`.

**Existing semantic names are remapped** rather than replaced, so any screen not
yet converted still renders coherently during the migration.

| Token | Old value | New value | Hex |
|---|---|---|---|
| `--background` | `240 10% 5%` | `0 0% 4%` | `#0A0A0A` |
| `--card` | `240 8% 8%` | `0 0% 7%` | `#111111` |
| `--popover` | `240 10% 6%` | `0 0% 7%` | `#111111` |
| `--muted` | `240 6% 13%` | `60 4% 11%` | `#1C1C1A` |
| `--accent` | `240 6% 14%` | `60 4% 9%` | `#181816` |
| `--secondary` | `240 6% 12%` | `60 5% 8%` | `#161614` |
| `--border` | `240 6% 18%` | `60 2% 16%` | `#2A2A28` |
| `--input` | `240 6% 18%` | `60 2% 16%` | `#2A2A28` |
| `--ring` | `38 92% 55%` | `13 88% 47%` | `#E23C0F` |
| `--foreground` | `0 0% 96%` | `0 0% 100%` | `#FFFFFF` |
| `--muted-foreground` | `240 5% 62%` | `60 1% 41%` | `#6B6B68` |
| `--brand` | `38 88% 62%` | `13 88% 47%` | `#E23C0F` |
| `--brand-foreground` | `240 15% 6%` | `0 0% 100%` | `#FFFFFF` |
| `--brand-muted` | `38 50% 50%` | `0 74% 42%` | `#B91C1C` |
| `--destructive` | `0 72% 55%` | `0 74% 42%` | `#B91C1C` |
| `--radius` | `0.625rem` | `0` | — |

New tokens, for roles with no current equivalent:

| Token | Value | Hex | Role |
|---|---|---|---|
| `--rule` | `60 4% 11%` | `#1C1C1A` | inner hairline between list rows |
| `--dim` | `60 2% 28%` | `#4A4A47` | disabled text, inactive gap labels |
| `--soft-fg` | `60 1% 55%` | `#8F8F8C` | secondary body text |
| `--quiet-fg` | `60 3% 71%` | `#B8B8B4` | inactive slide-card text |
| `--bone` | `37 17% 91%` | `#ECE9E4` | primary body text on dark panels |
| `--ok` | `147 65% 38%` | `#22A05B` | pre-flight READY status only |
| `--ember` | `16 41% 7%` | `#1A0F0B` | active row background |
| `--panel-hi` | `60 5% 8%` | `#161614` | panel hover, inactive card header |

`--panel-hi` and the remapped `--secondary` resolve to the same value. That is
intentional: `--secondary` is the legacy name kept alive for unconverted screens,
`--panel-hi` is the name new code uses. `--secondary` is not removed, because
`Button`'s old `secondary` variant and several call sites still reference it until
their screen's phase lands.

Exposed in `tailwind.config.js` as `rule`, `dim`, `soft`, `quiet`, `bone`, `ok`,
`ember`, `panel-hi` under `theme.extend.colors`, each as `hsl(var(--x) / <alpha-value>)`.

`--radius: 0` squares every `rounded-lg` / `rounded-md` / `rounded-sm` / `rounded-xl`
/ `rounded-2xl` / `rounded-3xl` / bare `rounded` (Tailwind's `DEFAULT`) in the
codebase in a single edit, because `tailwind.config.js` derives all seven from
`var(--radius)`. The `DEFAULT` and `3xl` keys matter as much as the five named
sizes: Tailwind's stock `DEFAULT` (`0.25rem`) and `3xl` are not part of the
`sm`/`md`/`lg`/`xl`/`2xl` scale, so a config that only overrides those five
leaves the bare `rounded` utility and `rounded-3xl` rounded even at
`--radius: 0` — the same class of gap that let the `xl`/`2xl` `+4px`/`+8px`
offsets survive before this scale was flattened. `rounded-full` is unaffected
(Tailwind hardcodes `9999px`), which is correct: status dots stay circular per the
design's `border-radius:50%`, and the only `rounded-full` that must change is
`Badge`, handled explicitly in §3.

Verification gate (grep for any surviving radius, shadow, blur, or gradient in
operator chrome): `grep -rnE "rounded\b|shadow-|backdrop-blur|bg-gradient"
src/renderer/src` — must return nothing outside `SlideRenderer.tsx` and the
output/stage/lower-thirds views, which legitimately render the *user's* theme,
not app chrome. Use `rounded\b`, not a `rounded-(sm|md|lg|xl|2xl)` alternation:
the alternation only catches suffixed forms and misses the bare utility.

### 1.2 Removals

The following are removed wherever they appear in operator chrome, because the
design uses none of them:

- `shadow-*` including `shadow-glow-brand` (the utility is deleted from `tailwind.config.js`)
- `backdrop-blur-*`
- `bg-gradient-*`
- `blur-3xl` decorative glow divs (`Home.tsx` has two)
- `hover:-translate-y-*` and `active:scale-*` micro-motions

Retained: `transition-colors` on interactive surfaces. The design's hover states
are colour-only (`style-hover="background:#161614"`).

### 1.3 Typography

Two families, vendored as woff2 into `src/renderer/src/assets/fonts/` and declared
with `@font-face` in `main.css`. Google Fonts `<link>` tags cannot be used: Present
runs offline in church AV booths.

- **Inter** — weights 400, 500, 600, 700, 800. Latin subset.
- **JetBrains Mono** — weights 500, 600. Latin subset.

Budget: ~180 KB total, `font-display: swap`.

Fallback stacks remain so a failed load degrades rather than blanks:

```
--font-sans: 'Inter', -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
```

Contingency: if the font files cannot be obtained during implementation, ship the
fallback stacks alone and note it in the phase-A commit message. The layout holds;
the mono micro-labels lose weight character. This is a degraded but acceptable
outcome, not a blocker.

The existing `.font-editorial` serif utility is **deleted**. Its two consumers
(`Home.tsx` wordmark and hero, `Home.tsx` date numerals) become Inter 800 at
`-0.03em` per the design.

Recurring type roles, defined once as component-level utilities:

| Role | Spec | Usage |
|---|---|---|
| Eyebrow / micro-label | `600 9.5px/1 mono, 0.14em, uppercase` | section headers, ~80 sites |
| Chip label | `600 8.5–9px mono, 0.1em, uppercase` | item-kind codes, status pills |
| Button label | `600 10px mono, 0.1em, uppercase` | all buttons |
| Page title | `800 34–36px Inter, -0.03em` | Home/Library/Settings headings |
| Hero title | `800 56px/1.02 Inter, -0.035em` | Home NEXT UP headline |
| Card title | `700 13–15px Inter, -0.01em` | setlist names, song titles |
| Body | `400 12–13px Inter` | descriptions |
| Numeric | `600 20px mono, tabular-nums` | elapsed timer |

Page titles carry a trailing signal-orange period (`Songs<span>.</span>`), per the
design. Implemented as a `<TitleDot />` element, not a hand-typed span.

---

## 2. Layout idioms

### 2.1 Hairline grid

The design builds every table and card grid as `border-left` on the container plus
`border-right` + `border-bottom` on each cell, producing exact 1px seams with no
doubling. Reproduced as a `HairlineGrid` primitive (§3) rather than repeated by
hand; consumers pass a column count.

This replaces the current `gap-4` card grids. Cards become adjacent, not separated.

### 2.2 Sticky headers

Service Mode's grouped grid stacks two sticky layers: the grid toolbar at
`top: 0; z-index: 2`, and each item header at `top: 37px; z-index: 1`. The 37px
offset is the toolbar's measured height and is defined as a shared constant
(`GRID_TOOLBAR_H`) so the two cannot drift apart.

### 2.3 Segmented controls

Mode switches (LIVE/BLACK/LOGO, GROUPED/FLAT, DETAIL/COMPACT) are joined button
groups: a shared 1px container border, `border-right` on each child except the
last, active child filled `--signal` with white text, inactive transparent with
`--muted-foreground`.

### 2.4 Screen shell

Every screen is a `flex-col` at full height with a fixed header, a
`flex-1 min-h-0 overflow-y-auto` body, and optionally a fixed footer. The design's
fixed `880px` heights are an artifact of the mockup viewport and are **not**
reproduced; the app fills the window.

Scrollbars are styled to match the design's `.pcp-sc` rule (8px, `#2A2A28` thumb,
transparent track) via a `.scroll-hairline` utility in `main.css`.

---

## 3. Primitives

Rewritten in place under `src/renderer/src/components/ui/` so import sites do not move.

| File | Change |
|---|---|
| `Button.tsx` | Rewrite. Variants `signal` \| `outline` \| `ghost` \| `danger`. Sizes `sm`\|`md`\|`lg` = 30/38/46px. Mono uppercase labels. Square. `asChild` behavior preserved. |
| `Badge.tsx` | Rewrite as square chip. Tones `signal` \| `neutral` \| `ok`. `rounded-full` removed. |
| `Card.tsx` | Rewrite as `Panel`: square, `bg-card`, `border border-border`, optional mono header bar via a `title` prop. Filename kept; export renamed to `Panel` with `Card` retained as a deprecated alias for one phase, then removed in Phase F. |
| `PageHeader.tsx` | Rewrite: eyebrow + Inter-800 title + TitleDot + description + optional action slot. |
| `EmptyState.tsx` | Restyle only. |

New files in the same directory:

| File | Purpose |
|---|---|
| `MonoLabel.tsx` | The `600 9.5px/.14em uppercase` eyebrow. Props: `tone` (`muted`\|`signal`\|`dim`), `size` (`xs`\|`sm`). |
| `StatusDot.tsx` | 7px circle. Props: `tone` (`signal`\|`ok`\|`dim`), `pulse?: boolean` (drives the `pcp-pulse` keyframe). |
| `Segmented.tsx` | Joined button group. Props: `options`, `value`, `onChange`. |
| `HairlineGrid.tsx` | §2.1 border-seam grid. Props: `cols`, `children`. |
| `GapInsert.tsx` | Centered `+ INSERT HERE` label between two hairlines. Props: `active`, `label`, `onClick`. |
| `TitleDot.tsx` | The trailing signal-orange period. |

The `pcp-pulse` keyframe (`0%,100% opacity 1; 50% opacity .25`, 2.4s / 1.6s) is
added to `main.css`.

---

## 4. Data model and IPC changes

All three are additive and optional. Existing setlist JSON, song JSON, and backup
zips load unchanged; absent fields fall back to the defaults below.

### 4.1 `src/shared/types.ts`

`SetlistItem` is a discriminated union of seven variants. Rather than repeating
the field seven times, the union is wrapped in an intersection so the field is
available on every variant while narrowing on `kind` still works:

```ts
// Planned duration in whole minutes, used for the running clock. Absent means
// "not yet estimated" and contributes 0. Section dividers are always 0 — they
// occupy no service time because they never reach the projector.
export interface SetlistItemTiming {
  durationMinutes?: number
}

export type SetlistItem = (
  | { kind: 'song'; id: string; songId: string }
  | ... // the six other variants, unchanged
) & SetlistItemTiming

// Added to Setlist.
// Wall-clock service start, "HH:MM" 24-hour local. Absent defaults to "10:00".
startTime?: string
```

`UpdateSetlistPatch` already spreads `Pick<Setlist, 'name' | 'date' | 'items'>`;
it gains `'startTime'`.

This is a deliberate exception to the "no speculative fields" rule at the top of
`types.ts`. Both fields have a concrete consumer in the Setlist Editor and are
rendered in Phase D — they are not added for future flexibility.

### 4.2 `src/shared/ipc-contract.ts`

```ts
// VideoTimeUpdate gains one field. Required by the runway's "advances in 0:32"
// readout, which cannot be computed from currentTime alone.
duration: number

export interface PreflightCheck {
  id: 'display' | 'screenRecording' | 'media' | 'backup'
  status: 'ready' | 'warning'
  name: string
  detail: string
  /**
   * Present when the operator can act on it.
   *   'external' — `target` is a URL opened via shell.openExternal. Used for the
   *                macOS Screen Recording pane
   *                ("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").
   *   'in-app'   — `target` is a renderer route, e.g. "/settings?tab=output".
   */
  remedy?: { label: string; kind: 'external' | 'in-app'; target: string }
}

export interface PreflightReport {
  checks: PreflightCheck[]
  okCount: number
  warningCount: number
  checkedAt: string
}

// New PresentApi surface:
system: {
  getPreflight(setlistId: string | null): Promise<PreflightReport>
}
files: {
  checkExists(paths: string[]): Promise<Record<string, boolean>>
}
```

Channels: `system:getPreflight`, `files:checkExists`.

### 4.3 `src/main/ipc/system.ts` (new)

Registered in the existing `registerAllIpcHandlers()` chain in `src/main/ipc/index.ts`.

Composes four checks:

| Check | Source | Warning when |
|---|---|---|
| `display` | `screen.getAllDisplays()` + `settings.outputDisplayId` | Only one display present, or the saved display id no longer exists. |
| `screenRecording` | `systemPreferences.getMediaAccessStatus('screen')` | Not `'granted'`. |
| `media` | `files.checkExists` over the setlist's `imagePath` / `videoPath` / `pdfPath` | Any file missing. |
| `backup` | `backup.list()` newest entry | No backups, or newest older than 7 days. |

`screenRecording` is **macOS-only**. On Windows and Linux the check is omitted from
`checks[]` entirely and the counts reflect three checks, rather than emitting a
misleading "N/A" row. This check earns its place because `SlideRenderer`'s
`VideoSlideOperator` mirrors the output window through `desktopCapturer` — without
the permission the confidence monitor genuinely renders black.

`setlistId` is nullable so Home can request a report before a setlist is chosen;
the `media` check is then omitted.

### 4.4 `src/main/ipc/files.ts` (new)

`checkExists` maps each path through `fs.promises.access`, returning a
path→boolean record. Read-only, no traversal, no writes. Returns `false` for
any path that errors rather than throwing, so one bad path cannot fail the batch.

---

## 5. Screens

### 5.1 Home (Phase B)

- Header: wordmark `Present` + TitleDot, `PROCHURCHCENTER` mono lockup, ghost nav,
  signal `+ NEW SETLIST`.
- **Hero**: `1.25fr / 1fr` split inside a signal-bordered panel. Left is
  `NEXT UP` eyebrow with pulsing dot, the setlist name at Inter 800 56px, a mono
  meta line (`SUNDAY, APRIL 19 · 6 ITEMS · 45 SLIDES`), then the warning banner
  (§below), then joined `START SERVICE →` / `EDIT` / `REHEARSE` buttons, then
  the quiet Clone/Delete row. Right is the SERVICE PLAN list: numbered rows with
  item-kind chips, capped at 5 with a `+ N MORE` footer.
- **Warning banner** renders only when `warningCount > 0`. Shows
  `N WARNING(S)`, the first warning's `detail`, and its `remedy` button.
- **Pre-flight panel**: header with `N OK · M WARNING` chip and a `RE-CHECK`
  button; body is a `HairlineGrid` of one card per check — StatusDot, status
  text, name, detail.
- **Other setlists**: `HairlineGrid cols={3}`, each cell a 52px date tile
  (mono month over Inter-800 day), name, mono meta, and the item-kind chip strip.
  Replaces the current gapped `Card` grid.

Slide counts in the meta lines are computed with the existing `slideifySetlist`
against the loaded song library, not stored.

Pre-flight runs on mount and on `RE-CHECK`. It is not polled.

### 5.2 Song Library (Phase C)

Header with `← HOME`, `LIBRARY` eyebrow, `Songs.` title, a live `N IN LIBRARY`
count from the library store, a bordered search input, and a signal `+ NEW SONG`.

Body is a hairline table, columns `1fr 190px 150px 96px 130px`: title, author,
tag chips (language chip in signal, section-count chip in neutral), updated,
and a right-aligned setlist-membership action. Header row is sticky.

The final column binds to the **same setlist Home spotlights** — `pickHero()` in
`Home.tsx`, which is moved to `src/renderer/src/lib/setlist-helpers.ts` so both
screens share one definition rather than each computing its own. Its header shows
that setlist's date; each cell toggles the song's membership in it, rendering
`IN SETLIST` (signal) or `+ ADD` (dim). When there is no setlist at all, the
column is omitted and the grid drops to four columns.

### 5.3 Song Editor (Phase C)

Header: `← SONGS`, title, author, a saved-state pill, `DELETE`.
Body is a `47% / 53%` split.

**Left column** — Details panel (2-col field grid), Lyrics panel with the
`[SECTION] HEADERS · BLANK LINE = NEW SLIDE` hint and a mono textarea at
`13px/2`, Operator Notes panel, and the theme-override block.

**Theme override — chip-promotion model.** Replaces the current
`ThemeOverrideSection` + shared `ThemeFields` rendering.

- Inactive: a dashed panel with `OVERRIDE THEME`.
- Active: a signal-bordered panel containing
  1. a live 16:9 preview of this song's first real slide with the override applied;
  2. a count row, `N OF 12 FIELDS OVERRIDDEN · REST INHERITED`, with `REVERT ALL`;
  3. an empty-state block when nothing is overridden yet;
  4. one row per **active** override — group tag, label, hint, `REVERT`, and the
     field's control (segmented / swatch / stepper / select / file);
  5. an `OVERRIDE ANOTHER FIELD` tray of dashed chips, one per **inherited**
     field, showing group, label, and current effective value. Clicking a chip
     seeds that field into the override at its current effective value, so
     promotion is visually a no-op until edited.

Field definitions live in a new `src/renderer/src/lib/themeFields.ts` as a
declarative array (key, group, label, hint, control kind, options/step/min/max/unit),
mirroring the design's `FIELDS` constant. The 12 fields map onto `ThemeOverride`:
`fontFamily`, `fontSizePercent`, `textColor`, `backgroundColor`,
`backgroundImagePath`/`backgroundVideoPath` (one "Background media" row),
`textAlign`, `textPosition`, `textEffect`, `highlightColor`, `transition`,
`transitionDurationMs`, `logoPath`.

`ThemeFields.tsx` is **retained** for Settings, restyled in Phase F. Only
SongEditor stops consuming it. `mergeThemeOverride` is unchanged.

**Right column** — `LIVE PREVIEW · N SLIDES` header with a `MAX N LINES` chip,
then a 2-col hairline grid of 16:9 slide cards, each with a mono section header
and a corner shortcut glyph. Driven by the existing `previewSongSlides`.

### 5.4 Setlist Editor (Phase D)

Top bar: `← HOME`, saved pill, signal `START SERVICE →`, `DELETE`.

Meta strip, `1fr / 240px`: left is the name input plus a mono line reading
`<date> · N ITEMS`, then `≈ N MIN · ENDS H:MM` in signal, then a
`N MEDIA MISSING` chip when any media check fails. Right stacks the date input
and a new **SERVICE STARTS** time input bound to `Setlist.startTime`.

Run-of-show header: `RUN OF SHOW · N ITEMS`, the hint
`Drag to reorder · click any gap to insert`, a DETAIL/COMPACT `Segmented`, and
`+ ADD ITEM`.

**Items.** Each row shows a left rail with its computed clock time (`at`) above
the drag handle, a 104×60 thumbnail (detail mode), the item-kind chip, and:

- *Detail mode*: source-file line, a full-width title input, a `Loop continuously`
  checkbox for video items, and the media-missing banner when applicable.
- *Compact mode*: title and slide count on one line, reduced padding.

Right rail: a duration input (minutes) with a `MIN` label, and `DUPLICATE` /
`DELETE` actions.

**Gap insert.** A `GapInsert` sits above every item and after the last. Clicking
opens an inline kind picker — a signal-bordered `HairlineGrid cols={4}` of the
seven kinds (SNG, SCR, IMG, VID, PDF, CDN, SEC), each with code chip, name, and
hint — which inserts at that position. Replaces the current `AddItemPicker` entry
point; `AddItemPicker`'s per-kind creation logic is reused, its trigger UI is not.

**Media missing** banner: signal border, `MEDIA MISSING` chip, the explanation
`The file moved since you added it. This item will be skipped in service.`, and a
`RELINK` button that opens the native picker for the matching `PickFileKind` and
writes the new path back to the item.

Footer: `N ITEMS · N MIN · ENDS H:MM` and the note
`Section dividers are grouping only — they never reach the projector.`

**Timing computation** lives in a new pure module
`src/renderer/src/lib/serviceClock.ts`:

```ts
computeSchedule(items, startTime): {
  at: string[]          // per-item wall clock, "H:MM"
  totalMinutes: number
  endsAt: string        // "H:MM AM/PM"
}
```

Absent `durationMinutes` counts as 0. Section dividers count as 0 regardless.
Absent `startTime` defaults to `"10:00"`. Times are local, 12-hour with meridiem
on `endsAt` only, matching the design's `10:00` rows and `11:12 AM` total.

Drag-and-drop stays on the existing `@dnd-kit` wiring in `SetlistItemCard.tsx`.

### 5.5 Service Mode (Phase E)

Top bar: setlist name over a mono `ITEM n OF N · SLIDE n OF N` counter, the
elapsed timer at `600 20px mono tabular-nums`, a LIVE/BLACK/LOGO `Segmented`,
32px `B` / `L` / `?` toggles, and a `EXIT` button in signal-deep.

Body is a three-column grid, `190px / 1fr / 400px`. The existing resizable
panel behavior (`usePanelWidth`) is **retained**; these are the initial widths.

**Left rail** — `ITEMS · N` header, a `Jump to…` filter input, then one button
per item: index, name, and a mono meta line. The active item gets a 2px signal
left border and `--ember` background. The filter matches item labels
case-insensitively and does not alter indices or navigation.

**Center grid** — sticky toolbar with `ALL SLIDES · N`, the hint
`CLICK TO JUMP · SPACE TO ADVANCE`, and a GROUPED/FLAT `Segmented`.

*Grouped* (default): one block per item, each with a sticky header showing index,
name, meta, and estimated runtime, followed by a 3-col grid of that item's slide
cards. `slideifySetlist` already returns nested `RenderableItem[]`, so grouping
requires no new data derivation.

*Flat*: a single 3-col grid of every slide, matching current behavior.

Slide cards are unchanged in content: mono header with section label and shortcut
glyph, 16:9 black body with centered text. Active card takes a signal border and
signal-filled header.

**Right rail** — `ON SCREEN · <label>` header with a pulsing dot; the 16:9 mirror.
In black or logo mode the mirror overlays `BLACKOUT` / `LOGO · STANDBY` with the
line `The congregation sees nothing. Press again to resume.` and takes a signal
border, so a cut is unmistakable rather than a dead frame.

**Video runway** (video slides only): a mode line reading either
`LOOPING · WILL NOT ADVANCE` or `PLAYS ONCE · ADVANCES IN m:ss`, an elapsed/total
readout, a 3px signal progress bar, and joined pause/mute buttons with `P` / `M`
key hints. Fed by `VideoTimeUpdate` including the new `duration` field.

**NEXT panel.** The design computes `nextTag`/`nextLabel`/`nextText`/`nextHint`
(source lines 1044–1048) and its own notes list "NEXT + RUNWAY" as a headline
feature, but the markup consuming those props was dropped from the design file.
It is reconstructed here from the computed logic and the note, and sits between
the mirror and the notes pane:

- Tag: `NEW ITEM` (signal) when the next slide belongs to a different item,
  `SAME ITEM` (dim) when it does not, `END OF SERVICE` (signal) when there is none.
- Label and a text preview of the next slide.
- Hint: `Stays inside <item>.` / `Leaves <item> and starts <next item>.` /
  `Blacks out the projector and ends the service.`

Resolution lives in a new pure helper in `src/renderer/src/lib/serviceNext.ts`:
`resolveNext(items, itemIndex, slideIndex)`, returning a discriminated union of
`{ kind: 'same-item' | 'new-item', slide, itemLabel }` or `{ kind: 'end' }`.
It mirrors `useServiceStore.nextSlide`'s traversal exactly so the panel can never
disagree with what SPACE does.

**Bottom strip** — `LOWER THIRDS` label, title and subtitle inputs, `HIDE`, and a
mono mode readout (`AUTO-FOLLOWING SONG` / `EDITED · RESETS ON ADVANCE` /
`AUTO-HIDDEN · NOT A SONG`). Existing behavior, restyled.

**Cheat sheet** — full-bleed `rgba(10,10,10,.88)` overlay, 520px signal-bordered
panel, mono key column at 150px against Inter descriptions. Content comes from the
existing `KeyCheatSheet.tsx`, restyled.

### 5.6 Settings (Phase F)

Header: `← HOME`, `WORKSPACE` eyebrow, `Settings.` title, the line
`Changes save instantly. The projector restyles on the next frame.`, then an
underline tab row — DISPLAY / THEME / OUTPUT / DATA / ABOUT — with a 2px signal
underline on the active tab.

Body is a `520px / 1fr` split. Left is the scrolling control column: tab title,
tab description, then bordered groups whose rows are name + description + control.
Right is a sticky live preview — a 16:9 slide rendered with the current global
theme showing John 3:16, with a caption line and the note
`NO SAVE BUTTON — CLOSE WHEN IT LOOKS RIGHT`.

**The design's Settings rows are read-only value chips** — it mocks the shell, not
the controls. The existing working controls in `Settings.tsx` (933 lines) are
retained and restyled into the row layout; `ThemeFields.tsx` is restyled and
continues to serve the THEME tab. Only the shell, tabs, and preview split are new.

---

## 6. Phasing

Each phase is independently shippable and leaves the app in a working state.

| Phase | Scope | Feature landed |
|---|---|---|
| A | Fonts, tokens, `tailwind.config.js`, primitives (§3) | — |
| B | `Home.tsx`; new `system.ts`, `files.ts` IPC; preload + contract | Pre-flight |
| C | `SongLibrary.tsx`, `SongEditor.tsx`, new `themeFields.ts`; `pickHero` moved from `Home.tsx` into `setlist-helpers.ts` | Chip-promotion override editor |
| D | `SetlistEditor.tsx`, `SetlistItemCard.tsx`, `AddItemPicker.tsx`, new `serviceClock.ts`; schema fields | Service timing, RELINK, DETAIL/COMPACT, gap insert |
| E | `ServiceMode.tsx`, `OutputMirror.tsx`, `SlideCard.tsx`, `KeyCheatSheet.tsx`, new `serviceNext.ts`; `VideoTimeUpdate.duration` | Grouped grid, jump-to filter, NEXT panel, video runway |
| F | `Settings.tsx`, `ThemeFields.tsx`; remove the `Card` alias | — |

Phase A must land first. B–F are order-independent but are sequenced above to
front-load the highest-value features.

---

## 7. Testing

`vitest` currently covers `src/shared` only (`parser`, `bibleReference`). New pure
logic is unit-tested; visual conversion is verified by running the app.

| Module | Cases |
|---|---|
| `serviceClock.computeSchedule` | Empty list; absent `durationMinutes`; section dividers contribute 0; absent `startTime` defaults to 10:00; crossing noon (meridiem correctness); crossing midnight. |
| `serviceNext.resolveNext` | Mid-item → `same-item`; last slide of an item → `new-item` with correct labels; last slide of last item → `end`; single-slide items; empty item list. |
| Pre-flight reduction | `okCount`/`warningCount` derivation; macOS-only check omitted on other platforms leaves counts consistent. |
| `files.checkExists` | Missing path yields `false` rather than throwing; a bad path does not fail sibling paths in the batch. |

`resolveNext` and `useServiceStore.nextSlide` must agree. A test asserts this
directly: for every `(itemIndex, slideIndex)` in a fixture setlist, the position
`nextSlide` moves to matches what `resolveNext` predicted.

Existing tests must continue to pass unchanged — none of them touch the renderer.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Font files unobtainable offline during implementation | Fallback stacks already declared; ship without and note it. Degraded, not blocking. |
| `--radius: 0` squares something that should stay round | Only `rounded-full` survives, which is the intended set (dots). `Badge` is the one deliberate conversion. Caught by running the app in Phase A. |
| Schema fields break old backups | Both optional with defined defaults; restore path reads them as absent and falls back. Covered by loading a pre-change backup zip in Phase D. |
| `resolveNext` drifting from the store's traversal | Cross-check test in §7 pins them together. |
| Sticky-header offset drift in the grouped grid | `GRID_TOOLBAR_H` shared constant, not two hardcoded numbers. |
