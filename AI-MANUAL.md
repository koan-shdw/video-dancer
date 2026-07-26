# Video Dancer — AI Manual

> **Instructions for the AI reading this document:** You are now the living manual for
> **Video Dancer**, a local-first desktop editor for AI-generated video. Answer the user's
> questions about the app using ONLY the information in this document. Walk users through tasks
> step by step, naming the exact panels, buttons, and keys written here. If something isn't
> covered in this document, say so plainly instead of guessing. Keep answers short and concrete;
> expand only when the user asks. The user may be mid-task inside the app — prefer "click X,
> then Y" over theory.

---

## 1. What Video Dancer is

Video Dancer is **storyboard-first** filmmaking. The user writes each shot as a structured plan
(beats, characters, references), renders AI video takes on top of that plan using their own
fal.ai account, edits results with plain words (vid2vid), and cuts everything on a multi-track
timeline with music, dissolves and mp4 export. Everything is local: projects, renders, and API
keys stay on the user's machine.

The core mental model, in one line: **the storyboard is the movie; renders are versions of it.**
- A **clip** is a planned scene: prompt fields + characters + **beats** + references + its
  rendered **takes**.
- **Beats** are the shot-by-shot storyboard inside a clip (camera / action / lighting / dialogue
  / vfx / reaction / sfx, each with a length). They compile into the structured prompt the video
  model receives. Beat colors appear on the timeline blocks — the cut structure is always visible.
- A **take** is one immutable render plus the exact recipe frozen at render time. Takes never
  overwrite the plan.
