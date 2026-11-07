# Remote, MIDI & Network Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let another app, such as a friend's worship playback app or a Stream Deck, drive Service Mode in time with the music: go to a section ("Chorus", "Verse 2"), go to the next or a numbered song, next or previous slide, and blackout, logo, or live. Cues can arrive as MIDI, OSC, or HTTP.

**Architecture:** All three transports turn their input into the same `RemoteCommand`. The commands run in exactly one place: an executor in the operator renderer that calls the existing `useServiceStore` actions. That's the same path the keyboard uses, so the projector, stage, and lower-thirds windows behave exactly as they do for a key press. HTTP and OSC listen in the main process and forward each command to the operator window over IPC. HTTP waits for the result so it can reply with it; OSC does not wait. MIDI uses Chromium's Web MIDI in the operator renderer, so no native module is needed.

**Tech Stack:**
- Electron 34 and Node's `http` and `dgram`.
- Web MIDI (`navigator.requestMIDIAccess`).
- React 18, Zustand, Vitest.
- No new dependencies: the OSC decoder is hand-written, about 80 lines.

**Spec:** None. The user skipped the design questions ("just write the plan"), so the decisions are recorded under *Decisions* below. Read them before starting.

## Decisions (made by Claude; the user hasn't reviewed them yet)

1. **Three transports, one command set.**
   - **MIDI:** what playback apps (MultiTracks Playback, Loop Community Prime, Ableton) already send.
   - **OSC:** show-control tools (QLab, TouchOSC, Ableton with OSC).
   - **HTTP:** simplest for a custom app like the friend's, and for Bitfocus Companion / Stream Deck.
2. **Absolute cues are the primary interface.** `goToSection` and `goToItem` are recommended over `next`. If a relative cue is dropped or arrives twice, everything after it is off by one. An absolute cue fixes itself at the next cue. The protocol doc tells integrators this.
3. **What a remote can't do:**
   - End or exit the service.
   - Edit the library.
   - Toggle anything. Display mode is set explicitly (`black`/`logo`/`live`), so a retried message can't flip it back.
   - `next` on the very last slide does nothing; it uses `autoAdvance` semantics.
4. **The operator always wins.**
   - Keys and clicks keep working.
   - A **Remote** chip in Service Mode pauses or resumes remote cues with one click.
   - Pause is in memory only and resets when the app restarts.
5. **Off by default.**
   - A single master switch lives in Settings → Connections.
   - "Listen on" defaults to **This computer only** (127.0.0.1). "Local network" (0.0.0.0) is an explicit choice because the playback rig is often a second computer.
6. **Auth:**
   - HTTP requires a bearer token that is separate from the MCP token.
   - OSC has no auth in its protocol, so it has its own off-by-default switch and a warning that anyone on the network can send cues.
   - Every cue shows its sender's IP in the activity list.
7. **Config lives in `<userData>/remote.json`, mode 0600, outside backups.** This follows the same reasoning as `mcp.json` (see `src/main/mcp/config.ts` header).
8. **Section matching uses the existing shortcut letters** (`shortcutFromLabel`): "chorus"/"C" → `C`, "verse 2"/"v2"/"2" → `2`, and so on.
   - From the current slide, the cue goes to the **next run** of that section after the current run. If there is none, it wraps to the **first** run in the song.
   - A run is a maximal stretch of consecutive slides with the same `sectionLabel`.
   - A run's start skips empty-lyric slides (the "Intro" transition slide) when the run has a non-empty slide.
   - Section cues only apply to song items.
9. **The MIDI map is fixed and documented (no MIDI-learn in v1).** It listens on one configurable channel, default **16**, so it doesn't collide with instrument channels on a shared port:

   | Message | Action |
   |---|---|
   | Note 60 / 61 | next / previous slide |
   | Note 62 / 63 | next / previous song (item) |
   | Note 64 / 65 / 66 | black / logo / live |
   | Note 70–75 | Intro, Pre-Chorus, Chorus, Bridge, Tag, Outro |
   | Note 80–91 | Verse 1–12 |
   | Program Change *p* | go to setlist item *p*+1 |

   Only Note On with velocity > 0 triggers. Everything else is ignored.
