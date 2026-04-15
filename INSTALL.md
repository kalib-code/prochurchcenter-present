# Installing ProChurchCenter Present

A step-by-step guide for installing ProChurchCenter Present on your church's laptop. Written for volunteers, not developers — no technical background required.

> **Important**: Until we finish code-signing (coming in a future update), your computer will show a security warning the first time you open the app. **This is normal.** The app is safe — the warning appears because we haven't yet paid Apple and Microsoft for official signing certificates. The steps below show you exactly how to get past the warning. It only needs to be done **once per computer**.

---

## 1. Download the installer

1. Go to the **[latest release page](https://github.com/kalib-code/prochurchcenter-present/releases/latest)** on GitHub.
2. Scroll down to **Assets** and click the file that matches your computer:

| Your computer                     | Download this file                              |
| --------------------------------- | ------------------------------------------------ |
| **Windows** (most PH churches)    | `prochurchcenter-present-X.X.X-setup.exe`        |
| **Mac** (Apple Silicon — M1/M2/M3) | `prochurchcenter-present-X.X.X-arm64.dmg`        |
| **Mac** (Intel — 2019 or older)   | `prochurchcenter-present-X.X.X-x64.dmg`          |
| **Linux**                         | `prochurchcenter-present-X.X.X.AppImage`         |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. If it says "Chip: Apple M1/M2/M3", download the `arm64` file. If it says "Processor: Intel", download the `x64` file.

---

## 2. Install on Windows

### Step 1 — Run the installer

Double-click the downloaded `.exe` file. Windows will show a blue window titled **"Windows protected your PC"**:

> Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.
>
> **Don't run**

### Step 2 — Click past SmartScreen

1. Click the small text **"More info"** in the blue window.
2. A new button will appear at the bottom: **"Run anyway"**.
3. Click **"Run anyway"**.

### Step 3 — Complete the installer

1. Follow the normal installer — pick "Install for me only" or "Install for everyone", choose the folder (or accept the default), click **Install**.
2. When it finishes, click **Finish**. A shortcut will be on your Desktop and in the Start menu.

Double-click the desktop shortcut to launch. You won't see the SmartScreen warning again — Windows remembers your choice for this app.

---

## 3. Install on macOS

### Step 1 — Open the DMG

1. Double-click the downloaded `.dmg` file. A window opens showing the ProChurchCenter Present icon and a shortcut to the Applications folder.
2. **Drag the ProChurchCenter Present icon into the Applications folder.**
3. Close the DMG window and eject the disk image (right-click it on your desktop → Eject).

### Step 2 — First launch (the important part)

If you just double-click the app in Applications, macOS will show one of these warnings:

> **"ProChurchCenter Present" cannot be opened because Apple cannot check it for malicious software.**
>
> This software needs to be updated. Contact the developer for more information.
>
> **Move to Trash / Done**

**Don't click "Move to Trash".** Close this dialog instead. Then use one of the two methods below.

### Method A — Right-click Open (easiest, works every time)

1. Open the **Applications** folder in Finder.
2. **Right-click** (or Control-click) the **ProChurchCenter Present** icon.
3. Choose **Open** from the menu.
4. A new dialog appears — this one has an **Open** button at the bottom. Click **Open**.
5. The app launches. You won't see this warning again.

### Method B — System Settings (for newer macOS versions)

1. Try to open the app by double-clicking it. The warning appears and you close it.
2. Open **System Settings** (Apple menu → System Settings).
3. Click **Privacy & Security** in the sidebar.
4. **Scroll all the way down** to the bottom of the Privacy & Security page — past all the other settings. There will be a message:

   > "ProChurchCenter Present" was blocked to protect your Mac.
   > [ Open Anyway ]

5. Click **Open Anyway**. Enter your password when prompted.
6. A final confirmation dialog appears — click **Open**.

> **Heads up**: On macOS Sonoma and later, the "Open Anyway" button is sometimes below the visible area of Privacy & Security. **You have to scroll down inside that page.** If you don't see it, resize the window taller or scroll with your mouse/trackpad until the message appears.

### Method C — Terminal (if neither A nor B works)

If macOS has put the app in "damaged" state and refuses to open it even with right-click, run this command in Terminal:

```bash
xattr -cr "/Applications/ProChurchCenter Present.app"
```

This strips the "downloaded from internet" quarantine flag that's confusing macOS. After running the command, open the app normally — no warning will appear.

To open Terminal: press **⌘ + Space**, type "Terminal", press Enter. Then paste the command above and press Enter.

---

## 4. Install on Linux

### Step 1 — Make the AppImage executable

Open a terminal in the folder where you downloaded the file and run:

```bash
chmod +x prochurchcenter-present-*.AppImage
```

Or right-click the file → **Properties** → **Permissions** tab → check **"Allow executing file as program"**.

### Step 2 — Run it

Double-click the AppImage, or run from terminal:

```bash
./prochurchcenter-present-*.AppImage
```

The app launches directly — no installation, no elevated permissions needed. To uninstall, just delete the file.

---

## Why am I seeing a security warning?

When you download an app from the internet, Windows and macOS check whether the developer has paid for an **official signing certificate** that proves the app hasn't been tampered with. These certificates cost money (Apple charges $99/year, Microsoft several hundred dollars per year).

ProChurchCenter Present is currently in early release and we haven't purchased those certificates yet. The warnings **do not mean the app is dangerous** — they just mean the operating system can't automatically verify who built it.

**We're working on code-signing for a future release.** Once it's in place, you'll be able to install the app with no warnings at all.

In the meantime:

- Only download from the **official releases page**: [github.com/kalib-code/prochurchcenter-present/releases](https://github.com/kalib-code/prochurchcenter-present/releases)
- Don't trust installers you got from anywhere else.
- If you're worried, ask your pastor or church tech team to install it for you.

---

## Having trouble?

- **"The app is damaged and can't be opened" (macOS)** — use Method C above (`xattr -cr`) to strip the quarantine flag.
- **Antivirus is deleting the installer** — this is a false positive because of the missing certificate. Add an exception for the downloads folder, or temporarily disable real-time protection while you install.
- **"Can't find Open Anyway button"** — scroll down inside Privacy & Security on macOS, or use Method A (right-click Open) instead. It's more reliable.
- **Still stuck?** Open an issue on GitHub: [github.com/kalib-code/prochurchcenter-present/issues](https://github.com/kalib-code/prochurchcenter-present/issues) — describe your operating system and what you see on screen, and we'll help.

---

## After installing

- Your songs, setlists, and settings are stored locally on your computer — nothing is uploaded.
- The app automatically backs up your library every 24 hours (7 most recent kept). You can also create manual backups from **Settings → Data**.
- **Windows & Linux**: auto-update works. When a new version ships, the app downloads it in the background and prompts you to restart.
- **macOS**: auto-update is temporarily unavailable until we finish Apple notarization. **Mac users need to re-download the DMG manually from the [releases page](https://github.com/kalib-code/prochurchcenter-present/releases/latest) and re-drag the new version into Applications.** Your songs and settings are preserved across reinstalls. You can check your current version anytime from **Settings → About**.
