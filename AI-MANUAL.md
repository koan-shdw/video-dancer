# Video Dancer AI Manual

> **Instructions for the AI reading this document:** You are now the living manual for
> **Video Dancer**, a local-first desktop editor for AI-generated video. Answer the user's
> questions about the app using ONLY the information in this document. Walk users through tasks
> step by step, naming the exact panels, buttons, and keys written here. If something isn't
> covered in this document, say so plainly instead of guessing. Keep answers short and concrete;
> expand only when the user asks. The user may be mid-task inside the app. Prefer "click X,
> then Y" over theory.

*Covers Video Dancer v0.9.0 (2026-08-13).*

---

## 1. What Video Dancer is

Video Dancer is **storyboard-first** filmmaking. The user writes each shot as a structured plan
(beats, characters, references, including their own footage and music), renders AI video takes
on top of that plan through their own supplier account, edits results non-destructively with
plain words (vid2vid), and cuts everything on a multi-track timeline with music, effects,
dissolves and mp4 export. Everything is local: projects, renders, and API keys stay on the
user's machine.

The core mental model, in one line: **the storyboard is the movie; renders are versions of it.**
- A **clip** is a planned scene: prompt fields + characters + **beats** + references + its
  rendered **takes**.
- **Beats** are the shot-by-shot storyboard inside a clip (camera / action / lighting / dialogue
  / vfx / reaction / sfx, each with a length). They compile into the structured prompt the video
  model receives. Beat colors appear on the timeline blocks, so the cut structure is always
  visible.
- A **take** is one immutable render plus the exact recipe frozen at render time. Takes never
  overwrite the plan.