10. **OSC addresses:**
    - `/present/next`, `/present/prev`, `/present/item/next`, `/present/item/prev`
    - `/present/item <int|float n>` (1-based)
    - `/present/section <string>`
    - `/present/black`, `/present/logo`, `/present/live`

    On trigger addresses, a first numeric argument of `0` is ignored. TouchOSC-style buttons send 1 on press and 0 on release.
11. **HTTP:**
    - `POST /api/v1/command` with a JSON `RemoteCommand` body.
    - `GET /api/v1/status`.
    - 4 KB body cap; requests with an `Origin` header are refused.
    - Responses: `200 {ok:true, position}`, `409 {ok:false, reason}`, `400` invalid, `401` token.
12. **Ports:** HTTP **39218** and OSC UDP **39219**. MCP is 39217.

## Global Constraints

- No new runtime dependencies (no native MIDI or OSC packages).
- Remote cues go through `executeRemoteCommand` only. Nothing else calls the service store on a remote's behalf.
- The remote token is never written to `settings.json` or backups, and never logged.
- Tests must pass on Windows CI. Use no host-dependent paths, and bind tests to `127.0.0.1` with port `0`.
- UI copy follows the app's voice: plain words for a church volunteer, no "OSC/HTTP" jargon in headings. Technical terms are fine in the details.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01KxDDrFPA4okhYVBYohZBDb`.
- Work on branch `kalib/remote-control`. Don't touch `PROJECT-SPEC.md`.

## Review Focus

1. **A burst of cues while a song changes:** two HTTP commands sent 5 ms apart must run in order. Each runs synchronously in the store against the latest state (Task 5 test: `dispatch preserves order`).
2. **A remote at the end of the service:** `next` on the final slide of the final item returns `ok:true` with no position change and never ends the service (Task 3 test).
3. **A cue arrives when no service is running, or when Service Mode isn't open:** it returns `no-service` and nothing projects (Task 3 test). The operator window has gone away when there's no reply within 1000 ms, which gives `timeout` (Task 5 test).
4. **Section names typed differently:** `"Chorus"`, `"chorus 2"`, `"C"`, `"v2"`, `"Verse 2"`, and `" verse  2 "` all resolve (Task 1 test). An unknown section returns `not-found`, and nothing moves.
5. **OSC button release and junk packets:** a `0` argument, malformed packets, and bundles are all handled. Bad packets never crash the main process (Task 2 tests).

---

### Task 1: Shared remote protocol

**Files:**
- Create: `src/shared/remote.ts`
- Test: `src/shared/remote.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REMOTE_HTTP_DEFAULT_PORT = 39218
  export const REMOTE_OSC_DEFAULT_PORT = 39219
  export const REMOTE_MIDI_DEFAULT_CHANNEL = 16
  export type RemoteCommand =
    | { type: 'next' } | { type: 'prev' }
    | { type: 'nextItem' } | { type: 'prevItem' }
    | { type: 'goToItem'; number: number }        // 1-based
    | { type: 'goToSection'; section: string }    // ≤ 40 chars
    | { type: 'black' } | { type: 'logo' } | { type: 'live' }
    | { type: 'status' }
  export type RemoteFailure = 'no-service' | 'paused' | 'not-found' | 'not-a-song' | 'timeout' | 'invalid'
  export interface RemotePosition {
    itemNumber: number; itemCount: number; itemLabel: string
    section: string | null; slideNumber: number; slideCount: number
    display: 'live' | 'black' | 'logo'
  }
  export type RemoteResult = { ok: true; position: RemotePosition | null } | { ok: false; reason: RemoteFailure }
  export type RemoteSource = 'http' | 'osc' | 'midi'
  export function parseRemoteCommand(raw: unknown): RemoteCommand | null
  export function sectionKey(input: string): string | null   // "verse 2" → "2", "chorus" → "C"
  export function midiToCommand(data: ArrayLike<number>, channel: number): RemoteCommand | null
  export function oscToCommand(address: string, args: OscArg[]): RemoteCommand | null
  export type OscArg = number | string | boolean
  export function describeCommand(cmd: RemoteCommand): string // "Go to Chorus", "Next slide", "Go to song 3"
  ```

