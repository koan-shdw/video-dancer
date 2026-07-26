# Video Dancer

A local-first desktop editor for AI-generated video, built **storyboard-first**: you write each
shot as a structured plan (beats, characters, references), render takes on top of the plan on your
own fal.ai account, edit results with plain words (vid2vid), and cut everything on a Premiere-style
multi-track timeline with music, dissolves and mp4 export. Your projects, renders, and API keys
stay on your machine.

![the workspace](docs/img/workspace.png)

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
3. (Optional) a fal **admin** key shows your credit balance in the header, and the **SPND** chip
   next to it tracks what this project has spent — click it for a per-render cost breakdown.

A banner reminds you until a key is saved. **Costs are yours** — each render/generation bills your fal
account at fal's rates.

### 3. First steps

The first launch walks you through the API setup and a short tour of the panels (replay both
anytime from **About**).

- **New** project (top-left) → pick a folder. Everything for the project lives there. **Open**
  shows your recent projects as a grid — click one to jump back in:

  ![recent projects](docs/img/open-grid.png)

- **Library**: import reference images / music (or drag files in). **watch folder** points at any
  external folder (Forge outputs, downloads) — it opens as its own **Watched** panel with the newest
  images live, and dragging one into the Library imports it. Right-click images to make clips from
  them, select several and drag them anywhere — including straight onto the timeline.
- **Bin**: **+ New clip** → write the storyboard in **Clip Gen** → **▶ Render** (a "take").
- Drag clips onto the **Timeline**; trim, slice, stack tracks, add music; **⬆ Export** to mp4.
- **Snapshots** (💾): save a named state of the whole project and come back to it later — the
  working copy stays where you are.
- Press **?** anytime for the full shortcut + gesture cheat-sheet — every gesture below is on it.

### 4. Write clips as storyboards (Clip Gen)

A clip isn't a prompt string — it's a plan. Scene fields, characters, and **beats**: the shot-by-shot
storyboard (camera / action / lighting / sfx, each with its own length) that becomes the
`cinematic_storyboard` the model receives. The colored beat bar is the movie; you'll see the same
colors again on every timeline block.

![clip gen](docs/img/clipgen.png)

- **Beats**: drag boundaries to retime, **＋ beat** to add, right-click to delete, double-click to
  edit fields. Each beat can carry a **reference graphic** — a placeholder image the model receives
  as a general ref without polluting the prompt text.
- **References**: @-mention Library images in any field, or attach them as refs. The **S-B** slot
  marks which ref is the storyboard face for the clip.
- **Character links**: any character field can live-link to another clip's character — or to a
  **char sheet**, a standalone image + description that defines a character once for the whole
  project:

  ![char sheet](docs/img/charsheet.png)

- **Styles**: project-wide style blocks (look, production notes, lighting…) pinned into every
  prompt from the **Project Styles** panel.

### 5. Takes

Every render lands as a **take** — an immutable video plus the exact recipe (beats/refs/settings)
frozen at render time.

![take cards](docs/img/takecards.png)

- Click a card = keeper ★ (or, when you're editing a timeline slot, sets that slot's take).
- **Right-click a card** = color-highlight it, **disable** it as a dud (dimmed everywhere, skipped
  by the automatic keeper fallback), or send it to AI editing (v2v).
- **Drag a card onto any field** to restore that field from the take's frozen recipe — or drag it
  to the Bin to fork a whole new clip from that recipe.
- **S-B** is always the first card: the live storyboard, one click away from any take.

### 6. The Clip Monitor

Double-click a clip (Bin or timeline block) and it opens in the **Clip Monitor**: scrub it, switch
takes from the dropdown (S-B included), see the beat bar with the live beat readout, and grab
**⊢ first / last ⊣** frames straight into the Library.

![clip monitor](docs/img/monitor.png)

### 7. The timeline

Premiere-grade editing on top of the storyboard model — every block wears its clip's beat colors,
and a block with no renders yet plays as its storyboard.

![timeline](docs/img/timeline.png)

- **Tracks**: multiple video tracks (+V adds, ✕ deletes empty ones), per-track mute / solo / lock.
  Gaps are allowed; the topmost track wins.
- **Audio always visible**: linked clip audio rides its block (blue, on the lane matching its video
  track) — right-click to unlink it onto a lane as a free green block with its own trims, gain and
  fades. Plus dedicated music lanes.