- **S-B** ("storyboard") means the live recipe view, always one click away from any take.
- A clip with zero renders is still fully usable: it plays, previews, and exports as its
  storyboard (beat reference images held for each beat's duration).
- The loop that makes the app what it is: any video (imported footage or a finished take) can
  ride into the next render as a reference (@video slots), and any video can be edited with
  words in the Video Editor. Generate, refine, re-reference, repeat.

## 2. Setup

### Install
- Download from the GitHub Releases page (the "Download for Windows / macOS" links).
- **Windows**: run `Video Dancer Setup <version>.exe`. SmartScreen will warn ("Windows protected
  your PC") because the beta is unsigned. Click **More info → Run anyway** (one time). The app
  then auto-updates silently (checks on launch and every ~3 hours, applies on restart). A quiet
  header chip appears only if an update actually fails.
- **macOS**: open the `.dmg`; the app is unsigned, so **right-click the app → Open → Open** the
  first time. No auto-update on Mac yet. Grab new versions from Releases.

### Suppliers (at least one required)
Rendering runs on the user's OWN account at an AI supplier; they pay the supplier directly.
There is no shared or bundled key. The first launch walks through the options with
paste-and-test boxes. **⚙ Settings → API suppliers** shows each supplier as its own card with a
connected chip, a free **test key** button (never spends credits), and a **get a key ↗** link.
Saved keys display as last-4 only. Keys are stored only on the machine, encrypted with the OS
keychain. A banner reminds the user until at least one supplier is connected; any one supplier
unlocks rendering.

- **fal.ai (recommended).** One key powers everything: Seedance 2 (with video and audio
  references), Seedance 2.5 (early access), Sora 2, Omni video edits, and image generation.
  Pay-per-use in dollars. Key at fal.ai → **Settings → Keys** (format `id:secret`). An optional
  fal **admin** (billing-scope) key shows the live $ balance in the header.
- **BytePlus ModelArk.** Seedance 2 direct from ByteDance: image and audio refs, first/last
  frame, 10-bit 4K. Video references are not wired yet (their API wants public URLs; the slots
  say so). Their policy: reference images must not contain real human faces. Token billing via
  console.byteplus.com, so no dollar estimate shows on ModelArk renders. A connected ModelArk
  gets an `ARK ↗` console chip in the header.
- **Astria.** Seedance 2 on Astria plan credits: text-to-video and first/last-frame i2v. No
  reference images over their API.
- **Higgsfield.** Connectable now, but their developer API doesn't serve Seedance yet; the
  engine lights up the day it ships. A connected Higgsfield gets an `HF ↗` chip.

The **SPND** chip in the header tracks what the current project has spent; clicking it shows a
per-render cost breakdown.

### Co-Director (the in-app AI copilot)
Two ways to power it:
- **API (default)**: paste an Anthropic API key in **⚙ Settings → co-director**.
- **Claude Code bridge (experimental)**, which uses a Claude subscription instead of an API key:
  1. Install Node.js (if not present), then `npm install -g @anthropic-ai/claude-code`.
  2. Run `claude` once in a terminal and log in with the Claude account.
  3. In Video Dancer: **⚙ Settings → experimental → Co-Director engine → bridge** (the toggle
     stays disabled until the CLI is detected).
  The Co-Director panel shows an amber "bridge" badge when active.

## 3. The panels

Everything docks, tabs, splits, and rearranges by dragging. **Window ▾** in the header lists
every panel; closed ones reopen from there. Layouts save as named **workspaces** (header
dropdown). One panel can be maximized (Esc restores). Every panel has its own crash boundary, so
one panel failing never takes the app down. Panels: Library, Bin, Timeline, Timeline Monitor
(program), Clip Monitor (source), Clip Gen, Video Editor, Char Sheet, Co-Director, Project
Styles, Image Editor, Queue, Watched, Timeline Editor, and Folder panels. The **Director's
Room** is a full-screen overlay opened from the Co-Director panel header.

- **Library**: the project's images, music, AND videos. Import via buttons or drop files in.
  Right-click images for actions (edit with AI, rename @title, make clips, delete). Multi-select
  works: drag several anywhere, or right-click to make clips / one clip with the images as
  beats. **watch folder** points at any external folder (Comfy's outputs, downloads) and shows
  its newest images in the self-refreshing **Watched** panel; drag one into the Library to
  import it, or straight onto a clip slot to attach it.
- **Library videos**: import with the button or drag video files in (mp4, mov, webm, m4v, mkv,
  avi). Files normalize once to a friendly H.264 if needed. Tiles hover-scrub and carry plain
  titles. Right-click a video: **edit with AI** (opens the Video Editor tree), **make clip**
  (the footage becomes take 1 of a new clip), **add as take** to an existing clip, rename, or
  delete. Or just drag it onto the timeline and the clip is made automatically at the drop
  point.
- **Bin**: clips and timelines as tiles. **+ New clip** starts a storyboard clip. Dashed outline
  = no render yet; ⑂ = a clip born from a video edit. Also holds **char sheets**. Right-click
  for rename / duplicate / export / send to project / delete. Alt-drag a clip tile to the
  desktop to copy its video out.
- **Folders**: nested folders organize clips, images, and char sheets alike. Drag items in,
  right-click to manage, open any folder as its own panel.
- **Clip Gen**: the authoring panel for one clip (see §4).
- **Clip Monitor**: source monitor for whatever was double-clicked (see §6).
- **Timeline + Timeline Monitor**: the sequence and its program monitor (see §7).
- **Video Editor**: THE editing surface for vid2vid (see §11).
- **Queue**: every paid job with live status (see §9).
- **Image Editor**: node-tree image generation and editing (see §10).
- **Co-Director**: the copilot (see §8).

## 4. Writing a clip (Clip Gen)

The panel leads with RESULTS: a big take monitor sits full width at the top, take cards right
under it, and the recipe (fields + beats) one tab over. A clip with nothing rendered yet starts
straight at the fields. The storyboard is still the source of truth; the panel just stops hiding
what you paid for.

- **The take monitor**: a real jogger with timecode, scrubbing, and the take's beat colors
  banding the bar. Set an in/out window with the bracket handles or the **I / O** keys; Space
  plays and pauses while Clip Gen is fronted.
- **Drag the preview out**: onto the timeline it lands as that exact take, trimmed to the in/out
  window; onto the Library it becomes a video ready to ride as a @video ref; reference slots
  take it too.
- **Setup block**: model, render mode (ref2v / i2v), duration, resolution, aspect ratio, and the
  audio toggle. Values come from the model's real capability list; the cost estimate updates
  live. Switching models keeps the inputs.
- **Prompt & fields**: freeform prompt on top (never overwritten), plus structured Scene /
  Character / Production fields with a live YAML preview of exactly what gets sent. The preview
  text is selectable, and **Ctrl+F** while the mouse is over it opens a find bar (match count,
  prev/next arrows, Enter for next, Esc closes).
- **Render footer**: **▶ Render now** and **＋ Queue** (see §9), with the model name and live
  price. Blocked while red validation errors exist, with a tooltip saying what to fix.

### Beats (the storyboard)
- The beats bar shows colored segments sized to their lengths. **＋ BEAT** adds one; drag
  boundaries to retime; double-click a segment to open its fields; right-click to delete.
  **Auto-time** keeps beats filling the clip duration.
- Per-beat fields: name, length, Camera (over 20 words is linted), Action, Lighting, Dialogue,
  VFX, Reaction, SFX. @mentions work inside Camera / Action / Lighting.
- **Beat reference graphic**: each beat can carry an image as a placeholder, sent to the model
  as a general reference but NOT written into the prompt text. Making beats from Library images
  (right-click a multi-selection → clip with beats) sets each image as its beat's graphic.
- Beats compile into a `cinematic_storyboard` block in the YAML the model receives. Timing
  scripted shot by shot is what cuts the number of generations needed.

### References and @mentions
- Type `@` anywhere in the prompt for Library autocomplete; picking inserts the @title and
  attaches the reference. Dragging an image into the prompt does the same.
- The references row warns (yellow) when an attached image isn't @mentioned.
- **@video slots (Seedance)**: up to 3 video references per render. Add Library videos or ANY
  take; each slot wears a positional tag (`@video1`, `@video2`, `@video3`) and the prompt
  directs it: "Continue from @video1", "Match the motion of @video2". Restyle footage, chain
  shots, motion-match a dance clip.
- **@audio slots (Seedance)**: up to 3 music windows as `@audio1…` ("Cut the motion to
  @audio1"). Non-mp3/wav files convert automatically.
- **✂ ref windows**: every video/audio slot has an in/out window; suppliers cap combined
  reference media at 15 seconds, so windows are essential. Slots warn yellow until they are
  @mentioned.
- **Guard rails**: pre-render errors catch over-15s combined, under-2s videos, more than 12
  reference files, audio without any visual ref, and deleted sources, each named by slot.
- Engines without video or audio ref support show the slots greyed with the reason. The data is
  kept, never silently sent.
- Take snapshots freeze video and audio refs too; drag-restoring from a take brings them back.
- **S-B slot**: click a reference in the Clip Monitor's top strip to mark it as the clip's
  storyboard face, the image that represents the clip on storyboard blocks and monitors.

### Characters
Three levels:
1. **Character cards** in the clip: name + base / features / physics (+ optional per-scene
   movement, emotional state, state, power fields).
2. **Character links**: any character field can live-link to another clip's character,
   per-field, with optional override text added after the linked text. Double-click a link
   chip to take the field over: the chip's text drops in for editing and the field replaces
   the link; click the faded chip to link back up (the field clears). Scene/production link
   chips carry the same gesture, with right-click opening the source style or clip.
3. **Char sheets**: a character defined ONCE (image + description) living in the Bin, with
   folders of their own. Double-click a sheet to edit it in the **Char Sheet** panel; link
   clips' characters to it ("from clip" picker). Change the sheet, every linked clip follows.

### Styles
**Project Styles** panel: project-wide blocks (master look, production notes, lighting, etc.)
pinned into every prompt.

### Models
- **Seedance 2 (fal)**: ref2v (up to 9 image refs plus @video/@audio slots) and i2v (start +
  optional end frame). Structured YAML prompts. Seed supported.
- **Seedance 2.5 (fal, early access)**: the same reference suite plus 4K output and every
  integer duration 4–15s. No seed input. fal gates it behind early access: request it on fal's
  model page; renders 403 until approved, and prices are provisional.
- **Seedance 2 (ModelArk)**: image + audio refs, first/last frame, 10-bit 4K. No video refs yet,
  and no real human faces in reference images (their policy).
- **Seedance 2 (Astria)**: text-to-video and first/last-frame i2v on plan credits. No refs.
- **Sora 2 (fal)**: i2v, start image only, audio always on.
- **Gemini Omni Flash (fal)**: text-to-video, ref2v (up to 10 refs), i2v. Always 720p, 16:9 or
  9:16, 3–10s, audio always on (steer it in the prompt: "no dialogue", "calm music"). Prose
  prompts. It also powers the Video Editor's EDIT mode.
- Every engine declares its own modes, durations, resolutions, ref limits, seed support and
  pricing; the UI adapts, and prompts compile per engine (Seedance gets YAML, Gemini gets clean
  prose).
- **Hidden engines**: an engine a supplier stops serving leaves the pickers, but a clip already
  using it keeps it selectable.

## 5. Takes

Every render lands as a **take card**: scrubbable thumbnail (hover to scrub), number, keeper ★,
engine, real duration, date. The **S-B** card (live storyboard) is always first.
- **Click a card** = set the keeper (or, when editing a timeline slot, set that slot's take).
- **Double-click a card** = review it big in the Clip Monitor.
- **Right-click a card** = color-highlight (6 colors), **disable** as a dud (dimmed everywhere,
  skipped by the automatic keeper fallback; explicit picks still honored), or **⑂ edit** in the
  Video Editor.
- **Drag a card onto any field** to restore that field from the take's frozen recipe; drag it to
  the Bin to clone a whole new clip from the recipe; drag it to the timeline to place it.
- Renders are immutable. Nothing ever edits a take's file or its frozen snapshot.

## 6. Clip Monitor (source monitor)

Double-click a clip (Bin tile or timeline block) → it opens here. Scrub bar with per-beat
colored bands and the trim window; trim handles commit on release; the "take N/M ▾" dropdown
switches takes (S-B included); the clip's references line the top (click one = storyboard face);
**⊢ first / last ⊣** grab live frame stills into the Library (they re-extract when the clip is
trimmed, sliced, or re-taken; that's how you continue a shot: the last frame of one clip becomes
the start frame of the next). A "details" toggle overlays the active beat's fields or the clip's
prompt / model / seed.

## 7. The timeline

Multi-track, absolute-time, Premiere-style, with the storyboard visible on every block and
filmstrip frames filling the blocks edge to edge.

- **Tracks**: **+V** adds a video track, ✕ deletes an empty one. Per-track **M**ute / **S**olo /
  🔒 lock, plus **👁** to hide a video track from playback AND export. Gaps are allowed (export
  as black); the topmost track wins where tracks overlap. Audio lanes carry their own M/S. The
  divider between video and audio drags to rebalance; track rows and lanes resize; the view
  always runs past the last clip so there is room to drop.
- **Audio**: every clip's audio is a blue linked block riding its video on the matching lane.
  Right-click it to unlink onto a lane as a green free block with its own position, trims, gain
  and fades. **+A/−A** manage lanes. Music: drag a Library track onto a music lane;
  double-click for the waveform and detected beats.
- **Moving**: drag blocks freely along time and across tracks. Snapping to the playhead and
  beats (**S** toggles all snapping; Shift-drag holds time so only the track changes).
  **Dropping onto other clips OVERWRITES them Premiere-style**: a block hit in the middle
  splits, edges trim, fully covered blocks vanish. Hold **Ctrl** while dropping to INSERT
  instead (everything after shifts right). **Alt-drag duplicates**; **Ctrl+Alt-drag slips** a
  block's content inside its window. Undo covers everything.
- **Selection**: click selects; marquee-drag empty space selects a group (drag any member to
  move them all); **A** arms select-forward (click a clip to grab it and everything after it on
  every track; V or Esc cancels); click the gap between clips to select the gap itself, and
  **Del** closes it, rippling every channel left.
- **Copy/paste**: **Ctrl+C** copies the selected block; **Ctrl+V** ripple-inserts at the
  playhead (everything after shifts right, free audio included); right-click empty track space
  for **paste here** (no ripple) and **close gap**.
- **Trim**: drag block edges (speed-aware, source-accurate). An **end trim ripples** so the
  sequence stays flush (hold **Alt** to leave the gap instead). **Ctrl on a flush edge =
  rolling trim** (the join slides, both neighbors adjust). Switching a slot's take ripples the
  same way when the length changes.
- **Cut**: **C** arms the slice tool (click a clip to cut); **Ctrl+K** razors at the playhead;
  **Q / W** ripple-trim the selected block's start / end to the playhead.
- **Per-block right-click**: frame stills to the Library, **0.5s cross-dissolve**, **speed**
  (0.25–4×), **⟲ loop**, **✦ effects…**, unlink audio, edit with AI, remove (leaves a gap), or
  **ripple delete** (closes up).
- **⟲ Loop**: a faded tail of repeats fills from the block to the next block on the track (or
  the sequence end); drag the tail's end grip to fix a length. Every repeat is a live projection
  of the one block: trims, take, effects and speed follow instantly, and it's one undo.
- **✦ Effects**: a per-block ordered effect stack: **transform** (position / scale; shrink or
  slide a clip and the picture beyond the crop reveals itself to work against, Premiere-style),
  **grid** (FIT shows the whole clip per box; the loop button locks drift to whole cells),
  **focus**, **air**, **push**, and **subject / depth masks**, each with blend modes. Everything
  composites live in the Timeline Monitor. The AI passes (subject matte, depth) run locally and
  cache next to the take, downloading their model once with a small corner progress monitor.
  Export bakes the exact same chain at full resolution, so preview and file match by
  construction. An amber ✦ badge marks blocks carrying effects.
- **Markers & range**: **M** drops a marker at the playhead (right-click the flag to name /
  recolor / delete). **I / O** set the in/out range: playback loops it, export renders only it.
- **Navigation**: wheel pans; **Ctrl+wheel zooms at the cursor**; `-` `=` `\` = zoom out / in /
  fit; **J/K/L** = back-5s / pause / play; ←/→ jump between cuts (with a block selected: nudge
  by a frame, Shift = 1 second; **, / .** nudge too); Home/End = start / end.
- **Playback**: double-buffered engine, seamless cuts; dissolves preview as true crossfades;
  speed plays at speed. ⛶ = safe-area guides; 🖥 = fullscreen mirror on a second display (Esc
  there closes).

## 8. Co-Director and the Director's Room

The copilot reads the whole project (clips, beats, the actual reference images, char sheets,
styles, timelines, folders, and the field last clicked) and writes real values into the forms,
tinted until accepted as keep-or-revert cards. Every write is undoable.

- **It can touch everything a user can, EXCEPT money**: char sheets (all fields), whole
  timelines (create them, set their clips, per-item take / trims / speed / mute / dissolve /
  disable), keeper takes, duplicates, deletes, folders, and @renames that rewrite every mention
  project-wide. Renders, image generation, and file imports stay user-side, always. It
  proposes; the user fires. Beat graphics are protected and reference changes are add-only.
- **@mention images** in the chat to hand it a Library picture (it sees the image, not just the
  name). Keep typing while it thinks; queued messages fire in order when it frees up.
- **The Director's Room**: a full-screen overlay for the conversation, opened from the
  Co-Director panel header (or the Window menu). The app blurs beneath; the chat sits center; a
  moodboard rail collects every image and take the conversation touches (click to zoom, mark
  two to compare); context cards track **On the Table · Still to Decide · Changes**. Name a
  clip and its take starts playing in a floating context pop ("take 2" picks that one). The
  writing cloud drifts beside the chat while it writes into fields.
- **The Screen**: say "show the latest take" and it floats up big beside the chat, playing with
  sound. Click any playing pop to put that exact take on the Screen; the Co-Director can put
  takes up or clear them itself. ▾ folds it to a corner; ✕ clears it.
- **Model dial**: the ⚭ chip in the Room flips Opus ⇄ Sonnet with one click (Sonnet for routine
  passes, Opus for the heavy creative ones). **A− / A+** sizes the type in both chats.
- **Engines**: an Anthropic API key (default), or the **Claude Code bridge** (§2). The bridge
  keeps ONE living Claude session per conversation, sending only what changed, so long sessions
  stay lean on a subscription's usage window. Sessions reset themselves cleanly when the log
  clears or the project, model, or guides change.
- **Editable guides**: the prompting bibles it follows are per-user markdown files with load
  toggles: fork them, tune them, feed it your own rules. It saves a new rule only when
  explicitly told to remember.

## 9. Rendering: now, or in line

Every render surface has two buttons:
- **▶ Render now** fires the job instantly, and several can run at once. Concurrency is capped
  per provider (ModelArk allows 3 at a time; fal queues extras on their own servers). An
  instant job the provider refuses as busy drops itself back into the queue once, with a toast.
  Real errors still fail loud.
- **＋ Queue** lines it up the classic way: one at a time, in order.

The **Queue panel** opens itself the moment a job joins. The header reads **N running · M
waiting**. Every running job streams its own live supplier status (uploading, queue position,
rendering, downloading) with an ETA learned from this machine's real render history. **▶** on
any waiting job promotes it to run immediately; **↑↓** reorder the line; **⏸ pause** holds the
queue lane (running and instant jobs always finish); **✕** cancels. A waiting job cancels free;
a running job is already billing, so cancelling is best-effort.

- Results drop into the Bin in order (and adopt into the exact timeline slot being edited),
  whether or not anyone is watching.
- **Crash safety**: a render already sent to the supplier is rescued on the next launch if the
  app dies; the paid result still lands as its take. Jobs still waiting when the app quits
  don't keep running, but pending renders persist per project, and reopening offers a one-click
  re-queue. Jobs are stamped to their project; switching projects parks them instead of
  rendering into the wrong one. There's also a manual "add take from file…" for anything pulled
  down by hand.
- **SAVES FAILING banner**: a failing disk save is impossible to miss and clears when a save
  lands. Projects living in cloud-synced folders get a one-time notice.
- **Costs**: fal engines show a live dollar estimate before rendering; ModelArk bills tokens,
  so no dollar estimate shows there. Video edits run roughly $0.14/sec all-in. The SPND chip
  tracks per-project spend.

## 10. Image Editor

Double-click a Library image (or **new image** for text-to-image). Every generation is a node
in a results tree: branch anywhere, compare, **make primary** (swaps the Library asset and
every clip using it; revert from the root row), tag copies to the Library, delete branches
(tagged copies survive).
- **✏ Draw layer**: pen over the canvas (6 colors, width, clear) to point at things. Visible
  marks are flattened into what the model receives; hidden marks aren't. Kept per node,
  non-destructive. "→ lib" bakes an annotated copy to the Library for use as a reference.
- **Grow canvas**: pull any edge outward to enlarge the frame around the image (fix tight crops
  without replacing the file).
- **Output controls**: aspect ratio (auto plus ten ratios), variants (1 to 4 per run), optional
  seed. A running price shows on Generate.

## 11. The Video Editor (one editor for vid2vid)

When a take is 90% right, don't re-roll it. Edit it with words. There is ONE editing surface:
the Video Editor results tree. (The old Clip Edit panel is gone; clips it made are ordinary
clips.)

- **Ways in**: **⑂** on any take (Clip Gen take row, or a rendered timeline block), or
  right-click a Library video → **⑂ edit v2v**. The tree opens rooted on that video. A timeline
  block's trims ride in as the edit window.
- **The window**: edits take up to 10 seconds at a time. Slide the amber window along the
  source (drag the edges to trim, drag the middle to move) to pick exactly which part gets
  edited. Only the windowed piece uploads.
- **Two composer modes**:
  - **EDIT (Omni)**: frame-true word edits, prompt + window only. *"Remove the ball. Keep
    everything else the same."* Output is always 720p / 16:9 / 24fps with fresh audio. Roughly
    $0.14 per second all-in.
  - **RE-GEN (Seedance)**: the source rides as `@video1` with the full reference suite around
    it: image refs, extra videos, audio windows, plus output duration / resolution / aspect
    (4K on Seedance 2.5).
- **Every generation is a node** in the tree. Select any node and generate again to branch from
  it. Hover-scrub any node. Nothing touches the Bin or Library until a result is taken out.
- **Keep a result by dragging its node out**: onto empty Bin space = a new clip (the node
  becomes take 1) · onto a clip card = a new take on that clip · onto the timeline = a new clip
  with its block placed at the drop point. The right-click bake menu does the same, including
  bake to **Library videos**, where the result can turn around and become `@video1` for the
  next generation.
- **↻ regenerate**: right-click a node to re-run its frozen recipe as a sibling.
- **◉ primary** (Library-video sources only): the Library entry wears this node's render, every
  @video ref using that video follows it, and it reverts to the original anytime. Takes are
  immutable, so takes bake instead.
- **Delete branch** removes a node and its descendants; baked copies survive; the branch
  holding ◉ refuses with the reason.
- Tree generations queue like any paid job: live status, ETA, cancel, spend ledger, crash
  recovery.
- **Chain it**: ⑂ on an edit's take keeps going; every step keeps its own takes.

## 12. Projects, saving, sharing

- **New** creates a project folder (images + renders + project file). **Open** shows recent
  projects as a thumbnail grid; right-click a card for rename, duplicate, reveal, remove from
  list, or delete (to the Recycle Bin, never a hard delete). All media imports copy INTO the
  project folder.
- **Playgrounds**: the Open picker carries a shelf of downloadable sample projects. One click
  downloads (cached) and stamps a fresh copy as a normal project. First one: **1 AM**.
- Saves are atomic; undo history runs ~80 steps deep; media files are never silently deleted.
- **Snapshots** (💾): save a named state of the whole project and restore it later. The working
  copy stays current until the user chooses to restore.
- **Send to project**: right-click clips, images, music, char sheets, or a whole timeline →
  **send to project** → pick a recent project or browse. Copies land there in a folder named
  after this project; a timeline brings every clip, take, ref and track it uses. The open
  project is never touched, and the receipt toast lists anything skipped.
- Old projects migrate automatically on open.
- **⚙ Settings → Clean up unused media** sweeps orphaned files (scan first, confirmed delete
  with a real count and size; refuses to run mid-render or mid-import).

## 13. Export

**⬆ Export** on the timeline → mp4 via bundled ffmpeg. What the monitor plays is what renders:
multi-track composite (topmost wins, 👁-hidden tracks excluded), gaps black, per-block speed
baked into video and audio, effects baked at full resolution, audio lanes with gain and fades,
music mixed under, mutes honored, storyboard blocks as held beat frames. An I/O range exports
just that window. Resolution 480 / 720 / 1080p, fps auto / 24 / 30. H.264 CRF 18, AAC,
faststart. **✕ in the timeline toolbar cancels a running export**; a failed export never leaves
a truncated file that looks finished. Known: dissolves export as a quick fade-dip for now (the
monitor previews the true crossfade).

One clip instead of a sequence: right-click it in the Bin → **export video…**, or alt-drag the
tile onto the desktop or any folder (the file copies out; the original stays in the project).

## 14. Make it yours

- **Themes** (⚙ Settings): OG VDancer (amber on black), DECK (neon green), WINTERMUTE (steel
  blue), FUCKUP (70s cream, walnut, burnt orange, avocado). Or hit "customize colors": every
  color gets a picker, changes preview live, and "Save as theme…" keeps it under its own name.
- **Workspaces**: save the current layout under a name, switch from the header dropdown.
- **About** (click the "Video Dancer" logo): version, FFmpeg attribution, the crash-log folder,
  and re-entry to the onboarding (replay the API setup guide or the panel tour anytime).

## 15. Shortcuts (global)

Space = play/pause (fronted monitor owns it) · ←/→ = prev/next cut, or nudge the selected block
(Shift = 1s) · , / . = nudge · Home/End · J/K/L = back-5s / pause / play · C = slice tool ·
Ctrl+K = razor · Q / W = ripple start/end to playhead · S = snap toggle · A = select forward
(V/Esc cancels) · M = marker · I/O = in/out range (and the take monitor's window in Clip Gen) ·
− = zoom out · = zoom in · \ = fit · Ctrl+C/V = copy / ripple-paste · Del = remove
block/group/gap · Esc = clear/disarm/restore · Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) = undo/redo ·
? = the in-app cheat sheet (it also covers every drag gesture) · Ctrl+scroll = thumbnail zoom
(Bin/Library) or timeline zoom at cursor. Drag modifiers: Shift = hold time · Ctrl on drop =
insert · Ctrl+Alt-drag = slip · Alt-drag = duplicate · Alt on an end trim = leave the gap ·
Ctrl on a flush edge = rolling trim. All suppressed while typing in a field.

## 16. Troubleshooting

- **SmartScreen / Gatekeeper warnings**: expected for the unsigned beta; see §2 Install.
- **"connect a supplier" banner**: no supplier key saved yet (⚙ Settings → API suppliers).
- **A render errored**: usually the supplier account is out of credit, or the model rejected an
  input. The Queue shows the supplier's real error detail, including field names.
- **Seedance 2.5 renders fail with 403**: fal hasn't granted early access yet; request it on
  their model page.
- **ModelArk rejects a render**: check the no-real-human-faces reference policy and that video
  ref slots are empty (not supported there yet).
- **The app died during a render**: relaunch; completed renders are rescued automatically, and
  pending ones offer a one-click re-queue.
- **A clip plays the wrong take**: check the slot's take picker (take N/M ▾ on the block). A
  slot choice overrides the keeper; S-B means it's playing the live storyboard.
- **SAVES FAILING banner**: the project folder isn't accepting writes (disk full, permissions,
  or a cloud-sync folder holding locks). Fix the folder; the banner clears on the next good
  save.
- **Frames look wrong after slicing**: thumbnails sample only the block's own window; toggle
  the filmstrip off/on.
- **Co-Director bridge greyed out**: the `claude` CLI isn't detected. Install and log in (§2),
  then reopen Settings.
- **Logs**: click the "Video Dancer" logo → About → open the log folder → send `main.log`.

## 17. Known limitations (current beta)

Unsigned installers; macOS has no auto-update. Seedance 2.5 needs fal early access and its
prices are provisional. ModelArk video refs aren't wired; Higgsfield has no Seedance engine
yet. Export dissolves are a fade-dip (true xfade coming). J is jump-back-5s, not reverse
shuttle. Video edits (EDIT mode) come back fixed at 720p / 16:9 / 24fps and window sources
longer than 10s. Waiting queue jobs don't auto-resume after a quit (they persist and offer a
re-queue; a render already sent to the supplier is rescued).
