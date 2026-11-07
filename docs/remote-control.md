# Remote control

Let a playback app, a MIDI controller, or a Stream Deck move the lyrics while Service Mode is running. Three ways in: HTTP, OSC, and MIDI. All three are off until you turn them on.

A remote can change slides, jump between songs and sections, and switch to black, logo or live. It cannot end the service or change your library.

## Quickstart (30 seconds)

1. Start a service in Service Mode.
2. Open **Settings → Connections → Remote control** and turn on **Allow remote control**.
3. Next to **Access token**, click **Copy**.
4. In a terminal on the same computer:

```sh
TOKEN=paste-the-token-here

# Where are we?
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:39218/api/v1/status

# Jump to the chorus
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"goToSection","section":"Chorus"}' \
  http://127.0.0.1:39218/api/v1/command
```

The projector moves, and the cue shows up under **Recent cues** in Settings.

## Prefer absolute cues

Use "go to Chorus" and "go to song 3" instead of "next". Messages get dropped or doubled (a double-tapped pad, a retried request, a MIDI glitch). A relative cue then leaves the lyrics one slide off, and it stays off. An absolute cue fixes itself: the next "go to Chorus" puts everyone in the right place no matter what came before.

Use `next` and `prev` for the places where there is no better answer, such as walking through a sermon slide by slide.

## HTTP

Base URL: `http://127.0.0.1:39218` (default port; change it under **Port**).

| Request | What it does |
| --- | --- |
| `POST /api/v1/command` | Run one command. JSON body. |
| `GET /api/v1/status` | Same as the `status` command. |

Every request needs `Authorization: Bearer <token>`. Browsers are refused (any request with an `Origin` header gets 403), so this is for apps and scripts, not web pages.

### Commands

| `type` | Extra fields | Effect |
| --- | --- | --- |
| `next` | | Next slide (or next item at the end of an item). Does nothing on the very last slide of the service. |
| `prev` | | Previous slide. |
| `nextItem` | | Next item in the service. |
| `prevItem` | | Previous item. |
| `goToItem` | `number`: integer, 1 or more (1 is the first item) | Jump to the first slide of that item. |
| `goToSection` | `section`: text, 1 to 40 characters | Jump to a section of the current song. |
| `black` | | Show a black screen. |
| `logo` | | Show the logo screen. |
| `live` | | Back to the lyrics. |
| `status` | | Report the current position. Changes nothing. |

`black`, `logo` and `live` set the screen. They do not toggle, so sending `black` twice leaves it black.

```sh
H="Authorization: Bearer $TOKEN"
U=http://127.0.0.1:39218/api/v1/command

curl -X POST -H "$H" -d '{"type":"next"}' $U
curl -X POST -H "$H" -d '{"type":"prev"}' $U
curl -X POST -H "$H" -d '{"type":"nextItem"}' $U
curl -X POST -H "$H" -d '{"type":"prevItem"}' $U
curl -X POST -H "$H" -d '{"type":"goToItem","number":3}' $U
curl -X POST -H "$H" -d '{"type":"goToSection","section":"Verse 2"}' $U
curl -X POST -H "$H" -d '{"type":"black"}' $U
curl -X POST -H "$H" -d '{"type":"logo"}' $U
curl -X POST -H "$H" -d '{"type":"live"}' $U
curl -X POST -H "$H" -d '{"type":"status"}' $U
curl -H "$H" http://127.0.0.1:39218/api/v1/status
```

### Which section does `goToSection` pick?

- Names are matched loosely: `Chorus`, `C` and `chorus 2` all mean the chorus. `Verse 2`, `v2` and `2` all mean verse 2. `Pre-Chorus` matches pre-chorus sections.
- It goes to the **next** matching section after the slide you are on, and wraps around to the first one. Send `Chorus` repeatedly and it steps through each chorus in turn.
- It only works while the current item is a song. Otherwise you get `not-a-song`.
- If the song has no such section you get `not-found`, and nothing moves.

### Responses

Every response is JSON. `ok` says whether the cue ran.

Success, with a service running (200):