- **Smooth playback**: double-buffered player preloads every cut; what you scrub is what exports.
- **Editing**: free drag with snapping (Shift bypasses, snap flashes), **dropping on clips
  overwrites them Premiere-style** (split / trim / vanish), Alt-drag duplicates, marquee group
  select, **A** = select-forward tool, click a gap to select it and **Del** ripple-closes it,
  ripple delete on blocks, rolling trims (Ctrl on a flush edge), **S** slice / **Ctrl+K** razor at
  the playhead, per-block **speed** (0.25–4×), **0.5s cross-dissolves**, copy/paste
  (**Ctrl+V** ripple-inserts at the playhead; right-click a track → **paste here** drops with no
  ripple), frame nudges with ←/→, **J/K/L**, **M** markers, **I/O** in/out range (loops playback,
  windows the export), wheel pans / Ctrl+wheel zooms at the cursor, safe-area guides, and a
  full-height playhead.
- **⬆ Export** composites exactly what you see — tracks, gaps (black), dissolves, speed, audio
  lanes with gain/fades, music — to mp4. An in/out range exports just that window.

### 8. Co-Director

A conversational copilot that reads the whole project and writes into it — beats, fields, refs,
styles — with every change tinted until you accept it. @-mention Library images and it sees the
actual pictures. Type while it thinks; queue follow-ups.

![co-director](docs/img/codirector.png)

Runs on your Anthropic API key by default; **Settings → experimental** can switch it to a
**Claude Code bridge** that drives your own installed Claude Code (subscription login) instead.
Its guide files (the prompting bibles it follows) are editable per-user with load toggles.

### 9. Edit a video with words (v2v)

Made something that's *almost* right? Don't re-roll — edit it.

- **⑂** on a take (or right-click → edit with AI) opens **Clip Edit** with that take as the source.
- Slide the window to the part you want changed (edits take up to 10s at a time), type the change —
  *"Remove the ball. Keep everything else the same."* — and **▶ Generate edit**.
- Nothing lands in the Bin until the edit actually generates; your first edit forks a new **⑂ clip**
  with its own takes. The original take is never touched, so re-roll, chain edits on edits, or point
  a timeline slot at whichever version wins.
- Runs on **Gemini Omni Flash** (words only — no reference images on edits). Everything it makes
  comes back **720p, 16:9, 24fps** with fresh audio, whatever you feed it. Powered by your fal key,
  roughly $0.14/sec (input + output).

### 10. The Queue

Every render and edit lines up in the **Queue** panel and runs one at a time — stack as many as you
like and walk away.

- The running job streams its live fal status; waiting jobs show the clip, engine and estimated cost.
- **↑↓** reorder what's waiting, **⏸ pause** holds the line, **✕** cancels — pending jobs are free
  to kill; a running job is already billing, so cancelling it is best-effort.
- Results drop into the Bin in order, whether or not you're watching. If the app dies mid-render,
  the finished video is **rescued on the next launch** — fal renders you paid for are not lost.

### 11. Make it yours

- **Themes** (⚙ Settings): OG VDancer, DECK (neon green), WINTERMUTE (steel blue), FUCKUP (70s
  burnt orange) — or **customize colors** live and save your own.
- **Workspaces** (header dropdown): save and switch whole panel layouts.
- **Window ▾**: every panel listed, closed ones reopen from here. **🖥** on the timeline mirrors
  playback fullscreen to a second display.
- **Image Editor**: double-click any Library image — variants tree, AI edits, a **✏ draw layer**
  (pen marks guide the model, sent only while visible), and grow-canvas resizing.

### 12. Getting clips out

- **⬆ Export** on the Timeline renders the sequence to mp4 (honors the I/O range).
- One clip? **Right-click it in the Bin → export video…**, or just **alt-drag** it onto your desktop
  or any folder — the file copies out, the original stays in the project.

### Hit a bug?

**About** (click the "Video Dancer" logo) → **open the log folder**, and send `main.log`. It records
errors, crashes, and what the app was doing.

### Known beta limitations

- Unsigned installers (the warnings above).
- Windows auto-updates silently (checks on launch + every 3h; applies on restart). macOS is unsigned, so Mac testers grab each new build from Releases manually.
- Exported cross-dissolves render as a quick fade-dip; the in-app monitor previews the true
  crossfade. (A real ffmpeg xfade is on the list.)
- **J** jumps back 5s rather than true reverse shuttle.
- v2v edits always come back 720p / 16:9 / 24fps (the model's fixed output) — editing a 1080p or
  vertical clip means a downscale/reframe. Sources longer than 10s are windowed, not sent whole.
- Jobs still *waiting* in the Queue don't survive an app restart (a render already sent to fal is
  rescued).

---

## For developers

Electron 31 + React + TypeScript (electron-vite). Video export uses bundled
[FFmpeg](https://ffmpeg.org) (GPL) via [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static);
see the in-app **About** box for attribution. `docs/WORKFLOW.md` is the meaning-level map of the
app — read it before touching UX.

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
