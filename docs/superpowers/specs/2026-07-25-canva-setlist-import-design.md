# Canva → setlist import (design)

Date: 2026-07-25
Status: approved for planning
Scope: the Electron app in full; the OAuth proxy as a pinned HTTP contract

## Problem

Churches author their announcement slides, sermon titles, and verse graphics in
Canva. Today getting them into Present is a manual round trip: open Canva,
export to PDF, find the download, then pick the file through Present's native
dialog and add a `deck` item.

Every step is a place to fail on a Sunday morning, and the worst failure is
silent: the operator imports on Thursday, someone edits the Canva design on
Saturday night, and Present shows last week's dates with no indication anything
is stale.

We want: connect the Canva account once, then pull a design into the setlist
directly — and be told when a pulled design has changed.

## Non-goals

- Editing Canva designs from Present. Canva is the authoring tool; Present presents.
- Using Canva as a source for theme backgrounds, logos, or the standby image.
  Setlist decks only for v1.
- Canva as a source for `image` or `video` items. Every import becomes a `deck`.
- Multi-account support. One connected Canva account per Present install.
- Server-side storage of user designs or tokens. The proxy is stateless.
- Auto-refreshing content without operator action. Explicitly rejected — slide
  content must never change unasked minutes before a service.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where `client_secret` lives | Backend proxy at prochurchcenter.com | Canva's token endpoint requires `Basic base64(client_id:client_secret)`; PKCE does not exempt it. A secret in a downloadable bundle is extractable, likely breaches Canva's integration terms, and one revocation breaks every install at once. |
| What an import becomes | A `deck` item (PDF) | The `deck` kind already renders external-tool slides via pdf.js. A 1-page design is a 1-page deck. Zero new rendering code. |
| Redirect delivery | Loopback listener on `127.0.0.1` | RFC 8252's recommendation for native apps. Invisible, no OS registration, identical on all three platforms. Custom protocols (`present://`) are unreliable on Linux/AppImage, which we ship. |
| Staleness | Store design id, background check, badge + manual refresh | Catches the Saturday-night edit without ever changing content behind the operator's back. Fails silently offline. |
| Browse UX | Recently-modified thumbnail grid + server-side search | The design edited last night is nearly always the one wanted, so the default view is usually a zero-typing hit. |
| Token storage | Electron `safeStorage` | A refresh token is a standing grant to a whole Canva account — categorically different from a theme or setlist, so it does not use the plain-JSON pattern in `src/main/storage/`. |
| Backend state | Stateless, stores nothing | Holds exactly one secret and proxies two exchanges. Tokens live only on the operator's machine. Nothing to breach; consistent with the app's local-data posture. |

## Verified Canva API facts

Confirmed against canva.dev, 2026-07-25:

- OAuth 2.0 authorization code + **mandatory PKCE (S256)**, and the token
  endpoint **additionally** requires client secret via basic auth.
- `GET /v1/designs` returns per design: `id`, `title`, `owner`, `urls`,
  `thumbnail` (`{width,height,url}`), `created_at`, `updated_at`, `page_count`
  (optional for some design types). Query params: `query` (≤255 chars),
  `continuation`, `ownership` (`any|owned|shared`), `sort_by`
  (`relevance|modified_descending|modified_ascending|title_descending|title_ascending`).
- Timestamps are **Unix seconds**, not ISO 8601.
- Exports are **asynchronous**: `POST /v1/exports` returns `{id, status}` with
  status `in_progress` → `success | failed`; poll the get-export-job endpoint;
  on success it returns `urls[]`.
- Export download URLs **expire after 24 hours**.
- PDF export accepts `export_quality` (`regular|pro`) and `size`
  (`a4|a3|letter|legal`), plus an optional `pages` array.
- Export endpoint is rate limited to **20 requests/min per user**, with further
  throttling over 5-minute and 24-hour windows.
- Scopes: `design:meta:read` (browse/metadata), `design:content:read` (export),
  `profile:read` (display the connected account name).

### Two traps these facts imply

**`size` must never be sent.** It reflows a 16:9 presentation into paper
proportions, corrupting every slide while the API reports complete success.
This gets a pinning regression test, not a comment.

**`export_quality` stays `regular`.** `pro` targets premium content and can
fail outright on free Canva accounts.

## Backend contract

Four routes. Stateless: no database, no user records, no token persistence, and
tokens are never logged. Not called from a browser, so no CORS needed.

### `GET /canva/start`