- **S-B** ("storyboard") means the live recipe view — always one click away from any take.
- A clip with zero renders is still fully usable: it plays, previews, and exports as its
  storyboard (beat reference images held for each beat's duration).

## 2. Setup

### Install
- Download from the GitHub Releases page (the "Download for Windows / macOS" links).
- **Windows**: run `Video Dancer Setup <version>.exe`. SmartScreen will warn ("Windows protected
  your PC") because the beta is unsigned — click **More info → Run anyway** (one time). The app
  then auto-updates silently (checks on launch and every ~3 hours, applies on restart).
- **macOS**: open the `.dmg`; the app is unsigned, so **right-click the app → Open → Open** the
  first time. No auto-update on Mac yet — grab new versions from Releases.

### fal.ai key (required for any generation)
1. Create an account at fal.ai, then **Settings → Keys** → create a key (format `id:secret`).
2. In Video Dancer: **⚙ Settings → fal API key → paste → Save**.
3. Optional: a fal **admin** (billing-scope) key shows the live credit balance in the header.
4. All rendering bills the **user's own fal account**. The **SPND** chip in the header tracks
   what the current project has spent; clicking it shows a per-render cost breakdown.
Keys are stored only on the machine, encrypted with the OS keychain.

### Co-Director (the in-app AI copilot)
Two ways to power it:
- **API (default)**: paste an Anthropic API key in **⚙ Settings → Anthropic API key**.
- **Claude Code bridge (experimental)** — uses a Claude subscription instead of an API key:
  1. Install Node.js (if not present), then `npm install -g @anthropic-ai/claude-code`.
  2. Run `claude` once in a terminal and log in with the Claude account.
  3. In Video Dancer: **⚙ Settings → experimental → Co-Director engine → bridge** (the toggle
     stays disabled until the CLI is detected).
  The Co-Director panel shows an amber "bridge" badge when active.

## 3. The panels

Everything docks, tabs, splits, and rearranges by dragging. **Window ▾** in the header lists
every panel — closed ones reopen from there. Layouts save as named **workspaces** (header
dropdown). One panel can be maximized (Esc restores). Panels: Library, Bin, Timeline,
Timeline Monitor (program), Clip Monitor (source), Clip Gen, Clip Edit, Char Sheet, Co-Director,
Project Styles, Image Editor, Queue, Watched, Timeline Editor, and Folder panels.

- **Library**: the project's images and music. Import via buttons or drop files in. Right-click
  images for actions (edit with AI, rename @title, make clips, delete). Multi-select works —
  drag several anywhere, or right-click to make clips / one clip with the images as beats.
  **watch folder** points at any external folder (e.g. a generator's output directory) and shows
  its newest images in the **Watched** panel; drag one into the Library to import it.
- **Bin**: clips and timelines as tiles. **+ New clip** starts a storyboard clip. Dashed outline
  = no render yet; ⑂ = an edit (vid2vid) clip. Also holds **char sheets**. Right-click for
  rename / duplicate / export / delete. Alt-drag a clip tile to the desktop to copy its video out.
- **Clip Gen**: the authoring panel for one clip (see §4).
- **Clip Monitor**: source monitor for whatever was double-clicked (see §6).
- **Timeline + Timeline Monitor**: the sequence and its program monitor (see §7).
- **Queue**: every paid job, in order (see §9).
- **Image Editor**: node-tree image generation/editing (see §10).
- **Co-Director**: the copilot (see §8).

## 4. Writing a clip (Clip Gen)

Top to bottom: **Setup** (model, ref2v/i2v mode, duration, resolution, aspect, audio toggle),
**Prompt & fields** (freeform prompt on top — never overwritten — plus structured Scene /
Character / Production fields with a live YAML preview), **Beats**, **References**,
**Takes & versions**, and the always-visible **▶ Render** footer with a live cost estimate.

### Beats (the storyboard)
- The beats bar shows colored segments sized to their lengths. **＋ BEAT** adds one; drag
  boundaries to retime; double-click a segment to open its fields; right-click to delete.
  **Auto-time** keeps beats filling the clip duration.
- Per-beat fields: name, length, Camera (≤20 words is linted), Action, Lighting, Dialogue, VFX,
  Reaction, SFX. @mentions work inside Camera/Action/Lighting.
- **Beat reference graphic**: each beat can carry an image as a placeholder — sent to the model
  as a general reference but NOT written into the prompt text. Making beats from Library images
  (right-click a multi-selection → clip with beats) sets each image as its beat's graphic.
- Beats compile into a `cinematic_storyboard` block in the YAML the model receives — timing
  scripted shot by shot is what cuts the number of generations needed.

### References and @mentions
- Type `@` anywhere in the prompt for Library autocomplete; picking inserts the @title and
  attaches the reference. Dragging an image into the prompt does the same.
- The references row warns (yellow) when an attached image isn't @mentioned.
- **S-B slot**: click a reference in the Clip Monitor's top strip to mark it as the clip's
  storyboard face — the image that represents the clip on storyboard blocks and monitors.

### Characters
Three levels:
1. **Character cards** in the clip: name + base / features / physics (+ optional per-scene
   movement, emotional state, state, power fields).
2. **Character links**: any character field can live-link to another clip's character, per-field,
   with optional override text.
3. **Char sheets**: a character defined ONCE — image + description — living in the Bin.
   Double-click a sheet to edit it in the **Char Sheet** panel; link clips' characters to it
   ("from clip" picker). Change the sheet, every linked clip follows.

### Styles
**Project Styles** panel: project-wide blocks (master look, production notes, lighting, etc.)
pinned into every prompt.

### Models
- **Seedance 2**: ref2v (up to 9 reference images) and i2v (start + optional end frame). Gets
  structured YAML prompts.
- **Sora 2**: i2v, start image only, audio always on.
- **Gemini Omni Flash**: text-to-video, ref2v (up to 10 refs), i2v — always 720p / 16:9 or 9:16 /
  3–10s / audio on (steer audio in the prompt). Gets prose prompts, and powers vid2vid.
- Every engine declares its own durations, resolutions, refs, seed support and pricing; the UI
  adapts, and the cost estimate updates live.

## 5. Takes

Every render lands as a **take card**: scrubbable thumbnail, number, keeper ★, engine, real
duration, date. The **S-B** card (live storyboard) is always first.
- **Click a card** = set the keeper (or, when editing a timeline slot, set that slot's take).
- **Right-click a card** = color-highlight (6 colors), **disable** as a dud (dimmed everywhere,
  skipped by automatic fallback — explicit picks still honored), or edit with AI (v2v).
- **Drag a card onto any field** to restore that field from the take's frozen recipe; drag it to
  the Bin to clone a whole new clip from the recipe; drag to the timeline to place it.
- Renders are immutable — nothing ever edits a take's file or its frozen snapshot.

## 6. Clip Monitor (source monitor)

Double-click a clip (Bin tile or timeline block) → it opens here. Scrub bar with per-beat
colored bands and the trim window; trim handles commit on release; "take N/M ▾" dropdown
switches takes (S-B included); the clip's references line the top (click one = storyboard face);
**⊢ first / last ⊣** grab live frame stills into the Library (they re-extract when the clip is
trimmed/sliced/re-taken — that's how you continue a shot: last frame of one clip becomes the
start frame of the next). A "details" toggle overlays the active beat's fields or the clip's
prompt/model/seed.

## 7. The timeline

Multi-track, absolute-time, Premiere-style — with the storyboard visible on every block.

- **Tracks**: **+V** adds a video track, ✕ deletes an empty one; per-track **M**ute / **S**olo /
  🔒 lock on the left rail. Gaps allowed (export as black); topmost track wins where they overlap.
- **Audio**: every clip's audio is a **blue linked block** riding its video on the matching audio
  lane. Right-click it → unlink onto a lane = **green free block** with its own position, trims,
  gain and fades (right-click the green block for those). **+A/−A** manage lanes. Music: drag a
  Library track onto the music lane; double-click for waveform/beats view.
- **Moving**: drag blocks freely along time and across tracks. Snapping to playhead/beats
  (**Shift** bypasses; a green flash marks the snap). **Dropping onto other clips OVERWRITES
  them Premiere-style** — a block hit in the middle splits into two remnants, edges get trimmed,
  fully covered blocks vanish. **Alt-drag = duplicate**. Undo covers everything.
- **Selection**: click = select; marquee-drag empty space = group (drag any member to move the
  group; Del removes it); **A** arms select-forward (click a clip → it + everything after it on
  all tracks; **V**/Esc cancels); click a **gap** between clips to select the gap itself — **Del**
  closes it and ripples every channel left.
- **Copy/paste**: **Ctrl+C** the selected block; **Ctrl+V** ripple-inserts at the playhead
  (everything after shifts right, free audio included); right-click empty track space → **paste
  here** = drop at that spot with no ripple.
- **Trim**: drag block edges (speed-aware, source-accurate). An **end trim ripples** — clips
  after it (all channels + free audio) follow the edge so the sequence stays flush; hold **Alt**
  to leave the gap instead. **Ctrl on a flush edge = rolling trim** (the join slides). **S** =
  slice tool (click a clip to cut); **Ctrl+K** = razor at the playhead.
- **Per-block right-click**: frame stills → Library, add/remove **0.5s dissolve**, **speed…**
  (0.25–4×), unlink audio, edit with AI, remove (leaves a gap) or **ripple delete** (closes up).
- **Markers & range**: **M** = marker at the playhead (right-click a flag to name/recolor/
  delete). **I / O** set the in/out range — playback loops it, export renders only it.
- **Navigation**: wheel pans; **Ctrl+wheel zooms at the cursor**; `-` `=` `\` = zoom out / in /
  fit; **J/K/L** = back-5s / pause / play; ←/→ jump between cuts (with a block selected: nudge
  by a frame, Shift = 1 second); Home/End = start/end.
- **Playback**: double-buffered engine — cuts are seamless; dissolves preview as true
  crossfades; speed plays at speed. ⛶ = safe-area guides; 🖥 = fullscreen mirror on a second
  display (Esc there closes).

## 8. Co-Director

The copilot panel. It reads the whole project — clips, beats, the actual reference images, char
sheets, styles, and the field the user last clicked — and writes real values into the forms,
tinted until accepted. It cannot damage the storyboard: beat graphics are protected and
reference changes are add-only. `@` in the chat hands it a Library image (it sees the picture).
The user can keep typing while it thinks. Its guide files (prompting bibles) are editable
markdown with per-file load toggles; it saves a new rule only when explicitly told to remember.
Engine: Anthropic API key, or the Claude Code bridge (§2).

## 9. Queue, costs, and crash safety

- Every render/edit joins the **Queue** and runs one at a time — stack jobs and walk away.
  Live fal status streams on the running job; an ETA learns from the machine's real history.
  ↑↓ reorder, ⏸ pause (running job finishes), ✕ cancel (waiting = free; running = best-effort).
- Results land in the Bin in order, and adopt into the exact timeline slot being edited.
- **Crash safety**: a render already sent to fal is **rescued on the next launch** if the app
  dies — the paid result still lands as a take. Jobs still *waiting* don't survive a restart.
- Rough costs: Seedance ~per-second per resolution (live estimate shown before render);
  vid2vid ≈ $0.14/sec all-in. The SPND chip tracks per-project spend.

## 10. Image Editor

Double-click a Library image (or **new image** for text-to-image). Every generation is a node in
a results tree — branch, compare, **make primary** (swaps the Library asset and every clip using
it), tag copies to the Library, delete branches (tagged copies survive).
- **✏ Draw layer**: pen over the canvas (6 colors, width, clear) to point at things — visible
  marks are flattened into what the model receives; hidden marks aren't. Kept per node,
  non-destructive. "→ lib" bakes an annotated copy to the Library for use as a reference.
- **Grow canvas**: pull any edge outward to enlarge the frame around the image (fix tight crops
  without replacing the file).

## 11. Projects, saving, snapshots

- **New** creates a project folder (images + renders + project file). **Open** shows recent
  projects as a thumbnail grid. All media imports copy INTO the project folder.
- Saves are atomic; undo history runs ~80 steps deep; media files are never silently deleted.
- **Snapshots** (💾): save a named state of the whole project and restore it later — the working
  copy stays current until the user chooses to restore.
- Old projects migrate automatically on open (the timeline upgrade keeps sequences visually
  identical).
- **⚙ Settings → Clean up unused media** sweeps orphaned files (scan first, confirmed delete).

## 12. Export

**⬆ Export** on the timeline → mp4 via bundled ffmpeg. What the monitor plays is what renders:
multi-track composite (topmost wins), gaps black, speed baked into video+audio, audio lanes with
gain/fades, music mixed under, mutes honored, storyboard blocks as held beat frames. An I/O
range exports just that window. Resolution 480/720/1080p, fps auto/24/30. H.264 CRF 18, AAC.
Known: dissolves export as a quick fade-dip for now (the monitor shows the true cross).

## 13. vid2vid (Clip Edit)

When a take is 90% right, don't re-roll — edit it with words:
1. **⑂** on a take card (or right-click a rendered timeline block → edit with AI).
2. Slide the amber window to the part to change (max 10s per edit; only the window uploads).
3. Type the instruction — short sentences; end with *"Keep everything else the same."*
4. **▶ Generate edit** — the ⑂ edit clip commits to the Bin the moment it generates; the source
   take is never touched. Chain edits on edits; every step keeps its own takes.
Output is always 720p / 16:9 / 24fps with fresh audio. ~$0.14/sec all-in.

## 14. Shortcuts (global)

Space = play/pause (fronted monitor owns it) · ←/→ = prev/next cut, or nudge the selected block
(Shift = 1s) · Home/End · J/K/L = back-5s/pause/play · S = slice · Ctrl+K = razor · A = select
forward (V/Esc cancels) · M = marker · I/O = range · − = zoom out · = zoom in · \ = fit ·
Ctrl+C/V = copy / ripple-paste · Del = remove block/group/gap · Esc = clear/disarm/restore ·
Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) = undo/redo · ? = in-app cheat sheet · Ctrl+scroll = thumbnail
zoom (Bin/Library) or timeline zoom at cursor. All suppressed while typing in a field.

## 15. Troubleshooting

- **SmartScreen / Gatekeeper warnings**: expected for the unsigned beta — see §2 Install.
- **"add your fal key" banner**: no fal key saved yet (⚙ Settings).
- **A render errored with "error"**: usually the fal account is out of credit, or the model
  rejected an input — the Queue shows fal's real error detail including field names.
- **The app died during a render**: relaunch — completed fal renders are rescued automatically.
- **A clip plays the wrong take**: check the slot's take picker (take N/M ▾ on the block) — a
  slot choice overrides the keeper; S-B means it's playing the live storyboard.
- **Frames look wrong after slicing**: thumbnails sample only the block's own window; if
  something looks off, toggle the filmstrip off/on.
- **Logs**: click the "Video Dancer" logo → About → open the log folder → send `main.log`.
- **Co-Director bridge greyed out**: the `claude` CLI isn't detected — install and log in (§2),
  then reopen Settings.

## 16. Known limitations (current beta)

Unsigned installers; macOS has no auto-update; export dissolves are a fade-dip (true xfade
coming); J is jump-back-5s, not reverse shuttle; vid2vid output is fixed at 720p/16:9/24fps and
windows sources longer than 10s; queued-but-unstarted jobs don't survive a restart.