- [ ] **Step 1: Write the failing tests** in `src/shared/remote.test.ts`:
  - `parseRemoteCommand`:
    - Accepts every command shape.
    - Rejects an unknown `type`; `goToItem` with `0`, `-1`, `1.5`, or `"3"`; `goToSection` with an empty or 41-character section; and non-objects.
    - Trims `section`.
  - `sectionKey`:
    ```ts
    expect(sectionKey('Chorus')).toBe('C'); expect(sectionKey('chorus 2')).toBe('C')
    expect(sectionKey('C')).toBe('C'); expect(sectionKey('v2')).toBe('2')
    expect(sectionKey('Verse 2')).toBe('2'); expect(sectionKey(' verse  2 ')).toBe('2')
    expect(sectionKey('2')).toBe('2'); expect(sectionKey('Pre-Chorus')).toBe('P')
    expect(sectionKey('')).toBeNull()
    ```
  - `midiToCommand` with `channel = 16` (status nibble `0x9F` / `0xCF`):
    ```ts
    expect(midiToCommand([0x9f, 60, 100], 16)).toEqual({ type: 'next' })
    expect(midiToCommand([0x9f, 72, 1], 16)).toEqual({ type: 'goToSection', section: 'Chorus' })
    expect(midiToCommand([0x9f, 81, 90], 16)).toEqual({ type: 'goToSection', section: 'Verse 2' })
    expect(midiToCommand([0xcf, 2], 16)).toEqual({ type: 'goToItem', number: 3 })
    expect(midiToCommand([0x9f, 60, 0], 16)).toBeNull()   // velocity 0 = note off
    expect(midiToCommand([0x90, 60, 100], 16)).toBeNull() // wrong channel
    expect(midiToCommand([0x8f, 60, 100], 16)).toBeNull() // note off
    expect(midiToCommand([0x9f, 67, 100], 16)).toBeNull() // unmapped note
    ```
  - `oscToCommand`:
    - `('/present/next', [])` → next.
    - `('/present/next', [1])` → next.
    - `('/present/next', [0])` → null.
    - `('/present/item', [3])` and `('/present/item', [3.0])` → goToItem 3.
    - `('/present/item', [2.5])` → null.
    - `('/present/section', ['bridge'])` → goToSection.
    - `('/present/section', [])` → null.
    - `('/other', [])` → null.
  - `describeCommand`: one assertion per type.

- [ ] **Step 2:** Run `node_modules/.bin/vitest run src/shared/remote.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/shared/remote.ts`.**
  - `sectionKey` normalizes whitespace and matches `/^v(?:erse)?\s*(\d+)$/i` or `/^\d+$/` to get the digits; anything else uses `shortcutFromLabel`.
  - `shortcutFromLabel` lives in `src/renderer/src/lib/slideify.ts`, and shared can't import from the renderer. Move it into `src/shared/sectionShortcut.ts`, then re-export it from `slideify.ts` so existing imports keep working.
  - MIDI note→section labels: `70 Intro, 71 Pre-Chorus, 72 Chorus, 73 Bridge, 74 Tag, 75 Outro`, `80+n → "Verse n+1"` for n in 0..11.

- [ ] **Step 4:** Run `node_modules/.bin/vitest run src/shared src/renderer/src/lib/slideify.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(remote): shared command protocol, MIDI and OSC mappings`

---

### Task 2: OSC packet decoder

**Files:**
- Create: `src/main/remote/osc.ts`
- Test: `src/main/remote/osc.test.ts`

**Interfaces:**
- Consumes: `OscArg` from Task 1.
- Produces: `export function decodeOscPacket(buf: Buffer): { address: string; args: OscArg[] }[]`. It returns a flat list of messages (bundles are flattened recursively), and returns `[]` for anything malformed. It never throws.