Query: `challenge` (base64url S256 code_challenge), `state` (opaque,
app-generated, ≥32 bytes entropy, base64url), `port` (integer 1024–65535).

Validates params, builds an HMAC-signed state token containing
`{ appState, port, iat }`, then `302` to Canva's authorize endpoint with
`client_id`, the backend's own registered `redirect_uri`, `scope`,
`response_type=code`, `code_challenge`, `code_challenge_method=S256`, and
`state=<signed>`.

`400` on malformed params.

### `GET /canva/callback`

Query: `code` + `state`, or `error`.

Verifies the signed state's signature and freshness (10-minute window),
extracts `port` and `appState`, then `302` to
`http://127.0.0.1:{port}/callback?code={code}&state={appState}`. A Canva error
redirects with `?error=...` instead.

`400` on invalid or expired state.

### `POST /canva/token`

Body: `{ code, code_verifier }`.

Exchanges with Canva using `Basic base64(client_id:client_secret)`,
`grant_type=authorization_code`, and the same `redirect_uri` used at authorize.

`200` → `{ access_token, refresh_token, expires_in, token_type }`, passed
straight through and never stored. `400` on `invalid_grant` (code reused or
expired). `502` on upstream failure.

### `POST /canva/refresh`

Body: `{ refresh_token }`. Same basic auth, `grant_type=refresh_token`.

`200` → `{ access_token, refresh_token, expires_in }`. **Canva rotates refresh
tokens, so the app must persist the returned one.** `400` on `invalid_grant`,
which the app treats as "disconnected, ask the user to reconnect".

### Why PKCE is split across the two parties

The app generates and retains `code_verifier`, sending only `code_challenge`
through `/canva/start` and only revealing the verifier at `/canva/token`. So the
backend alone cannot complete a flow, and an attacker who intercepts a redirect
code cannot either. The secret and the verifier never sit in the same place.

## Data model

One optional key on the existing `deck` variant in `src/shared/types.ts`:

```ts
| {
    kind: 'deck'
    id: string
    pdfPath: string
    pageCount: number
    title?: string
    /**
     * Present only when this deck was pulled from a connected Canva
     * account. Its presence is the sole trigger for the refresh
     * affordance — a hand-picked PDF deck has no `canva` key at all.
     */
    canva?: CanvaOrigin
  }

/** Provenance for a deck imported from Canva. */
export interface CanvaOrigin {
  designId: string
  /** Canva's `updated_at` as of import. ISO 8601 (Canva sends Unix seconds). */
  designUpdatedAt: string
  importedAt: string
}
```

Three fields, each load-bearing: `designId` to re-export, `designUpdatedAt` to
compare against, `importedAt` to show the operator. No thumbnail URL — those
expire. No title duplication — `deck.title` already exists.

Grouped under one optional object rather than three flat optional fields so
`canva` is either wholly present or wholly absent. There is no representable
half-state holding a design id with nothing to compare it to.

The decisive property: `slideify`, `ServiceMode`, `SlideRenderer`, and the
backup layer all stay untouched. A Canva deck *is* a deck. Only the editor and
the item card know the difference.

`pageCount` is derived from the downloaded PDF via the existing
`probePdfPageCount` helper, exactly as the manual deck flow does. Canva's
`page_count` is ignored entirely, which removes its "optional for some design
types" fallback branch.

## File layout

| Path | Role |
|---|---|
| `src/shared/canva.ts` | Pure logic: PKCE derivation, Unix→ISO conversion, staleness comparison, export-request building |
| `src/shared/canva.test.ts` | Unit tests for the above |
| `src/main/canva/auth.ts` | Loopback listener, browser launch, token refresh |
| `src/main/canva/api.ts` | `net.fetch` wrappers: list designs, get design, export job + poll |
| `src/main/canva/import.ts` | Download PDF into `userData/media/canva/`, atomic write |
| `src/main/storage/canvaTokens.ts` | `safeStorage`-encrypted token persistence |
| `src/main/ipc/canva.ts` | IPC handlers, following the `registerXHandlers()` convention |
| `src/renderer/src/components/CanvaPicker.tsx` | Third view inside `AddItemPicker` |
| `src/renderer/src/components/CanvaConnectionCard.tsx` | Settings → Connections panel body |
| `src/renderer/src/stores/useCanvaStore.ts` | Connection state, design list, import progress |

Pure logic lives in `src/shared/` because that is where this codebase's test
convention already is (`parser.test.ts`, `bibleReference.test.ts`), keeping
`src/main/canva/*` thin enough to be IO-only. All outbound calls use `net.fetch`
from the main process, matching `bibleApi.ts`; the renderer never talks to Canva.

