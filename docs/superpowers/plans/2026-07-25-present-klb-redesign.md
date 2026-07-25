# Present KLB Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Present operator UI to the KLB hairline-grid visual system and land the four workflow features the redesign targets — pre-flight, service timing, item-grouped slide grid, and a real NEXT.

**Architecture:** Token remap in `main.css` + `tailwind.config.js` squares and re-colours the whole app at once — `--radius: 0` cascades through every `rounded-*` utility, once the config's `borderRadius` scale is flattened so `xl`/`2xl` stop adding their `+4px`/`+8px` offsets. Six squared primitives replace the shadcn-lineage ones in place, so import sites never move. Each screen is then converted once, gaining its feature in the same pass. Pure logic (`serviceClock`, `serviceNext`, pre-flight reduction) is extracted to testable modules; JSX conversion is verified by running the app.

**Tech Stack:** Electron 34, React 18, TypeScript 5.7, Tailwind 3.4, Zustand 5, Vite 6, Vitest 2, `@dnd-kit`, `pdfjs-dist`.

**Spec:** `docs/superpowers/specs/2026-07-25-present-klb-redesign-design.md`

**Design source:** `Present Redesign.dc.html` in Claude Design project `5f91f817-f1bb-4109-9a7b-482e122a93c8`. Line references below (e.g. "design L103") point into that file. Fetch it with the `DesignSync` tool (`method: get_file`) when a task needs exact markup.

## Global Constraints

- **Package manager is `pnpm`.** Never `npm install`.
- **Verification command is `pnpm typecheck && pnpm test`.** Both must pass before any commit. `pnpm build` additionally runs `electron-vite build`.
- **Zero border radius.** No `rounded-*` utility may be added except `rounded-full`, and that only on status dots.
- **No shadows, blurs, or gradients** in operator chrome. `shadow-*`, `backdrop-blur-*`, `bg-gradient-*`, `blur-*` are forbidden in any file this plan touches.
- **Colour is only ever a token.** No hex literals in `.tsx`. Use `bg-signal`, `border-edge`, `text-bone`, etc. The one exception is `SlideRenderer.tsx` and the output/stage/lower-thirds views, which render the *user's* theme and are out of scope for every task here.
- **Signal orange is `#E23C0F` = `13 88% 47%`.** It replaces the old gold `#F5B849`. Operator chrome only — never the projector.
- **Mono for micro-labels.** Every uppercase label, chip, button label, and eyebrow uses `font-mono` with explicit tracking. Body copy uses `font-sans` (Inter).
- **Additive schema only.** `durationMinutes` and `startTime` are optional with defined defaults. Existing setlists, songs, themes, and backup zips must load unchanged.
- **`node:` prefix for Node builtins in main-process code**, matching the existing style in `src/main/ipc/backup.ts`… except that file uses bare `fs`/`path`. Follow the bare form for consistency with the existing codebase.
- **Platform:** macOS is the primary target. Any macOS-only capability must degrade by *omission*, never by a disabled or "N/A" row.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/renderer/src/components/ui/MonoLabel.tsx` | The `600 9.5px/.14em uppercase` eyebrow, ~80 call sites |
| `src/renderer/src/components/ui/StatusDot.tsx` | 7px circle, optional pulse |
| `src/renderer/src/components/ui/Segmented.tsx` | Joined button group for mode switches |
| `src/renderer/src/components/ui/HairlineGrid.tsx` | Border-seam grid (1px seams, no doubling) |
| `src/renderer/src/components/ui/GapInsert.tsx` | `+ INSERT HERE` rule with centered label |
| `src/renderer/src/components/ui/TitleDot.tsx` | Trailing signal-orange period on page titles |
| `src/renderer/src/lib/serviceClock.ts` | Running clock / totals / ends-at. Pure. |
| `src/renderer/src/lib/serviceClock.test.ts` | — |
| `src/renderer/src/lib/serviceNext.ts` | Resolves what SPACE will do. Pure. |
| `src/renderer/src/lib/serviceNext.test.ts` | — |
| `src/renderer/src/lib/themeFields.ts` | Declarative 12-field theme-override descriptor table |
| `src/renderer/src/lib/preflight.ts` | Report → summary reduction. Pure. |
| `src/renderer/src/lib/preflight.test.ts` | — |
| `src/shared/setlist-media.ts` | `mediaPathOf` / `relinkKindOf` — shared by main-process pre-flight and the renderer's media check |
| `src/main/ipc/system.ts` | Pre-flight composition (display, screen recording, media, backup) |
| `src/main/ipc/files.ts` | Batch file-existence check |
| `src/renderer/src/hooks/useMediaCheck.ts` | Debounced MEDIA MISSING detection, keyed by item id |
| `src/renderer/src/lib/themeFields.test.ts` | — |
| `src/renderer/src/components/PreflightPanel.tsx` | Home's pre-flight grid |
| `src/renderer/src/components/ServiceNextPanel.tsx` | Service Mode NEXT panel |
| `src/renderer/src/components/VideoRunway.tsx` | Service Mode video progress + transport |
| `src/renderer/src/components/ThemeOverrideEditor.tsx` | Chip-promotion override editor |

**Modified:**

| Path | Change |
|---|---|
| `vitest.config.ts` | Widen `include` to cover `src/renderer/src/lib` |
| `package.json` | Add two `@fontsource-variable` deps |
| `tailwind.config.js` | New colour tokens; delete `shadow-glow-brand` |
| `src/renderer/src/assets/main.css` | Token remap, `@font-face` imports, keyframes, scrollbar utility |
| `src/renderer/src/components/ui/Button.tsx` | Rewrite — square, mono, new variants |
| `src/renderer/src/components/ui/Badge.tsx` | Rewrite — square chip |
| `src/renderer/src/components/ui/Card.tsx` | Rewrite as `Panel`; `Card` alias until Phase F |
| `src/renderer/src/components/ui/PageHeader.tsx` | Rewrite |
| `src/renderer/src/components/ui/EmptyState.tsx` | Restyle |
| `src/shared/types.ts` | `SetlistItemTiming` intersection; `Setlist.startTime` |
| `src/shared/ipc-contract.ts` | `VideoTimeUpdate.duration`; `PreflightCheck`/`PreflightReport`; `system`/`files` API + channels |
| `src/preload/index.ts` | Wire `system` + `files` |
| `src/main/ipc/index.ts` | Register the two new handler modules |
| `src/renderer/src/lib/setlist-helpers.ts` | Receives `pickHero` moved out of `Home.tsx` |
| `src/renderer/src/pages/*.tsx` | All six screens converted |
| `src/renderer/src/components/{SetlistItemCard,AddItemPicker,SlideCard,OutputMirror,KeyCheatSheet,ThemeFields}.tsx` | Converted |

**Task types.** Tasks marked **[TDD]** have failing-test-first cycles. Tasks marked **[VISUAL]** convert JSX and are verified by running the app against the design file — there is no meaningful unit test for "the border is 1px". Do not fabricate assertions for [VISUAL] tasks; use the stated acceptance checks.

**Running the app:** `pnpm dev`. It opens the operator window. Phase E tasks additionally need a second display or the output window visible to exercise Service Mode.

---

# PHASE A — Foundation

*Checkpoint: after Task 5 the app runs, is fully squared, and is orange. Screens are not yet converted and will look transitional but coherent.*

### Task 1: Widen the test glob and add font packages [TDD]

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm test` now collects `src/renderer/src/lib/**/*.test.ts`; the `@renderer` alias resolves in tests.

- [ ] **Step 1: Seed `serviceClock.ts` with its time parser**

The glob change is proven by a REAL test being collected, not by a
`true === true` canary. So Task 1 lands the first genuine piece of
`serviceClock` — start-time parsing — and Task 14 builds `computeSchedule`
on top of it.

Create `src/renderer/src/lib/serviceClock.ts`:

```ts
/**
 * serviceClock — the setlist editor's running clock.
 *
 * Pure: no React, no IPC, no Date.now(). The schedule depends only on its
 * inputs, so the same setlist always renders the same times.
 *
 * Task 1 seeds the time parser; Task 14 adds computeSchedule.
 */

export const DEFAULT_START_MINUTES = 10 * 60 // 10:00
export const MINUTES_PER_DAY = 24 * 60

/**
 * "HH:MM" → minutes since midnight.
 *
 * Falls back to 10:00 on anything invalid rather than throwing: this
 * parses a value that round-trips through JSON on disk, and a corrupt
 * startTime must not be able to break the whole setlist editor.
 */
export function parseStart(startTime: string | undefined): number {
  if (!startTime) return DEFAULT_START_MINUTES
  const m = startTime.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return DEFAULT_START_MINUTES
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return DEFAULT_START_MINUTES
  }
  return hours * 60 + minutes
}
```

- [ ] **Step 2: Write the test**

Create `src/renderer/src/lib/serviceClock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseStart } from './serviceClock'

describe('parseStart', () => {
  it('parses a valid time to minutes since midnight', () => {
    expect(parseStart('09:30')).toBe(570)
  })

  it('accepts a single-digit hour', () => {
    expect(parseStart('9:05')).toBe(545)
  })

  it('defaults to 10:00 when absent', () => {
    expect(parseStart(undefined)).toBe(600)
  })

  it('defaults to 10:00 on a malformed string', () => {
    expect(parseStart('not-a-time')).toBe(600)
  })

  it('defaults to 10:00 on an out-of-range time', () => {
    expect(parseStart('25:99')).toBe(600)
  })
})
```

- [ ] **Step 3: Run the suite and confirm the test is NOT collected**

Run: `pnpm test`
Expected: the run passes but reports only the existing `src/shared` test files
(`parser.test.ts`, `bibleReference.test.ts`). `serviceClock.test.ts` does not
appear. **That absence is the failure being fixed** — five real assertions
exist and the runner cannot see them.

- [ ] **Step 4: Widen the include glob and add the renderer alias**

Replace the whole of `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Renderer lib modules are pure (no React, no IPC) and are the only
    // renderer code worth unit-testing. Including them here is what makes
    // serviceClock / serviceNext / preflight actually run under `pnpm test`
    // — before this, a test file under src/renderer was silently skipped.
    include: [
      'src/shared/**/*.test.ts',
      'src/renderer/src/lib/**/*.test.ts'
    ],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
```

- [ ] **Step 5: Run the suite and confirm the test IS collected and passing**

Run: `pnpm test`
Expected: PASS, and `src/renderer/src/lib/serviceClock.test.ts` now appears in
the file list with 5 passing assertions.

- [ ] **Step 6: Add the font packages**

Run: `pnpm add @fontsource-variable/inter @fontsource-variable/jetbrains-mono`

These are self-hosted variable-font packages. Vite bundles the woff2 into the
build output, so the app has both faces offline — which a Google Fonts `<link>`
could never provide in a church AV booth. Variable versions carry every weight
in one file, so no per-weight imports are needed.

- [ ] **Step 7: Verify the packages resolve**

Run: `node -e "console.log(require.resolve('@fontsource-variable/inter/index.css'))"`
Expected: prints a path inside `node_modules`. If it fails, the package name is
wrong — check `ls node_modules/@fontsource-variable/`.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml src/renderer/src/lib/serviceClock.ts src/renderer/src/lib/serviceClock.test.ts
git commit -m "build: run renderer lib tests, add Inter + JetBrains Mono

vitest's include glob only covered src/shared, so any test under
src/renderer was created and then silently skipped. Widening it is a
prerequisite for the serviceClock / serviceNext / preflight tests, and
also explains why slideify.ts has never had one.

Seeds serviceClock with its start-time parser so the glob change is
proven by real assertions being collected rather than a placeholder.

Fonts are self-hosted via @fontsource-variable so the app keeps both
faces offline."
```

---

### Task 2: Token remap [VISUAL]

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces: tokens `--rule`, `--dim`, `--soft-fg`, `--quiet-fg`, `--bone`, `--ok`, `--ember`, `--panel-hi` and Tailwind colours `rule`, `dim`, `soft`, `quiet`, `bone`, `ok`, `ember`, `panel-hi`. `--radius: 0`. Utility classes `.scroll-hairline`, `.animate-pulse-signal`.

- [ ] **Step 1: Replace the `:root` block in `main.css`**

Replace lines 20–66 (the `@layer base { :root { … } }` block, keeping the
`.light` block that follows it untouched) with:

```css
@layer base {
  :root {
    /* ── KLB surfaces ────────────────────────────────────────────────
       Opaque hairline system. Values are HSL components (not hex) so
       Tailwind's alpha syntax composes: `border-signal/45` is used on
       every warning surface and active chip in the design. */
    --background: 0 0% 4%;          /* #0A0A0A page */
    --foreground: 0 0% 100%;        /* #FFFFFF   */

    --card: 0 0% 7%;                /* #111111 panel */
    --card-foreground: 0 0% 100%;

    --popover: 0 0% 7%;
    --popover-foreground: 0 0% 100%;

    /* Legacy semantic names, remapped so screens not yet converted
       still render coherently mid-migration rather than breaking. */
    --muted: 60 4% 11%;             /* #1C1C1A */
    --muted-foreground: 60 1% 41%;  /* #6B6B68 */
    --accent: 60 4% 9%;             /* #181816 */
    --accent-foreground: 0 0% 100%;
    --secondary: 60 5% 8%;          /* #161614 — same value as --panel-hi;
                                       kept alive for unconverted callers */
    --secondary-foreground: 0 0% 100%;

    --border: 60 2% 16%;            /* #2A2A28 */
    --input: 60 2% 16%;
    --ring: 13 88% 47%;

    --primary: 0 0% 100%;
    --primary-foreground: 0 0% 4%;

    --destructive: 0 74% 42%;       /* #B91C1C */
    --destructive-foreground: 0 0% 100%;

    /* ── Signal ──────────────────────────────────────────────────────
       #E23C0F. Replaces the old warm gold. Operator chrome only — the
       projector renders the USER's theme and is untouched. */
    --brand: 13 88% 47%;
    --brand-foreground: 0 0% 100%;
    --brand-muted: 0 74% 42%;

    /* ── KLB-specific roles ──────────────────────────────────────── */
    --rule: 60 4% 11%;              /* #1C1C1A inner hairline, list rows */
    --dim: 60 2% 28%;               /* #4A4A47 disabled, inactive labels */
    --soft-fg: 60 1% 55%;           /* #8F8F8C secondary body */
    --quiet-fg: 60 3% 71%;          /* #B8B8B4 inactive slide-card text */
    --bone: 37 17% 91%;             /* #ECE9E4 primary body on panels */
    --ok: 147 65% 38%;              /* #22A05B pre-flight READY only */
    --ember: 16 41% 7%;             /* #1A0F0B active row background */
    --panel-hi: 60 5% 8%;           /* #161614 hover, inactive card header */

    /* Squares every rounded-* utility, PROVIDED the borderRadius scale in
       tailwind.config.js is flattened to derive all five sizes from this
       with no offsets (Step 4). The stock scale adds +4px/+8px for xl/2xl,
       which would leave those two rounded even at --radius: 0. */
    --radius: 0;
  }
}
```

