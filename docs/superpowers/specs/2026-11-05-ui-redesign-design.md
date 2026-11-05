# Present — UI/UX redesign (dark mode)

**Date:** 2026-11-05 · **Branch:** `kalib/ui-redesign` (stacked on `kalib/bugfix-sweep`)
**Supersedes:** the visual language of `2026-07-25-present-klb-redesign-design.md` ("KLB").

## Why

The owner doesn't like the current dark mode. A screen-by-screen audit found four causes:

1. **Orange-red means everything.** One colour (`#E23C0F`) marked primary buttons, "Next up", active tabs, selections, tags, warnings and live state. Real warnings had no way to stand out on a Sunday.
2. **Hard-to-read text.** 9–10px uppercase monospace labels with wide tracking, several in grey below WCAG AA on near-black `#0A0A0A`.
3. **Boxes inside boxes.** Zero radius, a hairline around every element, and permanent "+ INSERT HERE" rules made editors look like spreadsheets.
4. **No persistent navigation.** Each page had its own `← HOME` link, and Songs, setlists and Settings were reached only through Home.

## Research (Mobbin)

Reference apps: ElevenLabs, Obvious, Superlist, Riverside, Dropbox Dash, Slite (shell and settings); Vimeo Live and Canva presenter view (live control); Spotify, Suno and YouTube Music (library lists); Figma Slides and Pitch (slide thumbnails).

The common patterns:
- a persistent left sidebar on a slightly darker window background;
- content in an **inset rounded panel**;
- layered charcoal surfaces rather than pure black;
- sentence-case labels;
- a white or light primary button;
- colour reserved for status. Live tools use red only for ON AIR.

## Principles

1. **Surfaces, not borders.** Depth comes from four surface levels: `app` → `panel` → `raised` → `hover`. Use a border only where an edge is needed to work: inputs, cards on the same surface, and dividers inside a list.
2. **Colour means something.**
   - `live` (red): showing on the projector right now. ON AIR only.
   - `warn` (amber): needs attention (missing media, one display, unsaved, preflight action).
   - `ok` (green): ready or healthy.
   - `accent` (orange): brand mark, focus ring, current selection or cursor (e.g. the selected item in a list).
   - Primary action: `Button variant="primary"`, which is light on dark, **not** a colour.
   - Destructive: `Button variant="danger"` (red text), and it always confirms.
3. **Readable type.**
   - Inter, sentence case, body 14px.
   - Labels are 12–13px medium in `text-muted-foreground` or `text-quiet`. Use the `MonoLabel` component (now sans, sentence case) and write label text in sentence case.
   - Page titles are 26px semibold, section titles 15–16px semibold.
   - **Monospace only** for timecodes and clocks (`font-mono tabular-nums`), plus the lyrics textarea. Use sans `tabular-nums` for counts and times in lists.
   - No `uppercase`, no `tracking-[0.1em]` and up, no `text-[9px]`/`text-[10px]`/`text-[11px]` body text.
4. **Calm density.** Spacing groups content; hover reveals secondary actions (row actions, insert gaps, drag handles); show one primary action per view.
5. **Soft shape.** `rounded-md` (8px) for controls, `rounded-lg` for list rows and thumbnails, `rounded-xl` for panels and cards, `rounded-full` for pills and dots.

## Foundation (done; use it, don't fork it)

- **Tokens:** `src/renderer/src/assets/main.css` and `tailwind.config.js`.
  - Surfaces: `bg-app`, `bg-panel`, `bg-raised`, `bg-hover`, `bg-selected`.
  - Lines: `border-border`, `border-rule`.
  - Text, strongest to weakest: `text-foreground`, `text-bone`, `text-quiet`, `text-soft`, `text-muted-foreground`, `text-dim`. `text-dim` is for disabled or placeholder text only.
  - Meaning: `live`, `warn`, `ok`, `accent`, all usable with alpha (e.g. `bg-warn/10`).
  - Legacy names still resolve (`signal`→accent, `ember`, `panel-hi`), but **replace them** in any code you touch, choosing by meaning. Most old `signal` uses become `warn`, `live`, `accent` or a primary button.
- **Components in `components/ui/`:**
  - `Button`: `primary | secondary | ghost | danger | live`, with sizes `sm | md | lg`.
  - `Badge`: `neutral | accent | ok | warn | live`.
  - `MonoLabel`: section and column labels.
  - `Panel` (Card.tsx): a rounded raised surface with an optional header.
  - `Segmented`, `PageHeader` (`back` breadcrumb, optional `eyebrow`), `StatusDot`, `WarningBanner` (amber), `EmptyState`, `HairlineGrid` (rounded, gap-hairlines), `GapInsert` (hover-only), `SaveStatePill`.
  - `Input`, `Textarea`, `Select`, `Field` and `fieldClass` (Input.tsx).
  - `TitleDot` now renders nothing; remove its usages.
- **Icons:** `components/icons.tsx` (inline SVG; add more there if needed; no icon library).
- **Shell:** `components/AppShell.tsx` holds the sidebar (brand, New setlist, Home, Songs, Settings, Upcoming services) and the inset `<main>` panel. Every operator page except Service Mode renders inside it.
  - Pages must **not** draw their own app header, `← Home` links, or "Song library / Settings / New setlist" nav; the sidebar owns those.
  - Page roots are `flex h-full w-full min-h-0 flex-col`, with no page background (the panel provides it).
  - A breadcrumb back to a parent list is fine, e.g. Song editor → "Songs".