- [ ] **Step 1: Write the failing tests.** Add a tiny encoder in the test file: pad strings to 4 bytes with a NUL, use big-endian int32 and float32. Cover:
  - A message with no args.
  - `,i` / `,f` / `,s` / `,T` / `,F` args.
  - A `#bundle` holding two messages, flattened in order.
  - Junk is never thrown:
    - A truncated buffer gives `[]`.
    - A missing type-tag string gives a message with no args (old OSC 1.0 senders).
    - An unknown type tag `,x` gives `[]`.
    - An empty buffer gives `[]`.

- [ ] **Step 2:** Run `node_modules/.bin/vitest run src/main/remote/osc.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `decodeOscPacket`.**
  - Support only the `i f s T F` tags; ignore bundle time tags.
  - Wrap the whole decode in try/catch and return `[]`. A UDP packet from anyone must never take down main.
  - Cap bundle recursion depth at 4.

- [ ] **Step 4:** Run the test. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(remote): dependency-free OSC packet decoder`

---

### Task 3: Renderer executor, section resolver, explicit display mode

**Files:**
- Modify: `src/renderer/src/stores/useServiceStore.ts`. Add the `setDisplayMode` action next to `toggleBlack`.
- Modify: `src/renderer/src/stores/useServiceStore.test.ts`
- Create: `src/renderer/src/lib/remoteSections.ts` and `remoteSections.test.ts`
- Create: `src/renderer/src/stores/useRemoteStore.ts`
- Create: `src/renderer/src/lib/remoteExecutor.ts` and `remoteExecutor.test.ts`

**Interfaces:**
- Consumes: `RemoteCommand`, `RemoteResult`, `RemotePosition`, `RemoteSource`, `sectionKey`, `describeCommand` (Task 1); `shortcutFromLabel`.
- Produces:
  - `useServiceStore` action `setDisplayMode(mode: OutputMode): void`. It's a no-op when not running or when already in that mode, and otherwise broadcasts like the toggles do.
  - `findSectionStart(item: RenderableItem, currentSlide: number, key: string): number | null`
  - `useRemoteStore`: `{ paused: boolean; activity: RemoteActivity[]; lastMidi: string | null; setPaused(p: boolean): void; record(a: RemoteActivity): void; setLastMidi(s: string): void }`, where `RemoteActivity = { at: string; source: RemoteSource; from: string | null; summary: string; result: RemoteResult }` and the activity list is capped at 20, newest first.
  - `executeRemoteCommand(cmd: RemoteCommand, source: RemoteSource, from: string | null): RemoteResult`. It's synchronous, and records activity for everything except `status`.

- [ ] **Step 1: Write the failing tests.**
  - `useServiceStore.test.ts`, `setDisplayMode`: `'black'` sets `displayMode` and calls `window.api.output.setBlack` once. Calling it again doesn't broadcast again.
  - `remoteSections.test.ts`. Build a song item whose slides have labels `[Intro(empty), Verse 1, Verse 1, Chorus, Chorus, Verse 2, Chorus, Bridge]`:
    ```ts
    expect(findSectionStart(item, 1, 'C')).toBe(3)   // from V1 → first chorus run
    expect(findSectionStart(item, 4, 'C')).toBe(6)   // inside chorus run 1 → next run
    expect(findSectionStart(item, 6, 'C')).toBe(3)   // last run → wraps to first
    expect(findSectionStart(item, 0, '2')).toBe(5)
    expect(findSectionStart(item, 0, 'X')).toBeNull()
    ```
    Then a second item whose `[Intro(empty), Intro("la la")]` merges into one run: `findSectionStart(item2, 3, 'I')` returns the non-empty slide's index.
  - `remoteExecutor.test.ts`. Mock `window.api.output` as the store test already does, and start a 2-item service:
    - `next` on the final slide of the final item returns `{ok:true}`, and `state.mode` is still `'running'`.
    - With nothing running, the result is `{ok:false, reason:'no-service'}`.
    - With `useRemoteStore` paused, the result is `'paused'` and the position doesn't change.
    - `goToSection` on a non-song item gives `'not-a-song'`; an unknown section gives `'not-found'`.
    - `goToItem` 3 of 2 gives `'not-found'`.
    - `goToItem` 2 lands on item index 1, slide 0.
    - `black` then `black` keeps `displayMode` at `'black'`.
    - `status` returns a position and records no activity.
    - The position reports a 1-based `itemNumber` and `slideNumber`, plus the slide's `section`.