- [ ] **Step 2: Replace the second `@layer base` block in `main.css`**

Replace the block currently at lines 96–132 (the one containing the `*`,
`html/body/#root`, `body`, `.font-editorial`, and `::selection` rules) with:

```css
@layer base {
  * {
    @apply border-border;
  }

  html,
  body,
  #root {
    height: 100%;
  }

  body {
    @apply bg-background text-foreground antialiased;
    font-feature-settings: 'cv11' 1, 'ss01' 1;
    font-family:
      'Inter Variable',
      -apple-system,
      'SF Pro Text',
      'Segoe UI',
      Roboto,
      system-ui,
      sans-serif;
  }

  ::selection {
    background-color: hsl(var(--brand) / 0.25);
    color: hsl(var(--foreground));
  }
}

@layer utilities {
  /* Design's .pcp-sc rule — 8px, edge-coloured thumb, no track. */
  .scroll-hairline::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .scroll-hairline::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
  }
  .scroll-hairline::-webkit-scrollbar-track {
    background: transparent;
  }
}

@keyframes pulse-signal {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
```

Note `.font-editorial` is deleted here. Its two consumers in `Home.tsx` are
fixed in Task 6; until then they fall back to the body font, which is correct.

- [ ] **Step 3: Add the font imports at the very top of `main.css`**

Insert above the existing `@tailwind base;` line:

```css
/* Self-hosted variable fonts — bundled by Vite so the app keeps both
   faces with no network. Inter carries the 400–800 range the design
   uses; JetBrains Mono carries 500–600 for micro-labels. */
@import '@fontsource-variable/inter';
@import '@fontsource-variable/jetbrains-mono';
```

- [ ] **Step 4: Update `tailwind.config.js`**

In `theme.extend.colors`, add after the existing `brand` block:

```js
        rule: 'hsl(var(--rule) / <alpha-value>)',
        dim: 'hsl(var(--dim) / <alpha-value>)',
        soft: 'hsl(var(--soft-fg) / <alpha-value>)',
        quiet: 'hsl(var(--quiet-fg) / <alpha-value>)',
        bone: 'hsl(var(--bone) / <alpha-value>)',
        ok: 'hsl(var(--ok) / <alpha-value>)',
        ember: 'hsl(var(--ember) / <alpha-value>)',
        'panel-hi': 'hsl(var(--panel-hi) / <alpha-value>)',
        signal: {
          DEFAULT: 'hsl(var(--brand) / <alpha-value>)',
          deep: 'hsl(var(--brand-muted) / <alpha-value>)'
        }
```

In `theme.extend`, add the font families and the keyframe animation:

```js
      fontFamily: {
        sans: ['Inter Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      animation: {
        'pulse-signal': 'pulse-signal 2.4s ease-in-out infinite',
        'pulse-signal-fast': 'pulse-signal 1.6s ease-in-out infinite'
      },
```

**Flatten the `borderRadius` block.** The stock scale is:

```js
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)'
```

At `--radius: 0` the `md`/`sm` calcs go negative and clamp to 0, but `xl` and
`2xl` resolve to a real **4px and 8px** — leaving eight existing call sites
rounded and quietly defeating the zero-radius constraint. Replace it with:

```js
      borderRadius: {
        // Every size derives from --radius with no offset. The KLB system
        // has exactly one radius: none. The stock +4px/+8px offsets on
        // xl/2xl would survive --radius: 0.
        lg: 'var(--radius)',
        md: 'var(--radius)',
        sm: 'var(--radius)',
        xl: 'var(--radius)',
        '2xl': 'var(--radius)'
      },
```

**Delete** the entire `boxShadow` block (the `shadow-glow-brand` utility). Files
still referencing it keep compiling and simply render without a shadow, which is
the desired end state; the remaining call sites are removed when their screen is
converted (`Card`/`EmptyState` in Tasks 4–5, `Home.tsx` in Task 9,
`SetlistEditor.tsx` in Task 16, `Settings.tsx` in Task 21).

- [ ] **Step 5: Verify the app builds and is squared**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS.

Run: `pnpm dev`
Expected acceptance checks, by eye:
1. Page background is near-black `#0A0A0A`, not the old blue-tinted `240 10% 5%`.
2. **No rounded corners anywhere** except status dots. Cards, buttons, inputs, badges are square. (Badges will still be pill-shaped — they use `rounded-full` and are fixed in Task 4.)
3. Primary buttons are orange `#E23C0F`, not gold.
4. Text renders in Inter, noticeably tighter than the previous system font.
5. No shadow halo under the Home hero.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/assets/main.css tailwind.config.js
git commit -m "feat(ui): KLB token remap — square, hairline, signal orange

--radius: 0 squares every rounded-* utility at once because the config
derives all five radii from it. Legacy semantic names are remapped
rather than replaced so unconverted screens stay coherent during the
migration. Drops shadow-glow-brand and .font-editorial."
```

---

### Task 3: `MonoLabel`, `StatusDot`, `TitleDot` [VISUAL]

**Files:**
- Create: `src/renderer/src/components/ui/MonoLabel.tsx`
- Create: `src/renderer/src/components/ui/StatusDot.tsx`
- Create: `src/renderer/src/components/ui/TitleDot.tsx`

**Interfaces:**
- Consumes: `cn` from `../../lib/utils`.
- Produces:
  - `<MonoLabel tone?: 'muted'|'signal'|'dim'|'soft' size?: 'xs'|'sm'>` — renders a `<span>`.
  - `<StatusDot tone?: 'signal'|'ok'|'dim' pulse?: boolean|'fast'>` — renders a `<span>`.
  - `<TitleDot />` — renders a signal-coloured `.`.

- [ ] **Step 1: Create `MonoLabel.tsx`**

```tsx
/**
 * MonoLabel — the KLB eyebrow.
 *
 * The design uses `600 9.5px 'JetBrains Mono', letter-spacing .14em,
 * uppercase` for roughly eighty section headers, column headers, and
 * status captions. Centralising it here is what keeps the tracking
 * identical everywhere; hand-written `tracking-[0.14em]` drifts.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'muted' | 'signal' | 'dim' | 'soft'
type Size = 'xs' | 'sm'

interface MonoLabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  size?: Size
}

const TONES: Record<Tone, string> = {
  muted: 'text-muted-foreground',
  signal: 'text-signal',
  dim: 'text-dim',
  soft: 'text-soft'
}

// xs is the chip//column-header size; sm is the section-header size.
const SIZES: Record<Size, string> = {
  xs: 'text-[9px] tracking-[0.12em]',
  sm: 'text-[9.5px] tracking-[0.14em]'
}

export function MonoLabel({
  className,
  tone = 'muted',
  size = 'sm',
  ...rest
}: MonoLabelProps): JSX.Element {
  return (
    <span
      className={cn(
        'font-mono font-semibold uppercase leading-none',
        TONES[tone],
        SIZES[size],
        className
      )}
      {...rest}
    />
  )
}
```

- [ ] **Step 2: Create `StatusDot.tsx`**

```tsx
/**
 * StatusDot — 7px circle used by NEXT UP, ON SCREEN, pre-flight rows,
 * and the saved-state pills.
 *
 * This is the ONLY component in the redesign allowed to use
 * `rounded-full`. Everything else is square by design; the design file
 * uses `border-radius:50%` here specifically.
 */

import { cn } from '../../lib/utils'

type Tone = 'signal' | 'ok' | 'dim'

interface StatusDotProps {
  tone?: Tone
  /** true = 2.4s pulse (idle), 'fast' = 1.6s pulse (live output) */
  pulse?: boolean | 'fast'
  className?: string
}

const TONES: Record<Tone, string> = {
  signal: 'bg-signal',
  ok: 'bg-ok',
  dim: 'bg-dim'
}

export function StatusDot({
  tone = 'signal',
  pulse = false,
  className
}: StatusDotProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
        TONES[tone],
        pulse === 'fast' && 'animate-pulse-signal-fast',
        pulse === true && 'animate-pulse-signal',
        className
      )}
    />
  )
}
```

- [ ] **Step 3: Create `TitleDot.tsx`**

```tsx
/**
 * TitleDot — the signal-orange period that terminates every page title
 * in the design ("Songs.", "Settings.", "New Service."). A component
 * rather than a hand-typed span so the colour can never drift.
 */

export function TitleDot(): JSX.Element {
  return <span className="text-signal">.</span>
}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck`
Expected: PASS. (No test — these are presentational and have no logic to assert.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/MonoLabel.tsx src/renderer/src/components/ui/StatusDot.tsx src/renderer/src/components/ui/TitleDot.tsx
git commit -m "feat(ui): add MonoLabel, StatusDot, TitleDot primitives"
```

---

### Task 4: Rewrite `Button`, `Badge`, `Card`→`Panel` [VISUAL]

**Files:**
- Modify: `src/renderer/src/components/ui/Button.tsx`
- Modify: `src/renderer/src/components/ui/Badge.tsx`
- Modify: `src/renderer/src/components/ui/Card.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces:
  - `<Button variant?: 'signal'|'outline'|'ghost'|'danger'|'secondary' size?: 'sm'|'md'|'lg' asChild?>`. `secondary` is a deprecated alias of `outline`, kept so unconverted screens compile; removed in Task 22.
  - `<Badge tone?: 'signal'|'neutral'|'ok'>`.
  - `<Panel title?: ReactNode action?: ReactNode emphasis?: boolean>` plus `export const Card = Panel` (deprecated alias, removed in Task 21).

- [ ] **Step 1: Rewrite `Button.tsx`**

```tsx
/**
 * Button — KLB square button.
 *
 * Variants:
 *   signal   Filled #E23C0F. The single most important action per view.
 *   outline  1px edge border, transparent fill. Alternate actions.
 *   ghost    No border, no fill. Dense toolbars and nav.
 *   danger   Deep-red text and border. Deletes only.
 *
 * Labels are mono uppercase with .1em tracking, matching every button
 * in the design file. Heights are 30/38/46 for sm/md/lg.
 *
 * `secondary` is a deprecated alias of `outline` so screens that have
 * not yet been converted keep compiling. Removed once Settings lands.
 */

import { cloneElement, forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'signal' | 'outline' | 'ghost' | 'danger' | 'secondary'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  asChild?: boolean
}

const BASE =
  'inline-flex items-center justify-center gap-2 select-none whitespace-nowrap ' +
  'font-mono font-semibold uppercase tracking-[0.1em] ' +
  'transition-colors duration-100 ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal ' +
  'disabled:pointer-events-none disabled:opacity-40'

const VARIANTS: Record<Variant, string> = {
  signal: 'border-0 bg-signal text-white hover:bg-signal-deep',
  outline:
    'border border-dim bg-transparent text-bone hover:border-white hover:text-white',
  secondary:
    'border border-dim bg-transparent text-bone hover:border-white hover:text-white',
  ghost: 'border-0 bg-transparent text-soft hover:text-white',
  danger:
    'border border-dim bg-transparent text-signal-deep hover:border-signal-deep'
}

const SIZES: Record<Size, string> = {
  sm: 'h-[30px] px-3 text-[9px]',
  md: 'h-[38px] px-4 text-[10px]',
  lg: 'h-[46px] px-6 text-[10.5px]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'outline', size = 'md', asChild = false, children, ...rest },
    ref
  ) {
    const classes = cn(BASE, VARIANTS[variant], SIZES[size], className)

    if (asChild) {
      const child = children as ReactElement<{ className?: string }>
      return cloneElement(child, {
        className: cn(classes, child.props.className),
        ...rest
      } as Partial<typeof child.props>)
    }

    return (
      <button ref={ref} className={classes} {...rest}>
        {children}
      </button>
    )
  }
)
```

- [ ] **Step 2: Rewrite `Badge.tsx`**

```tsx
/**
 * Badge — KLB square chip.
 *
 * Used for item-kind codes (SNG / VID / PDF), language tags, and status
 * counts. Square, 1px border, mono uppercase. The old rounded-full pill
 * is gone: it was the one radius `--radius: 0` could not reach, since
 * Tailwind hardcodes rounded-full to 9999px.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'signal' | 'neutral' | 'ok'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  signal: 'border-signal/45 text-signal',
  neutral: 'border-border text-soft',
  ok: 'border-ok/45 text-ok'
}

export function Badge({
  className,
  tone = 'neutral',
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-1.5 py-[3px]',
        'font-mono text-[8.5px] font-semibold uppercase leading-none tracking-[0.08em]',
        TONES[tone],
        className
      )}
      {...rest}
    />
  )
}
```

- [ ] **Step 3: Rewrite `Card.tsx` as `Panel`**

```tsx
/**
 * Panel — the KLB container: square, #111111, 1px #2A2A28 border.
 *
 * Optional `title` renders the design's header bar — a mono eyebrow on
 * a hairline-separated strip, with an optional right-aligned `action`.
 * That header/body split appears on nearly every panel in the design,
 * so it lives here rather than being rebuilt per screen.
 *
 * `Card` is exported as a deprecated alias so screens that have not yet
 * been converted keep compiling. It is removed in the Settings phase.
 */

import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { MonoLabel } from './MonoLabel'