## Screens

### Home
- No top bar.
- Header: a greeting-free title such as "Home", or simply the next service. Use `PageHeader` or an equivalent.
- **Next service card** (`rounded-xl bg-raised`):
  - service name (large); date · item count · slide count in `text-soft`;
  - primary **Start service** (play icon), secondary **Edit**, ghost **Rehearse**;
  - "Clone last Sunday" and "Delete" as quiet ghost actions;
  - the service plan list beside it, showing item kind badges as `neutral`.
- **Pre-flight**: a compact checklist with one row per check.
  - Each row shows a status icon (ok check / warn triangle), name and detail, plus the remedy as a secondary button on warn rows.
  - Header: "Pre-flight", a summary ("2 ready · 2 need attention"), and "Re-check".
  - Warnings are **amber**, not orange or red.
- **Other setlists**: a card grid with a date tile, name, item count and kind badges.

### Songs (library)
- `PageHeader` "Songs" with a search `Input` (search icon) and a primary **New song** button.
- Table rows with hover background:
  - title (foreground) and author (soft);
  - tags as neutral badges, updated in muted;
  - an "Add to {setlist}" ghost action that appears on row hover; when already added, show an `ok` "In setlist" badge.
- Empty and no-results states use `EmptyState`.

### Song editor
- Breadcrumb "Songs" above the title (song title); `SaveStatePill`; Delete as a ghost/danger action.
- Two panes:
  - **left:** details in a `Panel` (Field grid) and a large lyrics `Textarea` (mono OK) with the hint "[Section] headers · blank line = new slide", plus operator notes and the theme override;
  - **right:** a sticky live preview of rounded 16:9 slide thumbnails with section label chips and the slide count.

### Setlist editor
- **Header:**
  - name as a large inline-editable title;
  - a meta row: date and start time as compact inputs, then "7 items · ~45 min · ends 11:00";
  - missing media as a `warn` badge;
  - primary **Start service**; Delete as a ghost/danger action.
- **Run of show:** a clean list of `rounded-lg` rows on the panel. Each row has:
  - time (tabular, muted);
  - a drag handle that appears on hover;
  - a 16:9 rounded thumbnail;
  - title, plus a kind badge and meta in muted;
  - a minutes field;
  - duplicate and delete as icon ghost buttons revealed on hover.
- **Expanded/detail editing** keeps every current capability but loses the heavy chrome: fields use `Input`/`Field`, file-change buttons are secondary `sm`, and media-missing is an amber inline banner with Relink.
- **Section dividers:** a labelled divider line (`text-quiet` label), not an orange bar.
- **Insert:** `GapInsert` between rows, visible on hover, plus an **Add item** secondary button. Detail/Compact stays as `Segmented`.

### Service Mode (full screen, no sidebar)
- **Top bar:**
  - setlist name, with "Item 2 of 6 · Slide 3 of 5" in soft text;
  - the elapsed clock in mono tabular;
  - Live / Black / Logo as a segmented control. When Live is active it shows **red** (`bg-live text-white`); Black and Logo use the neutral active style;
  - shortcut hints and **Exit** as ghost buttons.
- **Left:** the items list. The current item gets an accent bar and `bg-selected`; the item on air gets a red live dot.
- **Center:** the slide grid of rounded thumbnails.
  - The on-air slide has a **red ring and a "Live" badge**.
  - The next slide has a subtle accent ring and a "Next" badge.
  - Group headers are sentence case.
- **Right:** program preview with a red "Live" badge (or "Black"/"Logo" when not live), the Next panel and stage notes.
- **Keyboard, timing and behaviour are untouched.** This screen is used live, so change looks only.

### Settings
- Inside the panel, use a **left section nav** (Display, Theme, Output, Data, About) instead of top tabs, following Riverside and Slite.
- Content:
  - grouped `Panel`s of setting rows, with label and description on the left and the control on the right;
  - sticky live preview pane on the right where it exists today.
- Inputs use `Input`/`Select`; toggles stay as accent-coloured checkboxes or switches.

## Constraints
- **Behaviour must not change.**
  - Same features, routes, keyboard shortcuts, IPC and stores.
  - All existing tests must pass (`./node_modules/.bin/vitest run`), and both typechecks must stay clean.
  - Copy may change, but tests that assert on text may need updating; update them deliberately.
- **No new dependencies.**
- **The projector output is unchanged:** `output/OutputView`, the projected content of `SlideRenderer`, and the user's themes. `StageView` and `LowerThirdsView` are out of scope.
- **Canva stays hidden** (`FEATURES.canva = false`); don't redesign Canva-only UI.
- **Accessibility:**
  - visible focus ring (`focus-visible:ring-2 ring-accent/70`) on every interactive element;
  - icon-only buttons have `aria-label`;
  - text meets AA (don't use `text-dim` for content).

## Verification
- Run `/private/tmp/claude-501/-Users-kael-Code-saas-sundaytask-presenter/79eb2556-9de6-447e-9e63-7502e0639d5c/scratchpad/capture/run.sh <name>`. It builds and screenshots home, library, song-editor, setlist-editor, settings and service at 1440×900 using a copy of real data, and writes `shots/<name>/*.png` in the same scratchpad.
- Look at your screens and iterate until they match this document.
- Before/after references are in `shots/before/` (old design) and `shots/foundation/` (new tokens, unconverted pages).
