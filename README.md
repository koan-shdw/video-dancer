# Video Dancer

A local-first desktop editor for AI-generated video. Author clips as prompt "recipes," render them
on your own fal.ai account, and arrange the results on a Premiere-style timeline with music and
mp4 export. Your projects, renders, and API keys stay on your machine.

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

- **New** project (top-left) → pick a folder. Everything for the project lives there.
- **Library**: import reference images / music (or drag files in).
- **Bin**: **+ New clip** → write a prompt in the **Clip Editor** → **▶ Render** (a "take").
- Drag clips onto the **Timeline**; trim, slice, reorder, add a music track; **⬆ Export** to mp4.
- Press **?** anytime for the full shortcut + gesture cheat-sheet.

### Hit a bug?

**About** (click the "Video Dancer" logo) → **open the log folder**, and send `main.log`. It records
errors, crashes, and what the app was doing.

### Known beta limitations

- Unsigned installers (the warnings above).
- No automatic updates yet — grab new builds from Releases.
- Image Editor drawing/guide tools and timeline transitions are not built yet.

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
git push && git push --tags   # the tag triggers the Win + macOS build → draft Release
```

API keys are never stored in the repo or project folders — only in Electron `userData/settings.json`
on the local machine.