// `title` must be Omit'd from the DOM attributes: HTMLAttributes declares it
// as `string`, so redeclaring it as ReactNode is a TS2430 conflict. It is
// destructured out below and never reaches the rendered <div>.
interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** String titles are wrapped in a MonoLabel; nodes are rendered as-is. */
  title?: ReactNode
  action?: ReactNode
  /** Signal-coloured border, for panels that need to demand attention. */
  emphasis?: boolean
}

export function Panel({
  className,
  title,
  action,
  emphasis = false,
  children,
  ...rest
}: PanelProps): JSX.Element {
  return (
    <div
      className={cn(
        'border bg-card',
        emphasis ? 'border-signal' : 'border-border',
        className
      )}
      {...rest}
    >
      {(title !== undefined || action !== undefined) && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {typeof title === 'string' ? <MonoLabel>{title}</MonoLabel> : title}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

/** @deprecated Use `Panel`. Removed once every screen is converted. */
export const Card = Panel
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS. If typecheck fails on a `variant="primary"` or
`tone="brand"` or `tone="outline"` call site, fix that call site to the new name
(`primary`→`signal`, `brand`→`signal`, `outline`→`neutral`) — do not re-add the
old name.

Run: `pnpm dev`
Expected: buttons are square with mono uppercase labels; badges are square
rectangles, no longer pills.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/Button.tsx src/renderer/src/components/ui/Badge.tsx src/renderer/src/components/ui/Card.tsx
git commit -m "feat(ui): square Button, Badge, and Panel primitives

Panel replaces Card and absorbs the design's header-bar pattern. Card
stays as a deprecated alias so unconverted screens still compile."
```

---

### Task 5: `Segmented`, `HairlineGrid`, `GapInsert`, `PageHeader`, `EmptyState` [VISUAL]

**Files:**
- Create: `src/renderer/src/components/ui/Segmented.tsx`
- Create: `src/renderer/src/components/ui/HairlineGrid.tsx`
- Create: `src/renderer/src/components/ui/GapInsert.tsx`
- Modify: `src/renderer/src/components/ui/PageHeader.tsx`
- Modify: `src/renderer/src/components/ui/EmptyState.tsx`

**Interfaces:**
- Produces:
  - `<Segmented<T> options={{value: T, label: string}[]} value={T} onChange={(v: T) => void} size?: 'sm'|'md'>`
  - `<HairlineGrid cols={number}>` — children are cells; the component supplies the seams.
  - `<GapInsert active?: boolean label?: string onClick={() => void}>`
  - `<PageHeader eyebrow title description? back? action?>`

- [ ] **Step 1: Create `Segmented.tsx`**

```tsx
/**
 * Segmented — joined button group for mode switches.
 *
 * LIVE/BLACK/LOGO, GROUPED/FLAT, DETAIL/COMPACT all use this shape: a
 * shared 1px container border with hairline dividers between children,
 * the active child filled signal. Generic over the value type so
 * callers keep their union types instead of stringly-typed modes.
 */

import { cn } from '../../lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className
}: SegmentedProps<T>): JSX.Element {
  const pad = size === 'sm' ? 'px-[11px] py-1.5 text-[8.5px]' : 'px-[13px] py-2 text-[9px]'

  return (
    <span className={cn('inline-flex border border-border', className)}>
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'font-mono font-semibold uppercase leading-none tracking-[0.1em] transition-colors',
              pad,
              i < options.length - 1 && 'border-r border-border',
              active ? 'bg-signal text-white' : 'bg-transparent text-muted-foreground hover:text-white'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}
```

- [ ] **Step 2: Create `HairlineGrid.tsx`**

```tsx
/**
 * HairlineGrid — the design's border-seam grid.
 *
 * The design builds every card grid and table as `border-left` on the
 * container plus `border-right`/`border-bottom` on each cell (see design
 * L103, L121, L431). That produces exact 1px seams; a naive
 * `border` on every cell would double them to 2px at every interior
 * edge, and `gap` would separate the cards entirely — neither matches.
 *
 * Cells are the direct children. This component owns the seams, so
 * children must NOT set their own borders on the seam edges.
 */

import type { ReactNode } from 'react'
import { Children } from 'react'
import { cn } from '../../lib/utils'

interface HairlineGridProps {
  cols: number
  children: ReactNode
  className?: string
}

export function HairlineGrid({ cols, children, className }: HairlineGridProps): JSX.Element {
  return (
    <div
      className={cn('grid border-l border-t border-border', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Children.map(children, (child) => (
        <div className="min-w-0 border-b border-r border-border">{child}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create `GapInsert.tsx`**

```tsx
/**
 * GapInsert — the "+ INSERT HERE" affordance between setlist items.
 *
 * A centred mono label flanked by two hairlines. Dim until hovered or
 * active; signal when its picker is open. Design L420-424.
 */

import { cn } from '../../lib/utils'

interface GapInsertProps {
  active?: boolean
  label?: string
  onClick: () => void
}

export function GapInsert({
  active = false,
  label = '+ INSERT HERE',
  onClick
}: GapInsertProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-6 w-full items-center"
    >
      <span className={cn('h-px flex-1 transition-colors', active ? 'bg-signal/50' : 'bg-rule')} />
      <span
        className={cn(
          'px-2.5 font-mono text-[9px] font-semibold uppercase leading-none tracking-[0.1em] transition-colors',
          active ? 'text-signal' : 'text-border group-hover:text-signal'
        )}
      >
        {label}
      </span>
      <span className={cn('h-px flex-1 transition-colors', active ? 'bg-signal/50' : 'bg-rule')} />
    </button>
  )
}
```

- [ ] **Step 4: Rewrite `PageHeader.tsx`**

Replace the file entirely:

```tsx
/**
 * PageHeader — the KLB screen header.
 *
 * Optional back link, mono eyebrow, Inter-800 title terminated by a
 * signal period, optional description, optional right-aligned action
 * cluster. Used by Library, Song Editor, and Settings.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MonoLabel } from './MonoLabel'
import { TitleDot } from './TitleDot'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description?: string
  /** Renders a "← LABEL" link above the eyebrow. */
  back?: { to: string; label: string }
  action?: ReactNode
  /** Extra content below the description, e.g. a tab row. */
  children?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  back,
  action,
  children
}: PageHeaderProps): JSX.Element {
  return (
    <header className="shrink-0 border-b border-border bg-card px-6 pt-6">
      <div className="flex items-end justify-between gap-6 pb-5">
        <div className="min-w-0">
          {back && (
            <Link
              to={back.to}
              className="mb-3 block font-mono text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground transition-colors hover:text-signal"
            >
              ← {back.label}
            </Link>
          )}
          <MonoLabel tone="signal" className="mb-2 block">
            {eyebrow}
          </MonoLabel>
          <h1 className="text-[36px] font-extrabold leading-none tracking-[-0.03em] text-foreground">
            {title}
            <TitleDot />
          </h1>
          {description && (
            <p className="mt-2 text-[13px] text-soft">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2.5">{action}</div>}
      </div>
      {children}
    </header>
  )
}
```

- [ ] **Step 5: Restyle `EmptyState.tsx`**

Read the file, then replace its container and text classes so it uses
`border border-border bg-card` (square, no radius), a `MonoLabel` for any
uppercase caption, `text-foreground` for the title at `font-bold text-[15px]`,
and `text-soft text-[12px]` for the description. Keep its existing props
(`icon`, `title`, `description`, `cta`) and behaviour unchanged.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ui/
git commit -m "feat(ui): add Segmented, HairlineGrid, GapInsert; rewrite PageHeader

HairlineGrid encapsulates the border-left/border-right seam pattern the
design uses for every grid, which produces exact 1px seams where a
naive per-cell border would double them."
```

**PHASE A CHECKPOINT.** Run `pnpm dev`. The app must run with no console errors, fully squared, signal orange. Screens are not yet converted. Do not proceed until this holds.

---

# PHASE B — Home + Pre-flight

### Task 6: Pre-flight contract and the pure reduction [TDD]

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Create: `src/renderer/src/lib/preflight.ts`
- Create: `src/renderer/src/lib/preflight.test.ts`

**Interfaces:**
- Produces: types `PreflightCheck`, `PreflightReport`, `PreflightRemedy`; channels `CHANNELS.system.getPreflight`, `CHANNELS.files.checkExists`; `PresentApi.system` and `PresentApi.files`; function `summarize(checks: PreflightCheck[]): { okCount: number; warningCount: number; headline: string; firstWarning: PreflightCheck | null }`.
- Consumed by: Task 7 (main handlers), Task 8 (PreflightPanel), Task 9 (Home).

- [ ] **Step 1: Add the types to `ipc-contract.ts`**

Insert before the `PresentApi` interface:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight (Home readiness checks)
//
// Four things break Sunday: the projector is on the wrong display, macOS
// Screen Recording is off so the confidence monitor is black, a media file
// moved since it was added, or there is no recent backup. Pre-flight surfaces
// all four on Saturday night with the remedy attached.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the operator can do about a failing check.
 *   'external' — `target` is a URL opened via shell.openExternal, e.g. the
 *                macOS Screen Recording privacy pane.
 *   'in-app'   — `target` is a renderer route, e.g. "/settings".
 */
export interface PreflightRemedy {
  label: string
  kind: 'external' | 'in-app'
  target: string
}

export interface PreflightCheck {
  id: 'display' | 'screenRecording' | 'media' | 'backup'
  status: 'ready' | 'warning'
  /** Short name, e.g. "Screen Recording" */
  name: string
  /** One-sentence explanation with the specific numbers filled in. */
  detail: string
  remedy?: PreflightRemedy
}

export interface PreflightReport {
  /**
   * Checks that APPLY on this platform. The screenRecording check is
   * macOS-only and is omitted entirely elsewhere, rather than emitting a
   * misleading disabled row — so consumers must never assume length 4.
   */
  checks: PreflightCheck[]
  /** ISO timestamp of when the report was produced. */
  checkedAt: string
}
```

Add to the `PresentApi` interface, after `settings`:

```ts
  /**
   * Readiness checks surfaced on Home. `setlistId` is nullable so Home can
   * ask before any setlist exists; the media check is then omitted.
   */
  system: {
    getPreflight(setlistId: string | null): Promise<PreflightReport>
    /** Open a remedy's target. Routes through shell.openExternal. */
    openExternal(url: string): Promise<void>
  }

  /** Read-only existence probe. Used by pre-flight and the setlist editor. */
  files: {
    checkExists(paths: string[]): Promise<Record<string, boolean>>
  }
```

Add to `CHANNELS`, after the `settings` block:

```ts
  system: {
    getPreflight: 'system:getPreflight',
    openExternal: 'system:openExternal'
  },
  files: {
    checkExists: 'files:checkExists'
  },
```

- [ ] **Step 2: Write the failing test**

Replace the canary content of `src/renderer/src/lib/preflight.test.ts` (create it):

```ts
import { describe, expect, it } from 'vitest'
import type { PreflightCheck } from '@shared/ipc-contract'
import { summarize } from './preflight'

const ready = (id: PreflightCheck['id']): PreflightCheck => ({
  id,
  status: 'ready',
  name: id,
  detail: 'fine'
})
const warn = (id: PreflightCheck['id']): PreflightCheck => ({
  id,
  status: 'warning',
  name: id,
  detail: 'not fine'
})

describe('summarize', () => {
  it('counts ok and warning checks', () => {
    const r = summarize([ready('display'), warn('screenRecording'), ready('media'), ready('backup')])
    expect(r.okCount).toBe(3)
    expect(r.warningCount).toBe(1)
  })

  it('builds the headline in the design’s format', () => {
    const r = summarize([ready('display'), warn('screenRecording'), ready('media'), ready('backup')])
    expect(r.headline).toBe('3 OK · 1 WARNING')
  })

  it('pluralises warnings', () => {
    const r = summarize([ready('display'), warn('media'), warn('backup')])
    expect(r.headline).toBe('1 OK · 2 WARNINGS')
  })

  it('omits the warning clause when everything passes', () => {
    const r = summarize([ready('display'), ready('media')])
    expect(r.headline).toBe('2 OK')
    expect(r.firstWarning).toBeNull()
  })

  // The macOS-only screenRecording check is absent on Windows and Linux.
  // Counts must stay internally consistent rather than assuming 4 checks.
  it('stays consistent when a platform check is omitted', () => {
    const r = summarize([ready('display'), ready('media'), ready('backup')])
    expect(r.okCount).toBe(3)
    expect(r.warningCount).toBe(0)
    expect(r.headline).toBe('3 OK')
  })

  it('returns the first warning so the hero banner can show it', () => {
    const r = summarize([ready('display'), warn('media'), warn('backup')])
    expect(r.firstWarning?.id).toBe('media')
  })

  it('handles an empty check list', () => {
    const r = summarize([])
    expect(r.okCount).toBe(0)
    expect(r.warningCount).toBe(0)
    expect(r.headline).toBe('0 OK')
    expect(r.firstWarning).toBeNull()
  })
})
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm test src/renderer/src/lib/preflight.test.ts`
Expected: FAIL — `Failed to resolve import "./preflight"`.

- [ ] **Step 4: Implement `preflight.ts`**

```ts
/**
 * Pre-flight presentation helpers.
 *
 * The report itself is produced in the main process (it needs Electron's
 * screen/systemPreferences APIs). This module is the pure reduction the
 * renderer needs: counts, the headline chip, and the first warning for
 * the hero banner.
 */

import type { PreflightCheck } from '@shared/ipc-contract'

export interface PreflightSummary {
  okCount: number
  warningCount: number
  /** "3 OK · 1 WARNING" — the chip in the pre-flight panel header. */
  headline: string
  /** First failing check, for the hero warning banner. Null when all pass. */
  firstWarning: PreflightCheck | null
}

export function summarize(checks: PreflightCheck[]): PreflightSummary {
  let okCount = 0
  let warningCount = 0
  let firstWarning: PreflightCheck | null = null

  for (const check of checks) {
    if (check.status === 'warning') {
      warningCount += 1
      if (firstWarning === null) firstWarning = check
    } else {
      okCount += 1
    }
  }

  const headline =
    warningCount === 0
      ? `${okCount} OK`
      : `${okCount} OK · ${warningCount} WARNING${warningCount === 1 ? '' : 'S'}`

  return { okCount, warningCount, headline, firstWarning }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `pnpm test src/renderer/src/lib/preflight.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/renderer/src/lib/preflight.ts src/renderer/src/lib/preflight.test.ts
git commit -m "feat(preflight): contract types and summary reduction"
```

---

### Task 7: Pre-flight main-process handlers [VISUAL]

**Files:**
- Create: `src/main/ipc/files.ts`
- Create: `src/main/ipc/system.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `PreflightCheck`, `PreflightReport`, `CHANNELS` from Task 6.
- Produces: working `window.api.system.getPreflight()`, `window.api.system.openExternal()`, `window.api.files.checkExists()`.

- [ ] **Step 1: Create the shared media-path helper**

Both the main-process pre-flight check and (in Task 15) the renderer's
media-check hook need "which file does this item depend on". Two copies would
drift, so it lives in `src/shared/` where both can import it.

Create `src/shared/setlist-media.ts`:

```ts
/**
 * The filesystem path a setlist item depends on, or null for items that
 * depend on none (songs, scripture, countdowns, section dividers).
 *
 * Shared because both the main-process pre-flight check and the renderer's
 * MEDIA MISSING banner need exactly this mapping, and a second copy would
 * drift the moment a new item kind lands.
 */

import type { SetlistItem } from './types'

export function mediaPathOf(item: SetlistItem): string | null {
  if (item.kind === 'image') return item.imagePath || null
  if (item.kind === 'video') return item.videoPath || null
  if (item.kind === 'deck') return item.pdfPath || null
  return null
}

/** The PickFileKind to reopen for a RELINK on this item, or null. */
export function relinkKindOf(item: SetlistItem): 'image' | 'video' | 'pdf' | null {
  if (item.kind === 'image') return 'image'
  if (item.kind === 'video') return 'video'
  if (item.kind === 'deck') return 'pdf'
  return null
}
```

- [ ] **Step 2: Create `src/main/ipc/files.ts`**

```ts
/**
 * Read-only file existence probe.
 *
 * Used by pre-flight ("11 of 12 media files found") and by the setlist
 * editor's MEDIA MISSING banner. Deliberately minimal: it answers
 * "is this path readable" and nothing else. No traversal, no stat
 * details, no writes.
 */

import { ipcMain } from 'electron'
import { access } from 'fs/promises'
import { CHANNELS } from '@shared/ipc-contract'

export function registerFilesHandlers(): void {
  ipcMain.handle(
    CHANNELS.files.checkExists,
    async (_, paths: string[]): Promise<Record<string, boolean>> => {
      if (!Array.isArray(paths)) return {}

      // Settled, not all-or-nothing: one unreadable path must not fail the
      // batch, or a single moved video would blank the whole report.
      const results = await Promise.all(
        paths.map(async (p) => {
          if (typeof p !== 'string' || p.length === 0) return [p, false] as const
          try {
            await access(p)
            return [p, true] as const
          } catch {
            return [p, false] as const
          }
        })
      )

      return Object.fromEntries(results)
    }
  )
}
```

- [ ] **Step 3: Create `src/main/ipc/system.ts`**

```ts
/**
 * Pre-flight readiness checks.
 *
 * Composes the four things that actually break a Sunday service, each
 * with the specific numbers filled in and a remedy where the operator
 * can act. Runs on Home mount and on RE-CHECK — never polled.
 */

import { ipcMain, screen, shell, systemPreferences } from 'electron'
import { access } from 'fs/promises'
import {
  CHANNELS,
  type PreflightCheck,
  type PreflightReport
} from '@shared/ipc-contract'
import type { Setlist } from '@shared/types'
import { mediaPathOf } from '@shared/setlist-media'
import { readSettings } from '../storage/settings'
import { readSetlist } from '../storage/setlists'
import { listBackups } from '../storage/backup'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function checkDisplay(): PreflightCheck {
  const displays = screen.getAllDisplays()
  const settings = readSettings()
  const saved = settings.outputDisplayId

  if (displays.length < 2) {
    return {
      id: 'display',
      status: 'warning',
      name: 'Output display',
      detail:
        'Only one display detected. The projector window will cover this screen — plug in the projector before the service.',
      remedy: { label: 'OPEN SETTINGS', kind: 'in-app', target: '/settings' }
    }
  }

  if (saved !== null && !displays.some((d) => d.id === saved)) {
    return {
      id: 'display',
      status: 'warning',
      name: 'Output display',
      detail:
        'The display this was pointed at is no longer connected. Output will fall back to the primary screen.',
      remedy: { label: 'PICK A DISPLAY', kind: 'in-app', target: '/settings' }
    }
  }

  const target = saved === null ? screen.getPrimaryDisplay() : displays.find((d) => d.id === saved)!
  return {
    id: 'display',
    status: 'ready',
    name: 'Output display',
    detail: `${target.size.width}×${target.size.height} — projector window has a display to land on.`
  }
}

/**
 * macOS only. The confidence monitor mirrors the output window through
 * desktopCapturer (see VideoSlideOperator in SlideRenderer.tsx), so
 * without this permission it genuinely renders black mid-service.
 *
 * Returns null on every other platform so the caller can omit the check
 * rather than show a meaningless disabled row.
 */
function checkScreenRecording(): PreflightCheck | null {
  if (process.platform !== 'darwin') return null

  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') {
    return {
      id: 'screenRecording',
      status: 'ready',
      name: 'Screen Recording',
      detail: 'Granted — the confidence monitor can mirror the projector.'
    }
  }

  return {
    id: 'screenRecording',
    status: 'warning',
    name: 'Screen Recording',
    detail:
      'macOS permission is off, so your confidence monitor will be black. System Settings → Privacy & Security → Screen Recording.',
    remedy: {
      label: 'SHOW ME HOW',
      kind: 'external',
      target:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    }
  }
}

async function checkMedia(setlistId: string | null): Promise<PreflightCheck | null> {
  if (!setlistId) return null

  let setlist: Setlist | null = null
  try {
    setlist = readSetlist(setlistId)
  } catch {
    setlist = null
  }
  if (!setlist) return null

  const paths = setlist.items
    .map(mediaPathOf)
    .filter((p): p is string => p !== null)
  if (paths.length === 0) {
    return {
      id: 'media',
      status: 'ready',
      name: 'Media files',
      detail: 'No image, video, or PDF items in this setlist — nothing to go missing.'
    }
  }

  let found = 0
  for (const p of paths) {
    try {
      await access(p)
      found += 1
    } catch {
      // counted as missing below
    }
  }

  const missing = paths.length - found
  if (missing === 0) {
    return {
      id: 'media',
      status: 'ready',
      name: 'Media files',
      detail: `All ${paths.length} found.`
    }
  }

  return {
    id: 'media',
    status: 'warning',
    name: 'Media files',
    detail: `${found} of ${paths.length} found. ${missing === 1 ? 'One file has' : `${missing} files have`} moved — open the setlist to relink.`,
    remedy: { label: 'OPEN SETLIST', kind: 'in-app', target: `/setlists/${setlistId}` }
  }
}

function checkBackup(): PreflightCheck {
  let newest: { createdAt: string } | undefined
  try {
    newest = listBackups()[0]
  } catch {
    newest = undefined
  }

  if (!newest) {
    return {
      id: 'backup',
      status: 'warning',
      name: 'Backup',
      detail: 'No backups yet. One bad restore and the library is gone.',
      remedy: { label: 'BACK UP NOW', kind: 'in-app', target: '/settings' }
    }
  }

  const ageMs = Date.now() - new Date(newest.createdAt).getTime()
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor(ageMs / (60 * 60 * 1000))
  const ago = days >= 1 ? `${days} day${days === 1 ? '' : 's'} ago` : `${hours} hour${hours === 1 ? '' : 's'} ago`

  if (ageMs > SEVEN_DAYS_MS) {
    return {
      id: 'backup',
      status: 'warning',
      name: 'Backup',
      detail: `Last backup ${ago}. Auto-backup may not be running.`,
      remedy: { label: 'BACK UP NOW', kind: 'in-app', target: '/settings' }
    }
  }

  return {
    id: 'backup',
    status: 'ready',
    name: 'Backup',
    detail: `Last automatic backup ${ago}.`
  }
}

export function registerSystemHandlers(): void {
  ipcMain.handle(
    CHANNELS.system.getPreflight,
    async (_, setlistId: string | null): Promise<PreflightReport> => {
      const checks: PreflightCheck[] = [checkDisplay()]

      const screenCheck = checkScreenRecording()
      if (screenCheck) checks.push(screenCheck)

      const mediaCheck = await checkMedia(setlistId)
      if (mediaCheck) checks.push(mediaCheck)

      checks.push(checkBackup())

      return { checks, checkedAt: new Date().toISOString() }
    }
  )

  ipcMain.handle(CHANNELS.system.openExternal, async (_, url: string): Promise<void> => {
    if (typeof url !== 'string') return
    await shell.openExternal(url)
  })
}
```

**Before writing this file, verify the storage import names.** Run
`grep -n "^export " src/main/storage/settings.ts src/main/storage/setlists.ts src/main/storage/backup.ts`
and adjust `readSettings` / `readSetlist` / `listBackups` to the actual exported
names and signatures. Do not guess — if `readSetlist` is async or named
differently, match it.

- [ ] **Step 4: Register the handlers**

In `src/main/ipc/index.ts`, add the two imports alongside the existing ones and
two calls at the end of `registerAllIpcHandlers()`:

```ts
import { registerSystemHandlers } from './system'
import { registerFilesHandlers } from './files'
```

```ts
  registerSystemHandlers()
  registerFilesHandlers()
```

- [ ] **Step 5: Wire the preload**

In `src/preload/index.ts`, add to the `api` object after the `settings` block:

```ts
  system: {
    getPreflight: (setlistId: string | null) =>
      ipcRenderer.invoke(CHANNELS.system.getPreflight, setlistId),
    openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.system.openExternal, url)
  },
  files: {
    checkExists: (paths: string[]) => ipcRenderer.invoke(CHANNELS.files.checkExists, paths)
  },
```

- [ ] **Step 6: Verify end to end**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS.

Run: `pnpm dev`, then in the operator window's devtools console:

```js
await window.api.system.getPreflight(null)
```

Expected: an object with `checks` (3 entries on macOS with no setlist: display,
screenRecording, backup) and `checkedAt`. Each check has `id`, `status`, `name`,
`detail`. Confirm `screenRecording` is present on macOS.

```js
await window.api.files.checkExists(['/etc/hosts', '/definitely/not/here'])
```

Expected: `{ '/etc/hosts': true, '/definitely/not/here': false }`.

**This console check stands in for the spec's `files.checkExists` unit test.**
`vitest`'s include covers `src/shared` and `src/renderer/src/lib`, not
`src/main` — main-process code needs an Electron runtime, so a node-environment
unit test cannot exercise `ipcMain.handle`. The two-path call above proves both
properties the spec asked for: a missing path yields `false` rather than
throwing, and it does not prevent the sibling path from resolving `true`. Do not
widen the vitest glob to `src/main` to force a test here; it would need an
Electron harness this project does not have.

- [ ] **Step 7: Commit**

```bash
git add src/shared/setlist-media.ts src/main/ipc/system.ts src/main/ipc/files.ts src/main/ipc/index.ts src/preload/index.ts
git commit -m "feat(preflight): main-process checks for display, permission, media, backup

Screen Recording is macOS-only and omitted entirely elsewhere rather
than shown as a disabled row. The check earns its place: the confidence
monitor mirrors output via desktopCapturer, so without the permission it
really does render black."
```

---

### Task 8: `PreflightPanel` component [VISUAL]

**Files:**
- Create: `src/renderer/src/components/PreflightPanel.tsx`

**Interfaces:**
- Consumes: `summarize` (Task 6), `Panel`, `HairlineGrid`, `MonoLabel`, `StatusDot`, `Button`, `Badge`.
- Produces: `<PreflightPanel report onRecheck busy? />` and `<PreflightBanner check onAct />`.

- [ ] **Step 1: Create the component**

Structure, per design L92–115 (panel) and L62–66 (banner):

```tsx
/**
 * PreflightPanel — Home's readiness grid.
 *
 * Header: "PRE-FLIGHT" eyebrow, the rationale line, an "N OK · M WARNING"
 * chip, and RE-CHECK. Body: one cell per check in a HairlineGrid, each
 * with a status dot, status word, name, and detail.
 *
 * PreflightBanner is the hero's inline warning strip — it shows only the
 * FIRST warning, with its remedy button, because the hero has room for
 * one line and the panel below carries the rest.
 */

import type { PreflightCheck, PreflightReport } from '@shared/ipc-contract'
import { summarize } from '../lib/preflight'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { HairlineGrid } from './ui/HairlineGrid'
import { MonoLabel } from './ui/MonoLabel'
import { StatusDot } from './ui/StatusDot'

export function PreflightBanner({
  check,
  count,
  onAct
}: {
  check: PreflightCheck
  count: number
  onAct: (check: PreflightCheck) => void
}): JSX.Element {
  return (
    <div className="mb-[18px] flex items-center gap-3 border border-signal/50 bg-signal/[0.08] px-3.5 py-[11px]">
      <MonoLabel tone="signal" size="xs" className="shrink-0">
        {count} WARNING{count === 1 ? '' : 'S'}
      </MonoLabel>
      <span className="flex-1 text-[12px] text-bone">{check.detail}</span>
      {check.remedy && (
        <Button
          size="sm"
          onClick={() => onAct(check)}
          className="shrink-0 border-signal text-signal hover:bg-signal hover:text-white"
        >
          {check.remedy.label}
        </Button>
      )}
    </div>
  )
}

export function PreflightPanel({
  report,
  onRecheck,
  busy = false
}: {
  report: PreflightReport | null
  onRecheck: () => void
  busy?: boolean
}): JSX.Element | null {
  if (!report) return null
  const { headline, warningCount } = summarize(report.checks)

  return (
    <Panel
      className="mb-[34px]"
      title={
        <span className="flex items-baseline gap-3.5">
          <MonoLabel>PRE-FLIGHT</MonoLabel>
          <span className="text-[12px] text-muted-foreground">
            Checked on launch — Saturday night, not Sunday morning.
          </span>
        </span>
      }
      action={
        <span className="flex items-center gap-2.5">
          <Badge tone={warningCount > 0 ? 'signal' : 'ok'}>{headline}</Badge>
          <Button size="sm" onClick={onRecheck} disabled={busy}>
            {busy ? 'CHECKING…' : 'RE-CHECK'}
          </Button>
        </span>
      }
    >
      {/* cols is the check COUNT, not a hardcoded 4 — the macOS-only
          screenRecording check is absent on Windows and Linux, and the
          grid has to stay even when it is. */}
      <HairlineGrid cols={report.checks.length} className="border-l-0 border-t-0">
        {report.checks.map((c) => (
          <div key={c.id} className="px-[18px] py-4">
            <span className="mb-2 flex items-center gap-2">
              <StatusDot tone={c.status === 'ready' ? 'ok' : 'signal'} />
              <MonoLabel tone={c.status === 'ready' ? 'muted' : 'signal'} size="xs">
                {c.status === 'ready' ? 'READY' : 'ACTION NEEDED'}
              </MonoLabel>
            </span>
            <span className="mb-1 block text-[13.5px] font-bold text-foreground">{c.name}</span>
            <span className="block text-[11.5px] leading-[1.55] text-muted-foreground">
              {c.detail}
            </span>
          </div>
        ))}
      </HairlineGrid>
    </Panel>
  )
}
```

Add `Panel` to the imports: `import { Panel } from './ui/Card'`.

`border-l-0 border-t-0` on the grid is deliberate — the `Panel` already draws
the outer border, and `HairlineGrid`'s own left/top edges would double it.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/PreflightPanel.tsx
git commit -m "feat(preflight): PreflightPanel and hero warning banner"
```

---

### Task 9: Convert Home [VISUAL]

**Files:**
- Modify: `src/renderer/src/pages/Home.tsx`
- Modify: `src/renderer/src/lib/setlist-helpers.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–8.
- Produces: `pickHero(setlists: Setlist[]): Setlist | null` exported from `setlist-helpers.ts` (moved out of `Home.tsx`), consumed by Task 11.

Reference: design L37–142.

- [ ] **Step 1: Move `pickHero` into `setlist-helpers.ts`**

Cut the `pickHero` function from the bottom of `Home.tsx` (currently lines
453–465) and paste it into `src/renderer/src/lib/setlist-helpers.ts` as an
exported function, keeping its doc comment. Import it back into `Home.tsx`.
Song Library needs the same definition in Task 11, and two copies would drift.

- [ ] **Step 2: Rewrite the Home JSX**

Structure to build, replacing the current hero and card grid:

1. **Header** (design L40–51) — `Present` + `<TitleDot />` at Inter 800 22px,
   `PROCHURCHCENTER` MonoLabel lockup, ghost nav buttons for SONG LIBRARY and
   SETTINGS, a 1px `bg-border` divider, and a `signal` `+ NEW SETLIST` button.
   Delete the two `blur-3xl` glow divs and the `shadow-[...]` on the hero.

2. **Hero** (design L54–90) — `Panel emphasis` containing a
   `grid grid-cols-[1.25fr_1fr]`:
   - Left: `<StatusDot pulse />` + `NEXT UP` MonoLabel; setlist name at
     `text-[56px] font-extrabold leading-[1.02] tracking-[-0.035em]` with
     `<TitleDot />`; a mono meta line
     `{DATE} · {N} ITEMS · {N} SLIDES` (slide count from `slideifySetlist`
     against the loaded song library — not stored); the `<PreflightBanner>`
     when `warningCount > 0`; a joined button row
     `START SERVICE →` (signal) / `EDIT` / `REHEARSE` where the latter two use
     `border-l-0` to join; the quiet Clone/Delete row.
   - Right: `border-l border-border`, a `SERVICE PLAN` / `N TOTAL` header row,
     then up to 5 numbered rows each with index, a `<Badge>` kind code, and the
     item label, separated by `border-b border-rule`; a `+ N MORE` footer when
     items exceed 5.

3. **`<PreflightPanel>`** below the hero.

4. **Other setlists** (design L117–139) — a MonoLabel header row with
   `N SAVED`, then `<HairlineGrid cols={3}>` of setlist cells. Each cell: a
   52px square date tile (`border border-border`, mono month over Inter-800
   day), the name at `text-[15px] font-bold`, a mono meta line, and the
   item-kind `<Badge>` strip. Replace the current `gap-4` grid entirely — cards
   are adjacent with 1px seams, not separated.

5. **Pre-flight wiring** — `useState<PreflightReport | null>`, load on mount via
   `window.api.system.getPreflight(heroSetlist?.id ?? null)`, reload on
   RE-CHECK. Not polled. Remedy handler: `kind === 'external'` calls
   `window.api.system.openExternal(target)`, `kind === 'in-app'` calls
   `navigate(target)`.

Keep all existing behaviour: `handleNew`, `handleCloneLast`, `handleDelete`,
loading and error states, and the `EmptyState` when there are no setlists.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS.

Run: `pnpm dev`
Expected acceptance checks:
1. Home matches design L37–142 in structure: hero with orange border, pre-flight strip below, seamless 3-col setlist grid.
2. The pre-flight panel shows 3 cards on macOS with no media items, 4 with them.
3. Turning off Screen Recording in System Settings and pressing RE-CHECK flips that card to ACTION NEEDED and surfaces the hero banner.
4. Clicking SHOW ME HOW opens the macOS privacy pane.
5. No rounded corners, no glow, no gradient anywhere on the page.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Home.tsx src/renderer/src/lib/setlist-helpers.ts
git commit -m "feat(home): KLB conversion + pre-flight panel

pickHero moves to setlist-helpers so Song Library can bind its
setlist-membership column to the same setlist Home spotlights."
```

**PHASE B CHECKPOINT.** Home is converted and pre-flight works end to end.

---

# PHASE C — Library + Song Editor

### Task 10: Theme field descriptor table [TDD]

**Files:**
- Create: `src/renderer/src/lib/themeFields.ts`
- Create: `src/renderer/src/lib/themeFields.test.ts`

**Interfaces:**
- Produces: `THEME_FIELDS: ThemeFieldDef[]`, `formatFieldValue(def, value): string`, `type ThemeFieldDef`.
- Consumed by: Task 12 (`ThemeOverrideEditor`).

Design reference L815–829 for the field table, L269–331 for the UI it drives.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { THEME_FIELDS, formatFieldValue } from './themeFields'

describe('THEME_FIELDS', () => {
  it('covers the twelve overridable fields', () => {
    expect(THEME_FIELDS).toHaveLength(12)
  })

  it('has a unique key per field', () => {
    const keys = THEME_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('groups fields into the design’s six sections', () => {
    const groups = new Set(THEME_FIELDS.map((f) => f.group))
    expect(groups).toEqual(
      new Set(['TYPE', 'BACKDROP', 'PLACEMENT', 'LEGIBILITY', 'MOTION', 'STANDBY'])
    )
  })

  it('gives every seg and swatch field at least two options', () => {
    for (const f of THEME_FIELDS) {
      if (f.kind === 'seg' || f.kind === 'swatch') {
        expect(f.options.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('gives every step field a coherent range', () => {
    for (const f of THEME_FIELDS) {
      if (f.kind === 'step') {
        expect(f.min).toBeLessThan(f.max)
        expect(f.step).toBeGreaterThan(0)
      }
    }
  })
})

describe('formatFieldValue', () => {
  it('appends the unit for step fields', () => {
    const size = THEME_FIELDS.find((f) => f.key === 'fontSizePercent')!
    expect(formatFieldValue(size, 130)).toBe('130%')
  })

  it('appends ms for the fade duration', () => {
    const dur = THEME_FIELDS.find((f) => f.key === 'transitionDurationMs')!
    expect(formatFieldValue(dur, 200)).toBe('200ms')
  })

  it('shows the option label rather than the raw value for seg fields', () => {
    const align = THEME_FIELDS.find((f) => f.key === 'textAlign')!
    expect(formatFieldValue(align, 'center')).toBe('CENTER')
  })

  it('renders a null file path as an em dash', () => {
    const logo = THEME_FIELDS.find((f) => f.key === 'logoPath')!
    expect(formatFieldValue(logo, null)).toBe('—')
  })

  it('shows only the basename of a file path', () => {
    const logo = THEME_FIELDS.find((f) => f.key === 'logoPath')!
    expect(formatFieldValue(logo, '/Users/rose/Media/Paint Sweeps.png')).toBe('Paint Sweeps.png')
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm test src/renderer/src/lib/themeFields.test.ts`
Expected: FAIL — cannot resolve `./themeFields`.

- [ ] **Step 3: Implement `themeFields.ts`**

```ts
/**
 * Declarative descriptor table for the per-song theme override editor.
 *
 * The chip-promotion UI needs to enumerate every overridable field
 * generically — to list what is inherited, render the right control per
 * field, and format a value for a chip. Hand-writing twelve bespoke rows
 * in JSX would make "which fields can be overridden" a fact scattered
 * across a component instead of a table you can read.
 *
 * Mirrors the design file's FIELDS constant (L815-828).
 */

import type { ThemeOverride } from '@shared/types'
import type { PickFileKind } from '@shared/ipc-contract'

export type ThemeFieldGroup =
  | 'TYPE'
  | 'BACKDROP'
  | 'PLACEMENT'
  | 'LEGIBILITY'
  | 'MOTION'
  | 'STANDBY'

interface FieldBase {
  key: keyof ThemeOverride
  group: ThemeFieldGroup
  label: string
  /** Short clarifier shown beside the label. Empty when self-evident. */
  hint: string
}

export interface FieldOption {
  value: string
  label: string
}

export type ThemeFieldDef =
  | (FieldBase & { kind: 'select'; options: FieldOption[] })
  | (FieldBase & { kind: 'seg'; options: FieldOption[] })
  | (FieldBase & { kind: 'swatch'; options: FieldOption[] })
  | (FieldBase & { kind: 'step'; step: number; min: number; max: number; unit: string })
  | (FieldBase & { kind: 'file'; pickKind: PickFileKind })

export const THEME_FIELDS: ThemeFieldDef[] = [
  {
    key: 'fontFamily',
    group: 'TYPE',
    label: 'Font',
    hint: 'built-in, uploaded or system',
    kind: 'select',
    // Values match BUILT_IN_FONT_OPTIONS in ThemeFields.tsx so global and
    // per-song overrides produce identical font stacks.
    options: [
      { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
      { value: 'system-ui, -apple-system, Segoe UI, sans-serif', label: 'System' },
      { value: 'Helvetica Neue, Helvetica, Arial, sans-serif', label: 'Helvetica' },
      { value: 'Georgia, serif', label: 'Georgia' },
      { value: 'Menlo, Courier New, monospace', label: 'Courier' }
    ]
  },
  {
    key: 'fontSizePercent',
    group: 'TYPE',
    label: 'Size',
    hint: 'scales the auto-fit baseline',
    kind: 'step',
    step: 10,
    min: 50,
    max: 150,
    unit: '%'
  },
  {
    key: 'textColor',
    group: 'TYPE',
    label: 'Text colour',
    hint: 'lyrics and scripture',
    kind: 'swatch',
    options: [
      { value: '#FFFFFF', label: 'WHITE' },
      { value: '#ECE9E4', label: 'BONE' },
      { value: '#E23C0F', label: 'SIGNAL' }
    ]
  },
  {
    key: 'backgroundColor',
    group: 'BACKDROP',
    label: 'Background colour',
    hint: 'base layer',
    kind: 'swatch',
    options: [
      { value: '#000000', label: 'BLACK' },
      { value: '#101822', label: 'NAVY' },
      { value: '#1A0F0B', label: 'EMBER' }
    ]
  },
  {
    key: 'backgroundImagePath',
    group: 'BACKDROP',
    label: 'Background media',
    hint: 'image or ambient video',
    kind: 'file',
    pickKind: 'media'
  },
  {
    key: 'textAlign',
    group: 'PLACEMENT',
    label: 'Horizontal',
    hint: '',
    kind: 'seg',
    options: [
      { value: 'left', label: 'LEFT' },
      { value: 'center', label: 'CENTER' },
      { value: 'right', label: 'RIGHT' }
    ]
  },
  {
    key: 'textPosition',
    group: 'PLACEMENT',
    label: 'Vertical',
    hint: '',
    kind: 'seg',
    options: [
      { value: 'top', label: 'TOP' },
      { value: 'center', label: 'MIDDLE' },
      { value: 'bottom', label: 'BOTTOM' }
    ]
  },
  {
    key: 'textEffect',
    group: 'LEGIBILITY',
    label: 'Text effect',
    hint: 'against busy backgrounds',
    kind: 'seg',
    options: [
      { value: 'none', label: 'NONE' },
      { value: 'shadow', label: 'SHADOW' },
      { value: 'outline', label: 'OUTLINE' },
      { value: 'highlight', label: 'HIGHLIGHT' }
    ]
  },
  {
    key: 'highlightColor',
    group: 'LEGIBILITY',
    label: 'Highlight colour',
    hint: 'used by the highlight effect',
    kind: 'swatch',
    options: [
      { value: '#E23C0F', label: 'SIGNAL' },
      { value: '#111111', label: 'INK' },
      { value: '#ECE9E4', label: 'BONE' }
    ]
  },
  {
    key: 'transition',
    group: 'MOTION',
    label: 'Transition',
    hint: '',
    kind: 'seg',
    options: [
      { value: 'fade', label: 'FADE' },
      { value: 'instant', label: 'INSTANT' }
    ]
  },
  {
    key: 'transitionDurationMs',
    group: 'MOTION',
    label: 'Fade duration',
    hint: '',
    kind: 'step',
    step: 50,
    min: 50,
    max: 1000,
    unit: 'ms'
  },
  {
    key: 'logoPath',
    group: 'STANDBY',
    label: 'Standby image',
    hint: 'shown when you press L',
    kind: 'file',
    pickKind: 'image'
  }
]

/**
 * Render a field's current value for a chip or a summary row.
 *
 * File paths collapse to their basename — an override chip showing a full
 * /Users/... path would blow out the tray layout, and the filename is the
 * only part the operator recognises.
 */
export function formatFieldValue(def: ThemeFieldDef, value: unknown): string {
  if (def.kind === 'step') {
    return `${value ?? ''}${def.unit}`
  }

  if (def.kind === 'file') {
    if (typeof value !== 'string' || value.length === 0) return '—'
    const parts = value.split(/[/\\]/)
    return parts[parts.length - 1] || '—'
  }

  const match = def.options.find((o) => o.value === value)
  return match ? match.label : String(value ?? '—')
}
```

Note `textPosition`'s middle option uses value `'center'` — that is the
`TextPosition` union's actual member, even though the design labels it MIDDLE.
Label and value are deliberately different here.

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm test src/renderer/src/lib/themeFields.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/themeFields.ts src/renderer/src/lib/themeFields.test.ts
git commit -m "feat(theme): declarative field descriptor table for the override editor"
```

---

### Task 11: Convert Song Library [VISUAL]

**Files:**
- Modify: `src/renderer/src/pages/SongLibrary.tsx`

**Interfaces:**
- Consumes: `pickHero` from `setlist-helpers` (Task 9), `PageHeader`, `Badge`, `MonoLabel`, `Button`.

Reference: design L144–186.

- [ ] **Step 1: Rewrite the JSX**

1. `<PageHeader back={{to:'/', label:'HOME'}} eyebrow="LIBRARY" title="Songs" action={<>search input, + NEW SONG</>}>` with a live `N IN LIBRARY` MonoLabel under the title.
2. Search input: `border border-border`, 38px tall, 280px wide, an inline magnifier SVG (design L157), transparent background, placeholder `Search title, author, tag…`.
3. Table: `grid-cols-[1fr_190px_150px_96px_130px]`. Sticky header row (`sticky top-0 bg-card border-b border-border`) of MonoLabels: TITLE, AUTHOR, TAGS, UPDATED, and the setlist column.
4. Rows: `border-b border-rule`, `hover:bg-[hsl(var(--panel-hi))]`, title at `text-[14.5px] font-semibold`, author at `text-[13px] text-soft`, tag cell with a `signal` Badge for language and a `neutral` Badge for section count, updated at mono `text-[10px]`.
5. **Setlist-membership column** — binds to `pickHero(setlists)`. Header shows that setlist's date. Cell renders `IN SETLIST` (signal Badge) or `+ ADD` (dim Badge) and toggles membership on click via the setlist store. **When `pickHero` returns null, omit this column and drop the grid to `grid-cols-[1fr_190px_150px_96px]`.**

Keep existing search/filter behaviour and navigation to the song editor.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.
Run: `pnpm dev`, open Song Library. Acceptance:
1. Header row stays fixed while the list scrolls.
2. With at least one setlist, the last column shows its date and toggling a song updates the setlist.
3. With zero setlists, the last column is gone and the layout does not break.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/SongLibrary.tsx
git commit -m "feat(library): KLB conversion with setlist-membership column"
```

---

### Task 12: Convert Song Editor + chip-promotion override editor [VISUAL]

**Files:**
- Create: `src/renderer/src/components/ThemeOverrideEditor.tsx`
- Modify: `src/renderer/src/pages/SongEditor.tsx`

**Interfaces:**
- Consumes: `THEME_FIELDS`, `formatFieldValue` (Task 10); `mergeThemeOverride` from `../lib/themeOverride` (unchanged).
- Produces: `<ThemeOverrideEditor override globalTheme onChange previewSlide />`.

Reference: design L188–356, override block L234–335.

- [ ] **Step 1: Build `ThemeOverrideEditor.tsx`**

Two states.

**Inactive** (`override === null`) — a `border border-dashed border-dim` row:
title `Theme override`, description
`This song uses the global theme. Override it to give this one song its own look.`,
and an `OVERRIDE THEME` button that calls `onChange({})`.

**Active** — a `Panel emphasis` containing, in order:

1. Header: `THEME OVERRIDE · THIS SONG ONLY` MonoLabel + a `REMOVE OVERRIDE`
   ghost button calling `onChange(null)`.
2. A 16:9 live preview of the song's first real slide with the effective theme
   (`mergeThemeOverride(globalTheme, override)`) applied, plus the caption
   `LIVE — THIS SONG'S FIRST SLIDE WITH THE OVERRIDE APPLIED`.
3. A count row: `{n} OF {THEME_FIELDS.length} FIELDS OVERRIDDEN · REST INHERITED`
   and a `REVERT ALL` button (visible only when `n > 0`) calling `onChange({})`.
4. When `n === 0`, the empty block: `Nothing overridden yet` plus the paragraph
   from design L265.
5. One row per **active** field — those whose key is present in `override`.
   Each row: group MonoLabel, label, hint, a `REVERT` button that deletes just
   that key, and the field's control rendered by `kind`:
   - `seg` → `<Segmented>`
   - `swatch` → row of 26px colour buttons plus the current value in a mono chip
   - `step` → `−` / value / `+` buttons clamped to `[min, max]`
   - `select` → a `<select>` styled `bg-background border border-border`
   - `file` → the basename plus a `CHOOSE…` button calling
     `window.api.dialog.pickFile(def.pickKind)`
6. `OVERRIDE ANOTHER FIELD` tray: `border border-dashed border-dim` chips, one
   per **inherited** field, showing group, label, and current effective value.
   Clicking seeds `override[key] = effective[key]` — so promotion is a visual
   no-op until the operator actually edits it. That is the whole point of the
   interaction: adding a field must never change the slide.
7. Footer line: `Anything you don't set here is inherited from the global theme — clearing a field never wipes the global one.`

**Note on the two background fields.** `THEME_FIELDS` has `backgroundImagePath`
as the single "Background media" file row. When the operator picks a video
extension, also clear `backgroundColor`? No — mirror the existing Settings
behaviour: picking a background video clears the image and vice versa. Check how
`ThemeFields.tsx` currently does this and reuse the same rule, so global and
per-song behave identically.

- [ ] **Step 2: Convert the rest of `SongEditor.tsx`**

Header (design L191–201): `← SONGS` back link, title at Inter-800 26px, author,
a saved-state pill (`StatusDot` + `SAVED` MonoLabel in a bordered box), `DELETE`.

Body: `grid grid-cols-[47%_53%]`.

Left column, `overflow-y-auto scroll-hairline`, stacked `Panel`s:
DETAILS (2-col field grid), LYRICS (with the
`[SECTION] HEADERS · BLANK LINE = NEW SLIDE` hint and a `font-mono text-[13px] leading-[2]`
textarea), OPERATOR NOTES · NEVER PROJECTED, then `<ThemeOverrideEditor>`.

Right column: `LIVE PREVIEW · N SLIDES` MonoLabel with a `MAX N LINES` Badge,
then a 2-col `HairlineGrid` of slide cards — each a mono header bar plus a 16:9
black body with centred text and a corner shortcut glyph. Driven by the existing
`previewSongSlides`.

Replace the old `ThemeOverrideSection`. **Do not modify `ThemeFields.tsx`** —
Settings still uses it and it is restyled in Task 21.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.
Run: `pnpm dev`, open a song. Acceptance:
1. `OVERRIDE THEME` seeds an empty override; the preview does not change.
2. Clicking an inherited chip promotes that field; **the preview still does not change.**
3. Editing the promoted field changes the preview immediately.
4. `REVERT` on a row removes only that field; others survive.
5. `REVERT ALL` empties the override but keeps it active; `REMOVE OVERRIDE` sets it to null.
6. Reloading the song persists exactly the fields that were overridden.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ThemeOverrideEditor.tsx src/renderer/src/pages/SongEditor.tsx
git commit -m "feat(song-editor): KLB conversion + chip-promotion override editor

Promoting an inherited field seeds it at its current effective value, so
adding a field is a visual no-op until it is edited. Makes 'what is
actually overridden' legible, which the all-fields form hid."
```

**PHASE C CHECKPOINT.**

---

# PHASE D — Setlist Editor + Service Timing

### Task 13: Schema fields [TDD]

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc-contract.ts`

**Interfaces:**
- Produces: `SetlistItemTiming`, `SetlistItem` as an intersection, `Setlist.startTime`, `UpdateSetlistPatch` including `startTime`.

- [ ] **Step 1: Restructure `SetlistItem`**

TypeScript has no syntax for "add a field to every member of a union", and
repeating it seven times invites drift. Wrap instead — narrowing on `kind`
still works exactly as before:

```ts
/**
 * Planned duration in whole minutes, used by the setlist editor's running
 * clock. Absent means "not yet estimated" and contributes 0. Section
 * dividers are always 0 — they occupy no service time because they never
 * reach the projector.
 */
export interface SetlistItemTiming {
  durationMinutes?: number
}

export type SetlistItem = (
  | { kind: 'song'; id: string; songId: string }
  | { kind: 'scripture'; id: string; reference: string; text: string; translation: string }
  | { kind: 'section-divider'; id: string; label: string }
  | { kind: 'image'; id: string; imagePath: string; caption?: string }
  | { kind: 'countdown'; id: string; label: string; targetTime: string }
  | { kind: 'video'; id: string; videoPath: string; title?: string; loop?: boolean }
  | { kind: 'deck'; id: string; pdfPath: string; pageCount: number; title?: string }
) &
  SetlistItemTiming
```

Preserve every existing doc comment on the individual variants — move them onto
the corresponding members rather than dropping them.

Add to `Setlist`:

```ts
  /**
   * Wall-clock service start, "HH:MM" 24-hour local. Absent defaults to
   * "10:00". Drives the per-item clock column in the setlist editor.
   */
  startTime?: string
```

In `ipc-contract.ts`, widen the patch type:

```ts
export type UpdateSetlistPatch = Partial<
  Pick<Setlist, 'name' | 'date' | 'items' | 'startTime'>
>
```

- [ ] **Step 2: Verify nothing broke**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS with no changes to any consumer. If a `switch (item.kind)`
stops narrowing, the intersection was written wrong — the union must be
parenthesised before the `&`.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/shared/ipc-contract.ts
git commit -m "feat(schema): optional durationMinutes and startTime

Both optional with defined defaults, so existing setlists and backup
zips load unchanged."
```

---

### Task 14: `serviceClock` [TDD]

**Files:**
- Modify: `src/renderer/src/lib/serviceClock.ts` (Task 1 seeded it with `parseStart`, `DEFAULT_START_MINUTES`, `MINUTES_PER_DAY` — extend, do not replace)
- Modify: `src/renderer/src/lib/serviceClock.test.ts` (append; keep Task 1's five `parseStart` tests)

**Interfaces:**
- Consumes: `parseStart`, `DEFAULT_START_MINUTES`, `MINUTES_PER_DAY` from Task 1.
- Produces: `computeSchedule(items: SetlistItem[], startTime?: string): Schedule` where `Schedule = { at: string[]; totalMinutes: number; endsAt: string }`.
- Consumed by: Task 16.

- [ ] **Step 1: Append the failing tests**

Keep the existing `describe('parseStart', …)` block and add below it:

```ts
import type { SetlistItem } from '@shared/types'
import { computeSchedule } from './serviceClock'

const video = (id: string, durationMinutes?: number): SetlistItem => ({
  kind: 'video',
  id,
  videoPath: `/tmp/${id}.mp4`,
  durationMinutes
})
const divider = (id: string, durationMinutes?: number): SetlistItem => ({
  kind: 'section-divider',
  id,
  label: 'Worship',
  durationMinutes
})

describe('computeSchedule', () => {
  it('returns an empty schedule for no items', () => {
    const s = computeSchedule([], '10:00')
    expect(s.at).toEqual([])
    expect(s.totalMinutes).toBe(0)
    expect(s.endsAt).toBe('10:00 AM')
  })

  it('starts the first item at the service start time', () => {
    const s = computeSchedule([video('a', 5)], '10:00')
    expect(s.at[0]).toBe('10:00')
  })

  it('accumulates durations across items', () => {
    const s = computeSchedule([video('a', 5), video('b', 10), video('c', 3)], '10:00')
    expect(s.at).toEqual(['10:00', '10:05', '10:15'])
    expect(s.totalMinutes).toBe(18)
    expect(s.endsAt).toBe('10:18 AM')
  })

  it('treats an absent duration as zero', () => {
    const s = computeSchedule([video('a'), video('b', 10)], '10:00')
    expect(s.at).toEqual(['10:00', '10:00'])
    expect(s.totalMinutes).toBe(10)
  })

  // Dividers are grouping only — they never reach the projector, so they
  // cannot consume service time even if a duration was somehow stored.
  it('ignores a duration stored on a section divider', () => {
    const s = computeSchedule([divider('d', 99), video('a', 5)], '10:00')
    expect(s.at).toEqual(['10:00', '10:00'])
    expect(s.totalMinutes).toBe(5)
  })

  it('defaults the start time to 10:00 when absent', () => {
    const s = computeSchedule([video('a', 30)])
    expect(s.at[0]).toBe('10:00')
    expect(s.endsAt).toBe('10:30 AM')
  })

  it('crosses noon with the correct meridiem', () => {
    const s = computeSchedule([video('a', 90)], '11:00')
    expect(s.endsAt).toBe('12:30 PM')
  })

  it('renders midnight as 12:00 AM, not 0:00', () => {
    const s = computeSchedule([video('a', 60)], '23:00')
    expect(s.endsAt).toBe('12:00 AM')
  })

  it('wraps past midnight without going negative', () => {
    const s = computeSchedule([video('a', 120)], '23:00')
    expect(s.endsAt).toBe('1:00 AM')
  })

  it('pads minutes to two digits', () => {
    const s = computeSchedule([video('a', 5)], '9:05')
    expect(s.at[0]).toBe('9:05')
    expect(s.endsAt).toBe('9:10 AM')
  })

  it('falls back to the default start on a malformed start time', () => {
    const s = computeSchedule([video('a', 10)], 'not-a-time')
    expect(s.at[0]).toBe('10:00')
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm test src/renderer/src/lib/serviceClock.test.ts`
Expected: FAIL — `computeSchedule is not exported`. The five `parseStart`
tests from Task 1 still pass; only the new block fails.

- [ ] **Step 3: Extend `serviceClock.ts`**

Task 1 already created this file with `parseStart`, `DEFAULT_START_MINUTES`,
and `MINUTES_PER_DAY`. **Keep them** and add the following below.

```ts
import type { SetlistItem } from '@shared/types'

export interface Schedule {
  /** Wall-clock start per item, "H:MM", parallel to the input array. */
  at: string[]
  totalMinutes: number
  /** Projected end, "H:MM AM/PM". */
  endsAt: string
}

/** Minutes since midnight → "H:MM", 12-hour, no meridiem. */
function formatClock(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h24 = Math.floor(wrapped / 60)
  const mm = wrapped % 60
  // 0 renders as 12 (midnight), 13 as 1, and 12 stays 12 (noon).
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mm).padStart(2, '0')}`
}

/** Minutes since midnight → "H:MM AM/PM". */
function formatClockMeridiem(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const meridiem = Math.floor(wrapped / 60) < 12 ? 'AM' : 'PM'
  return `${formatClock(wrapped)} ${meridiem}`
}

/**
 * Section dividers never reach the projector, so they cannot consume
 * service time — even if a duration somehow got stored on one.
 */
function durationOf(item: SetlistItem): number {
  if (item.kind === 'section-divider') return 0
  const d = item.durationMinutes
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) return 0
  return Math.floor(d)
}

export function computeSchedule(
  items: SetlistItem[],
  startTime?: string
): Schedule {
  const start = parseStart(startTime)
  const at: string[] = []
  let running = start

  for (const item of items) {
    // Record the time this item BEGINS, then advance past it.
    at.push(formatClock(running))
    running += durationOf(item)
  }

  return {
    at,
    totalMinutes: running - start,
    endsAt: formatClockMeridiem(running)
  }
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm test src/renderer/src/lib/serviceClock.test.ts`
Expected: PASS, 16 tests — Task 1's five `parseStart` cases plus the eleven
`computeSchedule` cases.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/serviceClock.ts src/renderer/src/lib/serviceClock.test.ts
git commit -m "feat(setlist): service clock — per-item times, total, ends-at"
```

---

### Task 15: Media-missing detection hook [VISUAL]

**Files:**
- Create: `src/renderer/src/hooks/useMediaCheck.ts`

**Interfaces:**
- Consumes: `window.api.files.checkExists` (Task 7); `mediaPathOf` from `@shared/setlist-media` (created in Task 7).
- Produces: `useMediaCheck(items: SetlistItem[]): { missing: Set<string>; recheck: () => void; checking: boolean }` — `missing` is keyed by **item id**, not by path, so the caller can flag a row without re-deriving its path.

- [ ] **Step 1: Implement the hook**

```ts
/**
 * useMediaCheck — which setlist items point at a file that no longer exists.
 *
 * Returns item IDs rather than paths so SetlistItemCard can ask
 * `missing.has(item.id)` directly. Two items pointing at the same moved
 * file both get flagged, which a path-keyed set would make awkward.
 *
 * Debounced because the setlist editor re-renders on every keystroke and
 * an un-debounced effect would fire an IPC round trip per character.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SetlistItem } from '@shared/types'
import { mediaPathOf } from '@shared/setlist-media'

const DEBOUNCE_MS = 300

export function useMediaCheck(items: SetlistItem[]): {
  missing: Set<string>
  recheck: () => void
  checking: boolean
} {
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(false)
  const [nonce, setNonce] = useState(0)

  // Pairs are re-derived on every render but the JOINED KEY below is what
  // actually gates the effect, so a re-render that does not change any
  // media path costs nothing.
  const pairs = useMemo(
    () =>
      items
        .map((item) => ({ id: item.id, path: mediaPathOf(item) }))
        .filter((p): p is { id: string; path: string } => p.path !== null),
    [items]
  )
  const key = pairs.map((p) => `${p.id} ${p.path}`).join('')

  const latest = useRef(0)

  useEffect(() => {
    if (pairs.length === 0) {
      setMissing(new Set())
      return
    }

    const timer = setTimeout(() => {
      const run = ++latest.current
      setChecking(true)
      void window.api.files
        .checkExists(pairs.map((p) => p.path))
        .then((result) => {
          // Drop a stale response — the user may have edited again while
          // this batch was in flight.
          if (run !== latest.current) return
          const next = new Set<string>()
          for (const p of pairs) {
            if (result[p.path] === false) next.add(p.id)
          }
          setMissing(next)
        })
        .finally(() => {
          if (run === latest.current) setChecking(false)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // `key` is the real dependency; `pairs` is derived from the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  const recheck = useCallback(() => setNonce((n) => n + 1), [])

  return { missing, recheck, checking }
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useMediaCheck.ts
git commit -m "feat(setlist): useMediaCheck hook for MEDIA MISSING detection

Keyed by item id so a row can be flagged without re-deriving its path,
debounced so editor keystrokes do not spam IPC, and stale responses are
dropped so a slow batch cannot overwrite a newer result."
```

---

### Task 16: Convert Setlist Editor [VISUAL]

**Files:**
- Modify: `src/renderer/src/pages/SetlistEditor.tsx`
- Modify: `src/renderer/src/components/SetlistItemCard.tsx`
- Modify: `src/renderer/src/components/AddItemPicker.tsx`

Reference: design L358–521.

- [ ] **Step 1: Top bar and meta strip**

Top bar (L361–370): `← HOME`, saved pill, `START SERVICE →` (signal), `DELETE` (danger).

Meta strip (L372–392), `grid grid-cols-[1fr_240px] border-b border-border bg-card`:
- Left: `NAME` MonoLabel + name input; below it a mono line
  `{DATE} · {N} ITEMS`, then `≈ {totalMinutes} MIN · ENDS {endsAt}` in signal,
  then a `{N} MEDIA MISSING` signal Badge when `missing.size > 0`.
- Right: `DATE` input and a new `SERVICE STARTS` `<input type="time">` bound to
  `setlist.startTime`, both with `color-scheme: dark` so the native pickers
  render dark.

- [ ] **Step 2: Run-of-show header**

`RUN OF SHOW · N ITEMS` MonoLabel, the hint
`Drag to reorder · click any gap to insert`, a `<Segmented>` for DETAIL/COMPACT,
and `+ ADD ITEM`.

- [ ] **Step 3: Item rows in `SetlistItemCard.tsx`**

Left rail: the computed `at` time above the drag handle. Then a 104×60
thumbnail in detail mode. Then the kind Badge.

Detail mode: source-file line, full-width title input, `Loop continuously`
checkbox for video items, and the media-missing banner when
`missing.has(item.id)`.

Compact mode: title and slide count on one line, `py-2.5` instead of `p-3.5`.

Right rail: a duration `<input>` (numeric, minutes) writing
`durationMinutes`, a `MIN` MonoLabel, and `DUPLICATE` / `DELETE` ghost buttons.

Media-missing banner (L471–477): `border border-signal/50 bg-signal/[0.08]`,
a `MEDIA MISSING` MonoLabel, the sentence
`The file moved since you added it. This item will be skipped in service.`,
and a `RELINK` button that calls
`window.api.dialog.pickFile(relinkKindOf(item)!)` — using `relinkKindOf` from
`@shared/setlist-media` (Task 7) rather than re-deriving the mapping — and
writes the returned path back onto the item's `imagePath` / `videoPath` /
`pdfPath`. For a deck, also re-probe the page count, since the replacement PDF
may have a different length; reuse whatever `AddItemPicker` already calls to
get `pageCount` at add time.

**Keep the existing `@dnd-kit` sortable wiring untouched.** Only the visual
shell changes.

- [ ] **Step 4: Gap insert**

Render `<GapInsert>` above every item and after the last. Clicking toggles an
inline picker at that index: a `Panel emphasis` with a header
`INSERT AT POSITION {n}` (or `ADD TO THE END`) plus a close `✕`, and a
`<HairlineGrid cols={4}>` of the seven kinds — SNG, SCR, IMG, VID, PDF, CDN,
SEC — each cell a button with a signal code Badge, the name at
`text-[13px] font-bold`, and the hint at `text-[11px] text-muted-foreground`.
Kind metadata and creation logic come from the existing `AddItemPicker`; reuse
its item-construction functions and replace only its trigger/presentation.

- [ ] **Step 5: Footer**

`{N} ITEMS · {totalMinutes} MIN · ENDS {endsAt}` MonoLabel and the note
`Section dividers are grouping only — they never reach the projector.`

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.
Run: `pnpm dev`, open a setlist. Acceptance:
1. Setting SERVICE STARTS to 09:30 shifts every item's clock time.
2. Typing a duration updates that item's time, all later times, the total, and ends-at.
3. A section divider with a duration still contributes 0.
4. Renaming a media file on disk and reopening the setlist shows MEDIA MISSING on that row and the count chip in the meta strip.
5. RELINK opens the native picker filtered to the right file type and clears the banner.
6. Clicking any gap opens the picker at that position and inserting lands the item there.
7. DETAIL/COMPACT changes row density without losing data.
8. Drag-to-reorder still works.
9. Reload: durations and start time persist.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/pages/SetlistEditor.tsx src/renderer/src/components/SetlistItemCard.tsx src/renderer/src/components/AddItemPicker.tsx
git commit -m "feat(setlist): KLB conversion + service timing, relink, gap insert"
```

**PHASE D CHECKPOINT.**

---

# PHASE E — Service Mode

### Task 17: `serviceNext` [TDD]

**Files:**
- Create: `src/renderer/src/lib/serviceNext.ts`
- Create: `src/renderer/src/lib/serviceNext.test.ts`

**Interfaces:**
- Produces: `resolveNext(items: RenderableItem[], itemIndex: number, slideIndex: number): NextResolution` where

```ts
export type NextResolution =
  | { kind: 'same-item'; slide: SlidePayload; itemLabel: string; itemIndex: number; slideIndex: number }
  | { kind: 'new-item'; slide: SlidePayload; itemLabel: string; fromItemLabel: string; itemIndex: number; slideIndex: number }
  | { kind: 'end' }
```

- Consumed by: Task 19.

- [ ] **Step 1: Write the failing test**

The critical case is the cross-check against the store: if these two ever
disagree, the NEXT panel lies to the operator mid-service about what SPACE does.

```ts
import { describe, expect, it } from 'vitest'
import type { RenderableItem } from './slideify'
import { resolveNext } from './serviceNext'

const text = (s: string) => ({ kind: 'text' as const, lines: [s], sectionLabel: s })

const items: RenderableItem[] = [
  { id: 'a', kind: 'video', label: 'Welcome', slides: [text('w1')] },
  { id: 'b', kind: 'song', label: 'Holy Forever', slides: [text('v1'), text('v2'), text('c1')] },
  { id: 'c', kind: 'deck', label: 'Sermon', slides: [text('p1'), text('p2')] }
]

describe('resolveNext', () => {
  it('stays inside the item when more slides remain', () => {
    const r = resolveNext(items, 1, 0)
    expect(r.kind).toBe('same-item')
    if (r.kind === 'same-item') {
      expect(r.itemLabel).toBe('Holy Forever')
      expect(r.slideIndex).toBe(1)
    }
  })

  it('crosses into the next item on the last slide', () => {
    const r = resolveNext(items, 1, 2)
    expect(r.kind).toBe('new-item')
    if (r.kind === 'new-item') {
      expect(r.fromItemLabel).toBe('Holy Forever')
      expect(r.itemLabel).toBe('Sermon')
      expect(r.itemIndex).toBe(2)
      expect(r.slideIndex).toBe(0)
    }
  })

  it('crosses out of a single-slide item', () => {
    const r = resolveNext(items, 0, 0)
    expect(r.kind).toBe('new-item')
    if (r.kind === 'new-item') expect(r.itemLabel).toBe('Holy Forever')
  })

  it('reports the end on the last slide of the last item', () => {
    expect(resolveNext(items, 2, 1).kind).toBe('end')
  })

  it('reports the end for an empty item list', () => {
    expect(resolveNext([], 0, 0).kind).toBe('end')
  })

  it('reports the end for an out-of-range index', () => {
    expect(resolveNext(items, 99, 0).kind).toBe('end')
  })
})

// The panel and the state machine must never disagree about what SPACE
// does. This walks every reachable position and asserts they match.
describe('resolveNext agrees with the store traversal', () => {
  /** Mirrors useServiceStore.nextSlide's traversal. */
  function storeNext(
    its: RenderableItem[],
    i: number,
    s: number
  ): { i: number; s: number } | 'end' {
    const item = its[i]
    if (!item) return 'end'
    if (s + 1 < item.slides.length) return { i, s: s + 1 }
    if (i + 1 < its.length) return { i: i + 1, s: 0 }
    return 'end'
  }

  it('matches at every position', () => {
    for (let i = 0; i < items.length; i++) {
      for (let s = 0; s < items[i].slides.length; s++) {
        const store = storeNext(items, i, s)
        const panel = resolveNext(items, i, s)
        if (store === 'end') {
          expect(panel.kind).toBe('end')
        } else {
          expect(panel.kind).not.toBe('end')
          if (panel.kind !== 'end') {
            expect({ i: panel.itemIndex, s: panel.slideIndex }).toEqual(store)
          }
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm test src/renderer/src/lib/serviceNext.test.ts`
Expected: FAIL — cannot resolve `./serviceNext`.

- [ ] **Step 3: Implement `serviceNext.ts`**

```ts
/**
 * serviceNext — what pressing SPACE will actually do.
 *
 * The traversal here MIRRORS useServiceStore.nextSlide exactly. If the two
 * ever diverge, the NEXT panel starts lying to the operator mid-service
 * about where they are about to land — which is the worst possible failure
 * for this feature. serviceNext.test.ts pins them together by walking every
 * reachable position and asserting they agree.
 *
 * Kept separate from the store rather than derived from it because the
 * panel needs to know about the transition WITHOUT performing it.
 */

import type { SlidePayload } from '@shared/ipc-contract'
import type { RenderableItem } from './slideify'

export type NextResolution =
  | {
      kind: 'same-item'
      slide: SlidePayload
      itemLabel: string
      itemIndex: number
      slideIndex: number
    }
  | {
      kind: 'new-item'
      slide: SlidePayload
      itemLabel: string
      /** The item being left — used for "Leaves X and starts Y." */
      fromItemLabel: string
      itemIndex: number
      slideIndex: number
    }
  | { kind: 'end' }

export function resolveNext(
  items: RenderableItem[],
  itemIndex: number,
  slideIndex: number
): NextResolution {
  const item = items[itemIndex]
  if (!item) return { kind: 'end' }

  // Advance within the current item.
  if (slideIndex + 1 < item.slides.length) {
    return {
      kind: 'same-item',
      slide: item.slides[slideIndex + 1],
      itemLabel: item.label,
      itemIndex,
      slideIndex: slideIndex + 1
    }
  }

  // Roll into the next item at its first slide.
  const next = items[itemIndex + 1]
  if (next && next.slides.length > 0) {
    return {
      kind: 'new-item',
      slide: next.slides[0],
      itemLabel: next.label,
      fromItemLabel: item.label,
      itemIndex: itemIndex + 1,
      slideIndex: 0
    }
  }

  return { kind: 'end' }
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm test src/renderer/src/lib/serviceNext.test.ts`
Expected: PASS, 7 tests including the cross-check.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/serviceNext.ts src/renderer/src/lib/serviceNext.test.ts
git commit -m "feat(service): resolveNext — what SPACE will actually do

Cross-checked against the store's own traversal at every position, so
the NEXT panel can never disagree with what the key press does."
```

---

### Task 18: `VideoTimeUpdate.duration` [VISUAL]

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/renderer/src/components/SlideRenderer.tsx`

- [ ] **Step 1: Add the field**

```ts
export interface VideoTimeUpdate {
  videoPath: string
  currentTime: number
  /**
   * Total length in seconds. Required by the operator's runway readout
   * ("advances in 0:32"), which cannot be derived from currentTime.
   * NaN until the output window's <video> has loaded metadata; consumers
   * must guard with Number.isFinite.
   */
  duration: number
  paused: boolean
}
```

- [ ] **Step 2: Populate it at the emit site**

Find every `setVideoTimeUpdate({ ... })` call in `SlideRenderer.tsx` and add
`duration: el.duration`. Typecheck will point at each one.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.
Run: `pnpm dev`, start a service with a video item, and in devtools confirm the
broadcast carries a finite `duration` once playback begins.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-contract.ts src/renderer/src/components/SlideRenderer.tsx
git commit -m "feat(service): carry video duration in VideoTimeUpdate"
```

---

### Task 19: `ServiceNextPanel` and `VideoRunway` [VISUAL]

**Files:**
- Create: `src/renderer/src/components/ServiceNextPanel.tsx`
- Create: `src/renderer/src/components/VideoRunway.tsx`

**Interfaces:**
- Consumes: `resolveNext` (Task 17), `VideoTimeUpdate.duration` (Task 18).
- Produces: `<ServiceNextPanel items itemIndex slideIndex />`, `<VideoRunway update loop paused muted onTogglePause onToggleMute />`.

- [ ] **Step 1: Build `ServiceNextPanel.tsx`**

This is the feature the design computes (L1044–1048) but never rendered — its
markup was trimmed from the design file. Build it from that logic and the
design's own note (L1072).

Layout: a `Panel` with a header MonoLabel `NEXT` plus a tag Badge, then the
next slide's section label, a text preview, and a hint line.

| Resolution | Tag | Tag tone | Hint |
|---|---|---|---|
| `same-item` | `SAME ITEM` | neutral (dim) | `Stays inside {itemLabel}.` |
| `new-item` | `NEW ITEM` | signal | `Leaves {fromItemLabel} and starts {itemLabel}.` |
| `end` | `END OF SERVICE` | signal | `Blacks out the projector and ends the service.` |

For `end`, the label reads `SERVICE ENDS` and the preview is `—`.

Preview text: for a `text` slide join `lines` with newline and render
`whitespace-pre-line`; for other kinds render the kind name
(`Image` / `Video` / `PDF page n` / `Countdown`).

- [ ] **Step 2: Build `VideoRunway.tsx`**

Per design L631–659. A `border border-border` box:
- Mode line: `LOOPING · WILL NOT ADVANCE` when `loop`, else
  `PLAYS ONCE · ADVANCES IN {mm:ss}` computed as `duration - currentTime`.
  Guard `Number.isFinite(duration)` — show `PLAYS ONCE` alone until metadata loads.
- A `{elapsed} / {total}` mono readout in `mm:ss`.
- A 3px `bg-border` track with a `bg-signal` fill at
  `width: {(currentTime / duration) * 100}%`, clamped to 0–100.
- Joined pause and mute buttons with inline SVGs (design L641/L644 for
  play/pause, L650/L653 for muted/audible) and `P` / `M` key-hint labels.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ServiceNextPanel.tsx src/renderer/src/components/VideoRunway.tsx
git commit -m "feat(service): NEXT panel and video runway

The design computes nextTag/nextLabel/nextText/nextHint and names
'NEXT + RUNWAY' as a headline feature, but the markup consuming those
props was trimmed from the file. Rebuilt from the logic and the note."
```

---

### Task 20: Convert Service Mode [VISUAL]

**Files:**
- Modify: `src/renderer/src/pages/ServiceMode.tsx`
- Modify: `src/renderer/src/components/SlideCard.tsx`
- Modify: `src/renderer/src/components/OutputMirror.tsx`
- Modify: `src/renderer/src/components/KeyCheatSheet.tsx`

Reference: design L523–697.

- [ ] **Step 1: Top bar** (L526–544)

Setlist name at `text-[14px] font-bold` over a mono
`ITEM n OF N · SLIDE n OF N` counter; the elapsed timer at
`font-mono text-[20px] font-semibold tabular-nums`; a `<Segmented>` for
LIVE/BLACK/LOGO; three 32px square `B` / `L` / `?` buttons; an `EXIT` button
bordered `signal-deep`.

- [ ] **Step 2: Left rail** (L547–558)

`ITEMS · N` MonoLabel header, a `Jump to…` filter input, then one button per
item: index, label, and a mono meta line (`SONG · 27`). Active item gets
`border-l-2 border-l-signal bg-ember`. Filtering matches labels
case-insensitively and **must not** alter indices — keep the original index
alongside each filtered entry so `jumpTo` still receives the true index.

**Retain the existing `usePanelWidth` resize behaviour.** The design's
`190px / 1fr / 400px` are initial widths only.

- [ ] **Step 3: Center grid** (L560–612)

Sticky toolbar at `top-0 z-[2]`: `ALL SLIDES · N`, the hint
`CLICK TO JUMP · SPACE TO ADVANCE`, and a `<Segmented>` for GROUPED/FLAT.

Define `export const GRID_TOOLBAR_H = 37` in `ServiceMode.tsx` and use it for
both the toolbar's height and the group headers' `top` offset, so the two
sticky layers cannot drift apart.

**Grouped** (default): one block per item. Sticky header at
`top: GRID_TOOLBAR_H, z-[1]` with `border-l-2` (signal when active), index,
label, meta, and an estimated runtime on the right. Then a
`grid grid-cols-3 gap-3 p-4` of that item's slide cards. `slideifySetlist`
already returns nested `RenderableItem[]`, so grouping needs no new derivation
— iterate `items`, and map each item's `slides` with a running global index so
`jumpTo` gets the right coordinates.

**Flat**: a single `grid grid-cols-3 gap-3 p-4` over every slide.

Persist the GROUPED/FLAT choice in component state only — it is a per-session
preference, not a setting.

- [ ] **Step 4: Slide cards in `SlideCard.tsx`**

Square, `border`, `bg-card`. Header bar: mono section label left, shortcut glyph
right, `border-b border-border`. Body: `aspect-[16/9] bg-black` with centred
`text-[11.5px] font-bold leading-[1.5]`. Active card: `border-signal`, header
`bg-signal text-white`, body text `text-white`. Inactive: header
`bg-panel-hi text-soft`, body text `text-quiet`.

- [ ] **Step 5: Right rail** (L614–669)

`ON SCREEN · {label}` header with `<StatusDot pulse="fast" />`. The 16:9 mirror
in `OutputMirror.tsx`, `border-border` normally and `border-signal` when cut.
When `displayMode !== 'live'`, overlay `bg-signal/[0.06]` with
`BLACKOUT` / `LOGO · STANDBY` at `font-mono text-[15px] tracking-[0.2em]` and
the line `The congregation sees nothing. Press again to resume.`

Below it: `<VideoRunway>` when the active slide is a video, then
`<ServiceNextPanel>`, then the notes pane — `NOTES · LIVE TO STAGE` header with
an `EPHEMERAL` MonoLabel and a `flex-1` textarea.

- [ ] **Step 6: Bottom strip and cheat sheet** (L672–695)

Lower-thirds strip: `LOWER THIRDS` MonoLabel, title and subtitle inputs, `HIDE`,
and the mono mode readout. Existing behaviour, restyled.

Cheat sheet overlay: `absolute inset-0 bg-background/[0.88] z-20`, a 520px
`Panel emphasis`, header `KEYBOARD` plus the line
`Kaya ba ni Ate Rose nang walang tatanungin?`, then rows of a 150px mono key
column against `text-[12.5px] text-soft` descriptions.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.
Run: `pnpm dev`, start a service. Acceptance:
1. GROUPED shows sticky item headers that pin under the toolbar with no overlap or gap while scrolling; FLAT shows one continuous grid.
2. Typing in `Jump to…` filters the rail; clicking a filtered item jumps to the correct item, not the wrong index.
3. The NEXT panel reads `SAME ITEM` mid-song and flips to `NEW ITEM` on the song's last slide, naming both items.
4. Pressing SPACE lands exactly where NEXT said it would, at every position.
5. On the final slide, NEXT reads `END OF SERVICE`.
6. On a video slide the runway shows a moving progress bar and either `LOOPING · WILL NOT ADVANCE` or a counting-down `ADVANCES IN m:ss`.
7. Pressing B produces an unmistakable BLACKOUT overlay, not a dead frame.
8. All existing keys still work: SPACE, ⇧SPACE, ↑, ↓, B, L, P, M, ESC.
9. Panel resize handles still work.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/ServiceMode.tsx src/renderer/src/components/SlideCard.tsx src/renderer/src/components/OutputMirror.tsx src/renderer/src/components/KeyCheatSheet.tsx
git commit -m "feat(service): KLB conversion + grouped grid, jump filter, NEXT, runway"
```

**PHASE E CHECKPOINT.**

---

# PHASE F — Settings

### Task 21: Convert Settings [VISUAL]

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`
- Modify: `src/renderer/src/components/ThemeFields.tsx`

Reference: design L699–747.

- [ ] **Step 1: Shell**

`<PageHeader back={{to:'/', label:'HOME'}} eyebrow="WORKSPACE" title="Settings"
description="Changes save instantly. The projector restyles on the next frame.">`
with a tab row as `children`: DISPLAY / THEME / OUTPUT / DATA / ABOUT, each a
button with `border-b-2` — signal when active, transparent otherwise — and a
mono uppercase label.

- [ ] **Step 2: Split body**

`grid grid-cols-[520px_1fr] flex-1 min-h-0`.

Left, `overflow-y-auto scroll-hairline border-r border-border bg-card p-6`: the
tab title at `text-[20px] font-extrabold tracking-[-0.02em]`, the tab
description at `text-[12.5px] text-muted-foreground`, then bordered groups. Each
group is a `Panel` with a mono head; each row is
`flex items-center gap-4 border-b border-rule px-4 py-3.5` with name +
description on the left and the control on the right.

**The design's rows are read-only value chips — it mocks the shell, not the
controls.** Keep every working control in the current `Settings.tsx` and place
it in the row's right slot. Do not replace controls with chips.

Right, sticky: `LIVE PREVIEW` MonoLabel and
`REFLECTS EVERY CHANGE INSTANTLY`, then a 16:9 `border border-border bg-black`
preview rendering John 3:16 with the current global theme, then a caption row
of `JOHN 3:16 (NIV) · FIRST 2 OF 4` and
`NO SAVE BUTTON — CLOSE WHEN IT LOOKS RIGHT`.

- [ ] **Step 3: Restyle `ThemeFields.tsx`**

Apply the same row layout and KLB controls. Its props and `onChange` patch
contract are unchanged — only presentation moves.

- [ ] **Step 4: Remove the deprecated aliases**

Delete `export const Card = Panel` from `ui/Card.tsx` and the `secondary`
variant from `ui/Button.tsx`. Run `pnpm typecheck` and fix every resulting
error by switching the call site to `Panel` / `outline`. There must be zero
remaining references.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm test` → PASS.
Run: `pnpm build` → succeeds.
Run: `pnpm dev`. Acceptance:
1. All five tabs render and switch.
2. Every control still works: changing the theme font updates the live preview and the projector.
3. Backup create / restore / open-folder still work.
4. Check-for-updates still works.
5. `grep -rn "rounded-\(sm\|md\|lg\|xl\|2xl\)\|shadow-\|backdrop-blur\|bg-gradient" src/renderer/src` returns nothing outside `SlideRenderer.tsx` and the output views.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Settings.tsx src/renderer/src/components/ThemeFields.tsx src/renderer/src/components/ui/Card.tsx src/renderer/src/components/ui/Button.tsx
git commit -m "feat(settings): KLB conversion; drop deprecated Card and secondary aliases"
```

**PHASE F CHECKPOINT — redesign complete.**

---

## Final verification

- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Every screen matches its design section structurally
- [ ] Pre-flight, service timing, grouped grid, and NEXT all work end to end
- [ ] A backup zip created before Task 13 still restores cleanly
- [ ] No `rounded-*` (except `rounded-full` on dots), no shadows, no blurs, no gradients in operator chrome
- [ ] No hex colour literals in any `.tsx` outside `SlideRenderer.tsx` and the output views