- [ ] **Step 2:** Run `node_modules/.bin/vitest run src/renderer/src/lib/remote* src/renderer/src/stores/useServiceStore.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `next` → `autoAdvance()`; `prev` → `prevSlide()`; `nextItem`/`prevItem` → the existing actions; `goToItem` → `jumpTo(n - 1, 0)`; `goToSection` → `jumpTo(itemIndex, findSectionStart(...))`; `black`/`logo`/`live` → `setDisplayMode`.
  - `paused` is checked before anything except `status`.
  - The position is read back from `useServiceStore.getState()` after the action.

- [ ] **Step 4:** Run the tests again. Expected: PASS. Then run `node_modules/.bin/vitest run`; the whole suite should stay green.

- [ ] **Step 5: Commit:** `feat(remote): command executor with section-aware jumps`

---

### Task 4: Remote config and HTTP listener

**Files:**
- Create: `src/main/remote/config.ts`
- Create: `src/main/remote/httpServer.ts`
- Test: `src/main/remote/config.test.ts`, `src/main/remote/httpServer.test.ts`

**Interfaces:**
- Consumes: `parseRemoteCommand`, `RemoteResult`, `RemoteCommand` (Task 1); `tokenMatches` from `src/main/mcp/httpServer.ts` (reuse it; don't copy it); `newToken`, `isValidPort` from `src/main/mcp/config.ts`; `atomicWriteJson`.
- Produces:
  `RemoteConfig` is declared in `src/shared/remote.ts` (add it there, not in main) because the renderer's `RemoteState` extends it; `config.ts` imports it.
  ```ts
  export interface RemoteConfig {
    enabled: boolean; scope: 'local' | 'network'; httpPort: number
    oscEnabled: boolean; oscPort: number
    midiEnabled: boolean; midiInput: string | null; midiChannel: number // 1..16
    token: string
  }
  export function normalizeRemoteConfig(raw: unknown): RemoteConfig
  export function loadRemoteConfig(): Promise<RemoteConfig>   // <userData>/remote.json, mode 0o600
  export function saveRemoteConfig(c: RemoteConfig): Promise<void>
  export function startRemoteHttpServer(opts: {
    host: '127.0.0.1' | '0.0.0.0'; port: number; token: string
    dispatch: (cmd: RemoteCommand, from: string | null) => Promise<RemoteResult>
  }): Promise<{ port: number; close(): Promise<void> }>
  ```
  When the port is taken, it throws the existing `PortInUseError` (import it from `../mcp/httpServer`).

- [ ] **Step 1: Write the failing tests.**
  - `config.test.ts`, `normalizeRemoteConfig`:
    - `{}` → `enabled:false, scope:'local', httpPort:39218, oscEnabled:false, oscPort:39219, midiEnabled:false, midiInput:null, midiChannel:16`, plus a token of at least 32 characters.
    - Invalid values fall back: `midiChannel` 0 or 17 → 16; `scope` `'x'` → `'local'`; `httpPort` 80 → 39218.
    - A config whose `oscPort === httpPort` is kept: TCP and UDP don't collide.
  - `httpServer.test.ts` runs on `127.0.0.1`, port 0, with a stub `dispatch` that records its calls:
    - `POST /api/v1/command` with `{"type":"next"}` and the right token gives 200 and the stub's result. `from` is `'127.0.0.1'` (strip `::ffff:`).
    - With no token, or a wrong one: 401, and dispatch is not called.
    - An `Origin` header: 403.
    - An invalid body (`{"type":"nope"}`, or not JSON): 400 `{ok:false, reason:'invalid'}`.
    - A body over 4096 bytes: 413.
    - When the stub returns `{ok:false, reason:'no-service'}`: 409 with that body.
    - `GET /api/v1/status` calls dispatch with `{type:'status'}`.
    - Any other path: 404. A `PUT` to the command path: 405.

- [ ] **Step 2:** Run `node_modules/.bin/vitest run src/main/remote`. Expected: FAIL.

- [ ] **Step 3: Implement both modules.**
  - Mirror `src/main/mcp/config.ts` and `src/main/mcp/httpServer.ts`.
  - The differences: there's no Host check, because LAN clients use the machine's IP; the paths are `/api/v1/command` and `/api/v1/status`; there are no sessions.

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(remote): config file and token-protected HTTP control API`