Existing files modified:

| Path | Change |
|---|---|
| `src/shared/types.ts` | `CanvaOrigin` interface; optional `canva` on the `deck` variant |
| `src/shared/ipc-contract.ts` | `canva` channel group and its typed surface |
| `src/preload/index.ts` + `index.d.ts` | Expose the `canva` API |
| `src/main/ipc/index.ts` | Register the Canva handlers |
| `src/main/storage/paths.ts` | `getCanvaMediaDir()`; include it in `ensureDirectories()` |
| `src/main/storage/atomic.ts` | Add `atomicWriteFile(path, buffer)` for binary writes |
| `src/renderer/src/pages/Settings.tsx` | `'connections'` section entry |
| `src/renderer/src/components/AddItemPicker.tsx` | Canva card and `'canva'` view |
| `src/renderer/src/components/ItemKindIcon.tsx` | Accept `'canva'`; add the glyph |
| `src/renderer/src/components/SetlistItemCard.tsx` | Provenance badge, stale badge, Refresh |

## Flows

### Connect

```
App                          Backend (holds secret)           Canva
 │ generate verifier+challenge, random state
 │ start loopback on 127.0.0.1:PORT
 │──── open system browser ────▶ /canva/start
 │                               (signs state incl. PORT)
 │                                      ──── authorize ────▶
 │                                                    user consents
 │                                      ◀─── code ──────────
 │                               verify signed state
 │◀── 302 to 127.0.0.1:PORT/callback?code
 │
 │──── POST /canva/token { code, code_verifier } ───▶
 │                               Basic(id:secret) + verifier ─▶
 │                                      ◀─ access + refresh ─
 │◀──── { access_token, refresh_token, expires_in }
 │ store via safeStorage; shut down loopback
```

The loopback listener binds an ephemeral port, accepts exactly one request, and
shuts down immediately afterward — including on timeout or user abandonment, so
no listener outlives the flow.

### Import

```
renderer                     main                          Canva
 pick design ──▶ canva.import(designId)
                  │ POST /v1/exports {design_id, format:{type:'pdf'}}   ← no `size`
                  │ ◀── job id, status: in_progress
                  │ poll get-export-job (backoff, emits progress events)
                  │ ◀── status: success, urls[]
                  │ download urls[0] immediately (24h expiry)
                  │ atomic write userData/media/canva/<designId>-<ts>.pdf
 ◀── { pdfPath, title, designUpdatedAt }
 probePdfPageCount(pdfPath)          ← existing helper, unchanged
 insertItem({ kind:'deck', pdfPath, pageCount, title, canva:{…} })
```

Main emits `exporting` → `downloading` progress events rather than leaving the
renderer on one opaque promise, because export jobs take real seconds.

The PDF is written tmp-then-rename so a crash mid-download never leaves a
truncated file for pdf.js to choke on. This needs a **new binary sibling** in
`src/main/storage/atomic.ts`: the existing `atomicWriteJson` `JSON.stringify`s
and writes utf8, so it cannot take a PDF buffer. Add
`atomicWriteFile(path, buffer)` using the same tmp + rename pattern, and keep
both on the same filesystem as `userData` so the rename stays atomic.

### Refresh

Identical pipeline, then swap `pdfPath`, re-probe `pageCount`, update
`designUpdatedAt`, and delete the superseded PDF so repeated refreshes do not
accumulate files.

`SetlistItemCard` already has a replace-the-PDF flow that re-probes page count
after picking a new file (`SetlistItemCard.tsx:285`). Refresh mirrors that
existing shape rather than introducing a second way to mutate a deck in place.

### Staleness check

On setlist open, for each deck carrying `canva`: `GET /v1/designs/{id}`, compare
`updated_at` against `designUpdatedAt`, badge the stale ones.

Requests run **strictly sequentially, one at a time, with a short delay between
them**, and the whole pass is skipped if no token is present. Sequential rather
than a tuned concurrency figure because the documented 20/min limit we have in
hand is the *export* limit; we have not confirmed the metadata endpoint's limit,
and a typical setlist holds a handful of decks, so serial costs nothing worth
optimizing against an unknown ceiling.

The pass never blocks opening or editing a setlist, and is silent on every
failure — for this app offline is a normal condition, not an error worth a
dialog.

### Orphan sweep