```json
{
  "ok": true,
  "position": {
    "itemNumber": 2,
    "itemCount": 5,
    "itemLabel": "Great Are You Lord",
    "section": "Chorus",
    "slideNumber": 7,
    "slideCount": 14,
    "display": "live"
  }
}
```

`display` is `live`, `black` or `logo`. `section` is `null` when the slide is not a lyrics slide. `status` works with no service and answers `{"ok":true,"position":null}`.

Failure:

| Status | Body | Meaning |
| --- | --- | --- |
| 409 | `{"ok":false,"reason":"no-service"}` | Service Mode isn't running. |
| 409 | `{"ok":false,"reason":"paused"}` | The **Remote** chip in Service Mode is paused. |
| 409 | `{"ok":false,"reason":"not-found"}` | No such song number or section. |
| 409 | `{"ok":false,"reason":"not-a-song"}` | `goToSection` while the current item isn't a song. |
| 409 | `{"ok":false,"reason":"timeout"}` | Present didn't answer in time. |
| 400 | `{"ok":false,"reason":"invalid"}` | Bad JSON, unknown `type`, or a bad field. |
| 401 | `{"ok":false,"reason":"unauthorized"}` | Missing or wrong token. Includes `WWW-Authenticate: Bearer`. |
| 403 | `{"ok":false,"reason":"forbidden"}` | The request had an `Origin` header (a browser). |
| 404 | `{"ok":false,"reason":"not-found"}` | Wrong path. |
| 405 | `{"ok":false,"reason":"method"}` | Wrong method (`Allow` header says which). |
| 413 | `{"ok":false,"reason":"too-large"}` | Body over 4096 bytes. |
| 500 | `{"ok":false,"reason":"invalid"}` | Unexpected error inside Present. |

## OSC

OSC arrives over UDP on port **39219** by default (**OSC port** in Settings). Turn on **OSC** in the Remote control card first.

| Address | Arguments | Command |
| --- | --- | --- |
| `/present/next` | none | `next` |
| `/present/prev` | none | `prev` |
| `/present/item/next` | none | `nextItem` |
| `/present/item/prev` | none | `prevItem` |
| `/present/item` | one integer, 1 or more | `goToItem` |
| `/present/section` | one string, up to 40 characters | `goToSection` |
| `/present/black` | none | `black` |
| `/present/logo` | none | `logo` |
| `/present/live` | none | `live` |

- Button-style apps such as TouchOSC send `1` on press and `0` on release. A first argument of `0` is ignored, so a button fires once.
- `/present/item` also accepts a float with a whole value (`3.0`), since some apps send every number as a float.
- A packet or bundle can carry at most 16 cues; the rest are dropped.
- OSC has no replies. To read the position, call `GET /api/v1/status`.
- OSC has no password. Use **Only accept OSC from (optional)** to limit it to one sender's IPv4 address. Leave it empty to accept OSC from any computer on the network.

## MIDI

Turn on **MIDI** in the Remote control card, choose a **MIDI input** (or **All inputs**) and the **MIDI channel**. The default channel is **16**, chosen to stay out of the way of instruments. Messages on other channels are ignored.

Only Note On (with velocity above 0) and Program Change do anything. Note Off, and Note On with velocity 0, are ignored.

| Message | Command |
| --- | --- |
| Note 60 | `next` |
| Note 61 | `prev` |
| Note 62 | `nextItem` |
| Note 63 | `prevItem` |
| Note 64 | `black` |
| Note 65 | `logo` |
| Note 66 | `live` |
| Note 70 | `goToSection` "Intro" |
| Note 71 | `goToSection` "Pre-Chorus" |
| Note 72 | `goToSection` "Chorus" |
| Note 73 | `goToSection` "Bridge" |
| Note 74 | `goToSection` "Tag" |
| Note 75 | `goToSection` "Outro" |
| Notes 80 to 91 | `goToSection` "Verse 1" to "Verse 12" (note 80 is Verse 1) |
| Program Change 0 to 127 | `goToItem` 1 to 128 (program 0 is the first item) |

**Note names differ between apps.** Note 60 is "C3" in some apps (Ableton Live, Logic) and "C4" in others (most other software). Choose by the **number**, not the name. MIDI channel numbers have the same trap: some tools count channels from 0. Present's channel 16 is the one the app calls 16.