---

### Task 5: Main controller, OSC socket, IPC round-trip, operator hook

**Files:**
- Create: `src/main/remote/dispatch.ts` and `dispatch.test.ts`
- Create: `src/main/remote/index.ts` (the lifecycle, mirroring `src/main/mcp/index.ts`)
- Create: `src/main/ipc/remote.ts`
- Modify: `src/main/ipc/index.ts`. Register the handlers.
- Modify: `src/main/index.ts`. Call `initRemote()` next to `initMcp()` (line ~457) and `shutdownRemote()` next to `shutdownMcp()` (line ~524).
- Modify: `src/shared/ipc-contract.ts`. Add the `remote` channels and the `PresentApi.remote` surface.
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/hooks/useRemoteControl.ts`
- Modify: `src/renderer/src/App.tsx`. Call `useRemoteControl(kind === 'operator')` next to the existing `library.onExternalChange` effect.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `src/main/remote/dispatch.ts`:
    ```ts
    export function createDispatcher(send: (msg: RemoteCommandEvent) => boolean, timeoutMs = 1000): {
      dispatch(cmd: RemoteCommand, source: 'http' | 'osc', from: string | null): Promise<RemoteResult>
      reply(id: string, result: RemoteResult): void
    }
    ```
    `send` returns false when there's no operator window, which gives `no-service` straight away.
  - Shared types:
    - `RemoteCommandEvent = { id: string; command: RemoteCommand; source: RemoteSource; from: string | null }`
    - `RemoteState = RemoteConfig & { status: 'off' | 'starting' | 'running' | 'error'; error: string | null; addresses: string[] }`, which goes in `src/shared/remote.ts`.
  - Channels: `remote:getState`, `remote:update` (a `Partial<RemoteConfig>` without `token`), `remote:regenerateToken`, `remote:reply`, `remote:event:state`, and `remote:event:command`.
  - `window.api.remote`: `{ getState(), update(patch), regenerateToken(), reply(id, result), onStateChange(cb), onCommand(cb) }`.

- [ ] **Step 1: Write the failing `dispatch.test.ts`.**
  - The reply resolves the matching promise.
  - No reply within `timeoutMs` (use fake timers) resolves `{ok:false, reason:'timeout'}`.
  - `send` returning false resolves `no-service` without waiting.
  - A reply for an unknown or late id is ignored.
  - **dispatch preserves order:** two dispatches are sent in call order with distinct ids.

- [ ] **Step 2:** Run `node_modules/.bin/vitest run src/main/remote/dispatch.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `dispatch.ts`, then the rest.**
  - `index.ts`:
    - Serializes start, stop, and apply the same way MCP does.
    - Starts HTTP when `enabled`, and a `dgram` `udp4` socket when `enabled && oscEnabled`. The socket binds `scope === 'network' ? '0.0.0.0' : '127.0.0.1'`.
    - The socket's `message` handler runs `decodeOscPacket` → `oscToCommand` → `dispatch(cmd, 'osc', rinfo.address)` and ignores the result.
    - `addresses` lists non-internal IPv4 addresses from `os.networkInterfaces()`.
    - `update()` validates ports with `isValidPort` and the channel as 1–16, saves, and restarts the listeners only when a listener-relevant field changed. MIDI fields only re-broadcast state.
  - `useRemoteControl` subscribes to `onCommand`, runs `executeRemoteCommand(e.command, e.source, e.from)`, and calls `window.api.remote.reply(e.id, result)`.