Deleting a Canva deck item leaves its PDF behind. At startup, diff the files in
`media/canva/` against paths referenced by all setlists and remove the
unreferenced ones. Refresh-time deletion covers the main growth vector; this
covers the rest.

## Storage and backup

Downloaded PDFs live at `userData/media/canva/<designId>-<timestamp>.pdf`.

`addDirToZip` in `src/main/storage/backup.ts` already recurses into
subdirectories, and restore already handles nested paths, so Canva PDFs are
included in church backups with **no changes to the backup layer**.

## UI surfaces

**Settings → new `'connections'` section.** One `Section` union member, one
`SECTIONS` entry, one panel — the existing pattern. The panel body lives in
`CanvaConnectionCard.tsx` rather than inline, because `Settings.tsx` is already
933 lines. Shows the connected account, connected-since, Disconnect, and a
plain-language note on what Present can see: browse designs and export them,
nothing else.

**`AddItemPicker` gains an 8th card**, "Canva" / *"From your Canva account"*.
The 3-column grid becomes 3/3/2. Clicking sets `view: 'canva'`, extending the
existing `'grid' | 'song'` two-step.

**`ItemKindIcon` widens to `SetlistItem['kind'] | 'canva'`.** This is a
deliberate, commented compromise: that file's contract is "every kind of setlist
*item*" and Canva is a source rather than a kind — but its purpose is a single
canonical glyph vocabulary, and splintering a second icon source into
`AddItemPicker` costs more than one union member.

**`CanvaPicker.tsx`** — search box plus thumbnail grid, `sort_by=modified_descending`
by default, "Load more" via continuation token. Unlike `SongPicker` it cannot
assume loaded data, so it carries real states: not connected, loading, empty,
no search results, offline, rate-limited.

**Connecting happens inside the picker**, not by redirecting to Settings. An
operator who clicked "Canva" on a Sunday morning should not be sent hunting
through Settings. Settings remains the place to review and disconnect.

**`SetlistItemCard`** — decks carrying `canva` get a small provenance badge;
stale ones get an "Updated in Canva" badge and a Refresh action.

## Failure handling

The governing rule: **a Canva failure must never damage a working setlist.**
Every path degrades to "you still have the PDF you already imported."

| Failure | Behavior |
|---|---|
| Access token expired | Silent refresh via backend; surfaces only if the refresh itself fails |
| Refresh token rejected | Mark disconnected, prompt reconnect; existing decks keep working |
| `safeStorage` unavailable (some Linux setups) | Explicit "Canva unavailable on this system". Never a silent plaintext fallback |
| Offline while browsing | "Can't reach Canva" plus retry; setlist editing is never blocked |
| Export job `failed` | Surface Canva's message; the common real cause is premium elements on a free account |
| 429 rate limited | Back off; "Canva is busy — try again in a minute" |
| Design deleted in Canva | Refresh reports it and keeps the local PDF |
| Crash mid-download | Atomic temp-file + rename, so no truncated PDF reaches pdf.js |
| User abandons the browser consent screen | Loopback listener times out and shuts down; no orphaned listener |

## Testing

Unit tests in `src/shared/canva.test.ts` under vitest, matching the existing
convention:

- PKCE: `code_verifier` entropy, S256 `code_challenge` derivation, base64url
  encoding without padding.
- Unix seconds → ISO 8601 conversion, including boundary and invalid inputs.
- Staleness comparison: newer, older, equal, and missing-timestamp cases.
- Export request building — including **an explicit assertion that `size` is
  never present in the request body**, since that trap corrupts slide
  proportions while reporting success.
- Export polling state machine driven by fake timers: `in_progress` → `success`,
  `in_progress` → `failed`, and give-up-on-timeout.

Manual verification: connect and disconnect; import a multi-page design and
confirm 16:9 proportions survive; edit the design in Canva and confirm the stale
badge appears; refresh and confirm the old PDF is deleted; export a backup and
confirm `media/canva/` round-trips; pull the network mid-browse and confirm
graceful degradation.

## Open decision for implementation time

The export-job **polling schedule and give-up timeout** is a judgment call about
these churches' real conditions rather than a code question, so the maintainer
picks the numbers. Polling aggressively burns the 20/min budget; backing off too
far makes a 3-second export feel like ten. Giving up at 30s fails large decks on
slow connections; waiting 5 minutes holds an operator hostage before a service.

Starting proposal, to be confirmed or replaced during implementation:
delays of 1s, 1s, 2s, 3s, 5s, then every 5s, giving up at 90s.
Roughly 8 lines in `src/shared/canva.ts`.