## Two computers

The usual setup is Present on the projector computer and the playback app on another computer.

1. Put both on the same Wi-Fi or Ethernet network.
2. On the Present computer, open **Settings → Connections → Remote control** and set **Listen on** to **Other computers on this network**.
3. Settings lists the addresses, such as `http://192.168.1.20:39218`. Use one of those instead of `127.0.0.1`. Each has a **Copy** button.
4. The first time you do this, macOS or Windows asks whether to **allow incoming connections** for Present. Say yes. If you said no by mistake, allow Present in the system firewall settings.
5. Use the same token.

HTTP and OSC work directly across the network. MIDI does not travel over the network by itself:

- **macOS to macOS:** open Audio MIDI Setup, then Window, Show MIDI Studio, and open the **Network** icon. Create a session on each Mac, connect them, then pick the session as the **MIDI input** in Present.
- **Windows:** install [rtpMIDI](https://www.tobias-erichsen.de/software/rtpmidi.html), create a session, and connect it to the Mac's session. Pick the session port as the MIDI input.
- **Same Mac:** use the IAC Driver (Audio MIDI Setup, Show MIDI Studio, double-click **IAC Driver**, tick **Device is online**). Send MIDI from your app to the IAC bus, and choose it as the **MIDI input**.

If you only need a few cues, HTTP or OSC is simpler than network MIDI.

## Security

- The token is a password. Anyone with it can move your slides. Click **New token** to replace it; every connected app then needs the new one.
- HTTP is plain, not encrypted. It is meant for your own network. Do not forward the port through your router or expose it to the internet.
- **This computer only** (the default) binds to `127.0.0.1`, so nothing else can reach it. **Other computers on this network** binds to all network interfaces.
- OSC has no password. If you use OSC across a network, set **Only accept OSC from** to the sender's IPv4 address.
- Remotes cannot end the service or edit songs and setlists. `next` on the last slide does nothing.
- In Service Mode, the **Remote** chip shows that remote control is on. Click it to pause all cues (it reads **Remote paused**); click again to resume. Hover to see the last cue. While paused, cues are refused with `paused`, but `status` still answers.

## Troubleshooting

Open **Settings → Connections → Remote control**. Two things there tell you what is happening:

- **Last MIDI message** (under MIDI) shows the last message Present received.
- **Recent cues** shows each cue that arrived, where it came from (Web, OSC or MIDI), and whether it ran. A failed cue shows the reason in plain words.

Work down the list:

1. **Nothing under Recent cues.** The cue never arrived.
   - Is **Allow remote control** on, with the badge showing **On**? If it says **Not running**, read the message; the port may be in use. Change **Port**, **OSC port**, or close the app that holds it.
   - HTTP from another computer: is **Listen on** set to **Other computers on this network**, and did you use the address Settings lists? Did the firewall prompt get allowed?
   - OSC: is **OSC** on, and is the port right? If **Only accept OSC from** is set, does it match the sender's IP?
   - HTTP 401 means the token is wrong or missing. 403 means the request came from a browser.
2. **MIDI: Last MIDI message stays at "none yet".** Present isn't hearing the device. Check the **MIDI input** (try **All inputs**), the cable or network session, and that **MIDI** is on.
3. **MIDI: Last MIDI message updates but Recent cues stays empty.** The message is the wrong kind or the wrong channel. Check the **MIDI channel** (default 16) and that it's a Note On or Program Change. Check the note number against the table. Remember note 60 may be called C3 or C4.
4. **A cue appears with a reason.**
   - *No service running*: start Service Mode.
   - *Paused in Service Mode*: click the **Remote paused** chip.
   - *No such section or song*: the song has no such section, or the item number is past the end of the service. Names are matched loosely (Chorus, C, Verse 2, v2), but a song with no chorus has none.
   - *Current item isn't a song*: `goToSection` only works on songs. Send `goToItem` first.
   - *Present didn't answer in time* or *Couldn't run that cue*: the operator window is busy or closed. Keep the Present operator window open during the service, and send the cue again.
5. **It works but lands on the wrong section.** `goToSection` goes to the next match after the current slide. If you want the first chorus every time, jump to the song with `goToItem` first, then send the section.