- [ ] **Step 4:** Run `node_modules/.bin/vitest run` and `pnpm typecheck`. Expected: all pass.

- [ ] **Step 5: Manual check.** Run `node_modules/.bin/electron-vite dev`. Turn the remote on with a temporary `remote.json` that has `"enabled": true`, start a service, then:
  - `curl -s -X POST -H "Authorization: Bearer $TOKEN" -d '{"type":"goToSection","section":"chorus"}' http://127.0.0.1:39218/api/v1/command` makes the projector jump to the chorus, and the response body names `"section":"Chorus"`.
  - The same request with no service running returns 409 `no-service`.

- [ ] **Step 6: Commit:** `feat(remote): main-process controller, OSC listener, operator round-trip`

---

### Task 6: MIDI input

**Files:**
- Create: `src/renderer/src/hooks/useMidiInput.ts`
- Modify: `src/renderer/src/App.tsx`. Call `useMidiInput(kind === 'operator')`.
- Modify: `src/main/index.ts`. Only if Step 3 shows it's needed: allow the `'midi'` permission (not `'midiSysex'`) in `session.defaultSession.setPermissionRequestHandler`.

**Interfaces:**
- Consumes: `midiToCommand` (Task 1), `executeRemoteCommand` and `useRemoteStore.setLastMidi` (Task 3), and `RemoteState` from `window.api.remote` (Task 5).
- Produces: `useMidiInput(enabled: boolean): { inputs: string[]; error: string | null }`. The Settings card (Task 7) uses the input list.

- [ ] **Step 1: Implement the hook.**
  - Active only when `state.enabled && state.midiEnabled`. Call `navigator.requestMIDIAccess({ sysex: false })` once.
  - Attach `onmidimessage` to every input, or only the input whose `name === midiInput`.
  - Re-attach on `statechange`, which covers a USB interface plugged in mid-service.
  - On each message:
    - Store `setLastMidi("Note 72 vel 100 ch 16")`, formatted from the raw bytes, for any channel. This is how an integrator checks their channel.
    - Then `midiToCommand(e.data, midiChannel)`, and if it gives a command, `executeRemoteCommand(cmd, 'midi', inputName)`.
  - Detach all listeners on cleanup.
  - No unit test: the hook is glue. The mapping it depends on is covered by the Task 1 tests.

- [ ] **Step 2: Manual check on macOS.**
  - In Audio MIDI Setup → IAC Driver, tick "Device is online".
  - Send notes with a small script: `node -e` using any MIDI sender, or a DAW, or Pocket MIDI.
  - Expected: Note 72 on channel 16 jumps to the chorus, and Note 72 on channel 1 shows in "last MIDI message" but doesn't move anything.

- [ ] **Step 3:** If `requestMIDIAccess` rejects with a permission error, add the permission handler. It allows `'midi'` only for the operator window's `webContents` and keeps the default for everything else. Re-run Step 2.

- [ ] **Step 4: Commit:** `feat(remote): MIDI cue input via Web MIDI`

---

### Task 7: Settings card and Service Mode chip

**Files:**
- Create: `src/renderer/src/components/RemoteControlCard.tsx`
- Modify: `src/renderer/src/pages/Settings.tsx` (connections section, ~line 254). Render `<RemoteControlCard />` above `<AiConnectionsCard />`.
- Modify: `src/renderer/src/pages/ServiceMode.tsx`. Add a header chip next to the `?` cheat-sheet button (~line 997).

**Interfaces:**
- Consumes: `window.api.remote` (Task 5), `useRemoteStore` (Task 3), `useMidiInput` (Task 6), and `SettingsKit` / `AiConnectionsCard` patterns: `CopyButton`, `StatusBadge`, `Notice`.

