# Video Dancer

A local-first desktop editor for AI-generated video. Author clips as prompt "recipes," render them
on your own fal.ai account, edit the results with plain words (vid2vid), and arrange everything on
a Premiere-style timeline with music and mp4 export. Your projects, renders, and API keys stay on
your machine.

---

## For beta testers

### 1. Install

Download the installer for your platform from the latest [Release](../../releases) and run it.

**Windows** — `Video Dancer Setup x.y.z.exe`. Windows SmartScreen will warn ("Windows protected your
PC") because the app isn't code-signed yet. Click **More info → Run anyway**. (One-time.)

**macOS** — `Video Dancer-x.y.z.dmg`. The app isn't notarized yet, so Gatekeeper blocks it on first
launch. Either:
- **Right-click the app → Open**, then click **Open** in the dialog, **or**
- open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.

(One-time per machine. Both warnings are expected for an unsigned beta — nothing is wrong.)

### 2. Add your fal.ai key (required)

Rendering and image generation run on **your** [fal.ai](https://fal.ai) account — you pay fal directly
for what you generate. There is no shared/bundled key.

1. Get a key at fal.ai → **Settings → Keys** (format `id:secret`).
2. In Video Dancer: **⚙ Settings → fal API key → paste → Save**.
3. (Optional) a fal **admin** key shows your credit balance in the header.

A banner reminds you until a key is saved. **Costs are yours** — each render/generation bills your fal
account at fal's rates.

### 3. First steps

The first launch walks you through the API setup and a short tour of the panels (replay both
anytime from **About**).

- **New** project (top-left) → pick a folder. Everything for the project lives there.
- **Library**: import reference images / music (or drag files in). **watch folder** points at any
  external folder (Forge outputs, downloads) — it opens as its own **Watched** panel with the newest
  images live, and dragging one into the Library imports it.
- **Bin**: **+ New clip** → write a prompt in the **Clip Gen** panel → **▶ Render** (a "take").
- Drag clips onto the **Timeline**; trim, slice, reorder, add a music track; **⬆ Export** to mp4.
- Press **?** anytime for the full shortcut + gesture cheat-sheet.

### 4. Edit a video with words (v2v)

Made something that's *almost* right? Don't re-roll — edit it.

- Hit **⑂** on a take (in **Clip Gen**'s take strip, or straight on a timeline block) → the
  **Clip Edit** panel opens with that take as the source.
- Slide the window to the part you want changed (edits take up to 10s at a time), type the change —
  *"Remove the ball. Keep everything else the same."* — and **▶ Generate edit**.
- Nothing lands in the Bin until the edit actually generates; your first edit forks a new **⑂ clip**
  with its own takes. The original take is never touched, so re-roll, chain edits on edits, or point
  a timeline slot at whichever version wins.
- Runs on **Gemini Omni Flash** (words only — no reference images on edits). Everything it makes
  comes back **720p, 16:9, 24fps** with fresh audio, whatever you feed it. Powered by your fal key,
  roughly $0.14/sec (input + output).

### 5. The Queue

Every render and edit lines up in the **Queue** panel and runs one at a time — stack as many as you
like and walk away.

- The running job streams its live fal status; waiting jobs show the clip, engine and estimated cost.
- **↑↓** reorder what's waiting, **⏸ pause** holds the line (the running job always finishes),
  **✕** cancels — pending jobs are free to kill; a running job is already billing, so cancelling it
  is best-effort.
- Results drop into the Bin in order, whether or not you're watching.

### 6. Make it yours (themes)

**⚙ Settings → theme**: keep **OG VDancer**, jack in with **DECK** (neon green), cool it down with
**WINTERMUTE** (steel blue), or go full shag-carpet with **FUCKUP** (70s burnt orange). Or hit
**customize colors** — every color in the app is editable with live preview — and save the result
as your own named theme.

### 7. Getting clips out

- **⬆ Export** on the Timeline renders the whole sequence to mp4.
- One clip? **Right-click it in the Bin → export video…**, or just **alt-drag** it onto your desktop
  or any folder — the file copies out, the original stays in the project.

### Hit a bug?

**About** (click the "Video Dancer" logo) → **open the log folder**, and send `main.log`. It records
errors, crashes, and what the app was doing.

### Known beta limitations

- Unsigned installers (the warnings above).
- Windows auto-updates silently (checks on launch + every 3h; applies on restart). macOS is unsigned, so Mac testers grab each new build from Releases manually.
- Image Editor drawing/guide tools and timeline transitions are not built yet.
- v2v edits always come back 720p / 16:9 / 24fps (the model's fixed output) — editing a 1080p or
  vertical clip means a downscale/reframe. Sources longer than 10s are windowed, not sent whole.
- The Queue lives in memory: jobs still waiting when you quit the app don't survive the restart.

---

## For developers

Electron 31 + React + TypeScript (electron-vite). Video export uses bundled
[FFmpeg](https://ffmpeg.org) (GPL) via [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static);
see the in-app **About** box for attribution.

```bash
npm install
npm run dev          # launch the app in dev
npm run typecheck    # tsc --noEmit
npm run build        # bundle main/preload/renderer (electron-vite)
npm run dist:win     # package a Windows installer  → dist/
npm run dist:mac     # package a macOS dmg (run on macOS) → dist/
```

Releases are built by GitHub Actions on a version tag (see `.github/workflows/release.yml`):

```bash
npm version patch             # bumps package.json + creates a git tag
git push --follow-tags        # the tag triggers the Win + macOS build → public Release on koan-shdw/video-dancer
```

API keys are never stored in the repo or project folders — only in Electron `userData/settings.json`
on the local machine, encrypted at rest with the OS keychain (safeStorage).