- [ ] **Step 1: Build the card.** Copy and layout:
  - Title **"Remote control"**. Description: *"Let a playback app, MIDI controller, or Stream Deck move the slides during a service. Remotes can change slides, songs, and blackout. They can't end the service or change your library."*
  - The master switch.
  - **Listen on:** "This computer only" / "Other computers on this network". When it's the network option, list `http://<addr>:<httpPort>` for each address.
  - The token, with Copy and New buttons. The port field takes 1024–65535.
  - **OSC** switch and port, with the warning *"Anyone on this network can send OSC cues. Only turn this on at church, not on public Wi-Fi."*
  - **MIDI** switch, an input `<select>` ("All inputs" plus `inputs`), and a channel `<select>` from 1 to 16. Show "Last MIDI message: …" from `lastMidi`.
  - **Recent cues:** the `activity` list, showing time, source, sender, summary, and a ✓ or the failure reason in plain words. `paused` reads "Paused in Service Mode"; `not-found` reads "No such section/song".
  - A link to `docs/remote-control.md` on GitHub: `https://github.com/kalib-code/prochurchcenter-present/blob/main/docs/remote-control.md`, opened via the existing external-link helper.

- [ ] **Step 2: Service Mode chip.** Show it only when `enabled`. It reads **"Remote"**, or **"Remote paused"** in the warning tone, and clicking it toggles `useRemoteStore.setPaused`. Its tooltip shows the last cue's summary.

- [ ] **Step 3: Verify.** Run `pnpm typecheck` and `node_modules/.bin/vitest run`; both should pass. Then launch the app and check the card at Settings → Connections:
  - Toggling OSC starts and stops the UDP listener: `lsof -iUDP:39219` lists the app, then doesn't.
  - Pausing from the chip makes `curl` get 409 `paused`.

- [ ] **Step 4: Commit:** `feat(remote): Settings card and Service Mode pause chip`

---

### Task 8: Integration doc and README

**Files:**
- Create: `docs/remote-control.md`
- Modify: `README.md`. Add a Features bullet after the MCP line.

- [ ] **Step 1: Write `docs/remote-control.md` for the friend building the playback integration.**
  - Turning it on.
  - Recommending absolute cues (Decision 2).
  - The MIDI table and channel (Decision 9), including what each app calls note 60 ("C3" or "C4"), so they should pick by number.
  - OSC addresses (Decision 10).
  - HTTP with `curl` examples for every command, plus a status example and a response example.
  - Error reasons.
  - Two-computer setup:
    - macOS Network MIDI session, or rtpMIDI on Windows.
    - HTTP or OSC over the same Wi-Fi or Ethernet.
    - Expect the macOS or Windows firewall "allow incoming connections" prompt the first time "Other computers" is chosen.
  - A troubleshooting checklist built around "Last MIDI message" and "Recent cues".

- [ ] **Step 2: README bullet:** *"- **Remote control.** Let a playback app, MIDI controller, or Stream Deck move the lyrics in time with the band: jump to the chorus, the next song, or blackout. MIDI, OSC, or a simple HTTP API; off by default. See [docs/remote-control.md](docs/remote-control.md)."*

- [ ] **Step 3: End-to-end check.** Run all three transports against one running service: `curl`; an OSC packet from a 10-line Node `dgram` script using the Task 2 test encoder; a MIDI note through the IAC Driver. Each should move the projector and show up in Recent cues with the right source.

- [ ] **Step 4: Commit:** `docs(remote): integration guide for playback apps and controllers`

---

## Not in this plan (follow-ups)

- MIDI-learn, and custom MIDI or OSC maps.
- Sending state back out (OSC/MIDI feedback, or a WebSocket push of the position). The friend's app can poll `GET /api/v1/status` for now.
- Timecode (MTC/LTC) chasing, and cue lists stored per song.
- A built-in phone remote web page. HTTP is ready for it, but it needs a UI and a CSRF design.
