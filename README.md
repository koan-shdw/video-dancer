
# Video Dancer
### The dream offline AI video editor.

<img width="1018" height="680" alt="Artboard-2-100" src="https://github.com/user-attachments/assets/df66f1d5-3a3d-46fb-b661-c1a749f94baf" />


An offline editor for AI video, built around the best possible workflow. The goal is to cut the number of generations you need by giving you granular control over your inputs. You block your shots out on a timeline as a storyboard, then turn that storyboard straight into video. And when a render is *almost* right, you don't re-roll it — you edit it with words (vid2vid) and keep every version.

It's a roll of the dice. Thats the number one problem with generative art. So how can we get more granualr control over the process? How can we reduce the cost of getting the render we envisioned?

Let's start by tackling the biggest headache: managing references. In tools like Higgsfield you fight one bloated shared library that's a pain to swap references in mid-flow. Here, every project gets its own library, and @-mentioning an image drops it straight into your prompt and the upload queue.

Local-first. Your files, your disk. Bring your own fal API key.

[Download for Windows](../../releases/latest) · [Download for macOS](../../releases/latest)

---

## Library

<img width="1016" height="682" alt="Artboard-4-100" src="https://github.com/user-attachments/assets/a309e378-3579-4665-b8af-bf0584596d08" />


Every project gets its own image and music library. @-mention an image and it flows into your prompt and the upload queue at the same time.

- **Import images**: use the file picker or drop files straight from your desktop (jpeg, png, webp, gif, bmp, avif).
- **Import music**: same two ways (mp3, wav, m4a, aac, ogg, flac).
- **New image (AI)**: opens the Image Editor to generate one from scratch.
- **Drag to slots**: drag any image tile onto a clip's reference, start, or end slot.
- **Drag to folders**: drag images or clips into a folder to organize them.
- **Double-click to edit**: opens the image in the Image Editor.
- **Right-click menu**: edit with AI, rename the @title (it checks for collisions), duplicate, or delete. Deleting an image that a clip uses warns you first, and the file stays on disk.
- **Dynamic stills**: frame-grabbed "live frame" stills re-extract themselves when the source clip is trimmed, sliced, or has its take changed.
- **Music rows**: every track shows its real duration in timecode, with a hint to drag it onto the timeline's audio lane.
- **Rename or delete music**: right-click a track. Deleting clears its timeline binding and leaves the file on disk.
- **Thumbnail zoom**: a slider in the header, or ctrl+scroll anywhere over the panel, resizes every tile Explorer-style. The size sticks across restarts.

---

## Bin

<img width="1020" height="680" alt="Artboard-5-100" src="https://github.com/user-attachments/assets/368f36d9-022b-459b-9b57-889855bc0bc1" />

Your clips and timelines, laid out as tiles. Drag a clip onto a timeline, double-click to edit, right-click for everything else.

- **New clip**: creates an empty storyboard clip.
- **Clip tiles**: each shows a thumbnail of its first reference, a name, and a take count. A dashed outline means it has no render yet. Edit clips (vid2vid) carry a ⑂ mark.
- **Drag to timeline**: drag a clip tile onto a timeline track to add it.
- **Open or select**: click to select a clip, double-click to open it in Clip Gen (edit clips open in Clip Edit).
- **Right-click a clip**: rename, duplicate, export its video, or delete. Delete tells you how many timeline instances it has, and it's undoable.
- **Export one clip**: right-click → "export video…" copies the keeper take wherever you point the save dialog. Or just **alt-drag** the tile onto your desktop or any folder — the file copies out, the original stays in the project.
- **Thumbnail zoom**: the header slider or ctrl+scroll resizes the tiles, same as the Library.
- **Clip details**: a footer shows the selected clip's name, model, duration, take state, seed, and reference titles.
- **Timelines section**: each timeline is a tile showing its name, aspect, and clip count.
- **New timeline**: creates a fresh empty one.
- **Activate or edit a timeline**: click a tile to load it into the Timeline panel, double-click to open the Timeline Editor.
- **Right-click a timeline**: rename, edit settings, duplicate, or delete. Delete confirms if the timeline has clips, and it's undoable.
- **Clone a take here**: drop a take chip onto the Bin to clone it into a new top-level clip.
- **Cross-project import**: pick another project's folder and import its clips through a modal. You get a card grid with select-all and select-none, a running selection count, and badges for storyboard vs rendered and beat count. Renders and references are copied in. The source project is never touched.

---

## Folders

Nested folders for both clips and images, so a big project stays manageable. Drag things in, right-click to reorganize.

- **Nested tree**: nest folders as deep as you want. Each row shows a count of the items directly inside it.
- **Collapse or expand**: click a folder row to toggle it.
- **Drag items in**: drop a clip or image on a folder header to move it there. Drop it on the background to move it back to the root.
- **Right-click a folder**: rename it, add a subfolder, open it in its own tab, or delete it. Deleting a folder moves its contents up to the parent. Nothing is lost.
- **Right-click the background**: create a new folder.
- **Move via menu**: an item's right-click menu lists "move to root" plus an entry for every folder.
- **Folder tabs**: open a folder in its own panel to work inside just that sub-tree.

Folder collapse state is per-panel and resets when you close the panel.

---

## Timeline

<img width="1018" height="683" alt="Artboard-3-100" src="https://github.com/user-attachments/assets/936e2f65-86ca-43c3-bfc0-5833de7970f1" />


A proper sequence editor. Scrub, zoom, slice, trim, lay music under your shots, and pull frames out to continue a shot.

- **Transport**: play and pause, step to the previous or next clip, jump to the first or last, and toggle loop playback.
- **Scrub**: click or drag the ruler to move the playhead. Tick marks and labels space themselves to the length of the sequence.
- **Zoom**: zoom in and out in 1.5x steps up to 8x, and click the zoom readout to snap back to fit. The whole track widens and scrolls together, zoom holds the time under the center of your view, and the ruler ticks re-space themselves to whatever you're looking at.
- **Filmstrip toggle**: show real sampled frames on every block (tiled at the clip's true aspect, never stretched), or switch to plain blocks for speed.
- **Slice tool**: press S or click the razor, then click a clip to cut it in two. The guide snaps to the playhead and to music beats, and the tool puts itself away after each cut. Right-click or Esc to cancel.
- **Select and move**: click a block to select it and move the playhead there. Double-click to open it in Clip Gen.
- **Edit with words**: every rendered block carries a ⑂ button — one click opens that exact take (with the slot's trims pre-loaded) in Clip Edit. See vid2vid below.
- **Reorder**: drag a block to a new spot. A marker shows where it will land.
- **Trim**: drag a clip's left or right edge to set its in and out points. Edges snap to the playhead frame or to the nearest music beat when snapping is on.
- **Snapping**: two independent toggles, one for the playhead and one for music beats.
- **Remove a block**: click the remove button on a block to drop that instance from the timeline.
- **Per-block info**: name, trimmed duration, and a take label reading "take N of M", "live recipe", or "no take".
- **Per-block take picker**: click the take label to choose which take (or the live recipe) this exact slot plays, without changing other copies of the clip.
- **Per-block mute**: mute a single instance's audio from its take menu. A small icon shows when it is muted.
- **Storyboard blocks**: a clip with no render shows a dashed outline plus its beat reference images and colored beat bands, so an un-generated sequence still reads as a storyboard.
- **Music lane**: drag a track from the Library onto the audio lane. Where you drop it sets where it starts.
- **Move and trim music**: drag the music block to reposition it, trim either end, or remove it.
- **Waveform**: double-click the lane to expand it and draw the waveform. Click to cycle through wave, beats, and both. An "analyzing" label shows while it computes.
- **Mute all or mute music**: one button silences every clip's audio, another silences the music lane, for both playback and export.
- **Clip count and timecode**: a live clip count and a shared timecode readout.
- **Active timeline name and aspect**: always shown in the bar. Double-click the timeline in the Bin to rename it or change its settings.

### Frame-grab and Continue

Grab any frame straight to your Library. This is how you continue a shot: feed one clip's last frame into the next clip's start.

- **Grab from the Program Monitor**: save the current timeline frame to the Library, either cropped to the timeline aspect ("as shown") or as the full uncropped frame.
- **Grab from the Clip Preview**: save the current preview frame (full frame) to the Library.
- **Auto-noted**: every grab records its clip, take, and timecode, and confirms it landed in the Library.
- **Dynamic first frame**: capture a clip's first frame as a Library still that re-extracts itself when the clip is trimmed, sliced, or has its take changed.
- **Dynamic last frame**: capture the ideal next-clip start frame. When you slice the clip, it follows the right half automatically.
- **Live reconcile**: changed dynamic stills re-extract after a short delay. Frozen ones are kept even when their source is gone.

---

## Clip Gen (the model interface)

<img width="1020" height="685" alt="Artboard-8-100" src="https://github.com/user-attachments/assets/c799a771-2a0e-407c-bb4a-4e0064c111de" />


Open a single clip to build and generate it. Set the model, mode, and output, write the prompt, attach references, and render. Everything about making one shot lives here: its prompt and beats, the model it runs on, and every take it produces.

- **Name your clip**: commits to the Bin on blur or Enter.
- **New clip**: starts a fresh storyboard clip and carries over whatever you'd already typed instead of throwing it away.
- **Uncommitted warning**: an amber banner reminds you when the form isn't saved to the Bin yet.
- **Setup**: model, render mode, duration, resolution, aspect ratio, and the audio toggle, in one collapsible block.
- **Model**: pick from the registered engines. Switching keeps your inputs, and any value not in the new engine's list stays selectable.
- **Mode (ref2v or i2v)**: switch between reference-to-video and image-to-video. Modes a model doesn't support are greyed out, and your images carry across the switch (the first reference becomes the start frame, and back again).
- **Output controls**: duration, resolution, and aspect come from the model's real capability list. An "auto" duration is treated as 5 seconds and flagged.
- **Generate audio**: toggle native audio, or it forces on and reads "audio: always on" for models that require it.
- **Freeform prompt**: a resizable box that detects @mentions, collects @-titled references for you, and accepts dropped images and take chips.
- **@mention autocomplete**: type "@" for up to eight matching Library titles. Pick one to insert it and add it as a reference.
- **Drag an image into the prompt**: drops the @title at your cursor and adds the reference.
- **References (ref2v)**: add up to the model's maximum, with a count and an over-limit warning. A yellow outline warns when a reference isn't @-mentioned in the prompt. Clear a reference and its @title is stripped from the prompt too.
- **Frames (i2v)**: assign a required start frame and an optional end frame. The end frame is kept but greyed out when the model doesn't support it.
- **Structured fields**: expand to edit Scene, Character, and Production fields, with a live read-only YAML preview of exactly what gets sent.
- **Link another clip's prompt**: splice a second clip's live prompt before or after yours. Flip the order, unlink, or double-click the chip to jump to that clip. It tells you if the linked clip is removed.
- **Per-field links**: inherit a single Scene or Production field from another clip. Hover to preview, click to open the source.
- **Validation and lint**: red errors block the render. Amber warnings and content lint advise without blocking.
- **Render footer**: an always-visible Render button reading "adds a take" or "new clip", with the model name and a live cost estimate. It's blocked while there are errors, with a tooltip telling you what to fix.
- **Cost estimate**: a running price from the resolution's per-second rate times duration, with a tooltip breakdown.
- **Status bar**: a single line of lifecycle state, red on error.
- **Image picker**: a full-screen Library picker scoped to whichever slot you're filling, with a shortcut to import a new file.
- **Inline preview**: a built-in player that loops the current take (muted by default), with play, pause, mute, and a fullscreen view.

### Beats and structured prompts

Storyboard a shot beat by beat on a small timeline, then let it compile into clean YAML. This is the granular control that cuts your generation count, because Seedance performs best when you script its timing.

- **Beats bar**: colored segments sized to their length, on an eight-color cycle. An empty bar says "click to add a beat".
- **Add or remove beats**: click empty space or the add button to append a 3-second shot. Remove the selected beat with its delete button.
- **Select and edit**: click to select, double-click to open the field editor.
- **Reorder**: drag beats into a new order, with a drop marker.
- **Resize**: drag a boundary to redistribute length between neighbors (minimum 0.25 seconds, snapping to 0.25).
- **Overflow warning**: the bar and counter turn red when your beats run past the clip duration.
- **Auto-time**: keep beats filling the full duration. Each holds its share as the duration changes, and the last beat takes up any remainder.
- **Playhead**: a line tracks playback across the beats.
- **Per-beat fields**: name, start and end timecodes (read-only), length, plus Camera (with a word-count lint that flags over 20), Action, Lighting, Dialogue, VFX, Reaction, and SFX.
- **Auto reference image**: a beat's @-mentioned reference shows as a thumbnail above its camera field.
- **@mentions in beats**: Camera, Action, and Lighting all support @mention autocomplete, and @-titled references get added to the clip automatically.
- **Restore from a take**: drop a take chip on the beats to bring back a prior layout, rescaled to the current duration.
- **Scene fields**: title, reference handling (the poses to avoid), style, visual feel.
- **Character cards**: add named characters with a reference label and base, features, and physics fields. Each becomes its own YAML key.
- **Production fields**: avoid (required), audio design, overall lighting, critical constraint, subtext.
- **Field linking**: link any Scene or Production field to another clip to inherit its value, with hover preview and double-click to open.
- **YAML assembly**: the freeform prompt and structured fields merge into valid YAML. Characters, the cinematic storyboard, and production notes each get their own block, and empty fields are dropped.
- **Content lint**: flags a camera line over 20 words, beats that don't sum to the duration, an empty "avoid" when there are beats, images attached but not referenced, and filler words like epic, amazing, beautiful, stunning, and cool.

### Generation and models

Pick an engine and render. You see live progress straight from fal: uploads, queue position, download.

- **Render run**: hit Render and the job joins the Queue — references upload, the payload builds, fal does its thing, and the mp4 lands in the project's renders folder as a take with a frozen snapshot of the recipe.
- **Live progress**: the Queue panel streams uploading, submitting, rendering, and downloading, forwarding fal's own status.
- **Render badge**: the Clip Gen and Queue tabs show a spinner while anything is in flight.
- **Done and error feedback**: a success plays the result inline. A failure shows the real error detail, including the exact fields fal complained about.
- **Slot-aware results**: a fresh take drops into the exact slot you were editing. A brand-new clip selects itself after the render.
- **Seedance 2 (ref2v)**: up to nine reference images.
- **Seedance 2 (i2v)**: a start frame plus an optional end frame.
- **Sora 2 (i2v)**: start image only, audio always on.
- **Gemini Omni Flash (text-to-video)**: no images at all — pure prompt, with synchronized audio baked in.
- **Gemini Omni Flash (ref2v)**: up to ten reference images, bound into the prompt automatically.
- **Gemini Omni Flash (i2v)**: a single start frame. All Omni modes are 3–10 seconds, 720p, 16:9 or 9:16, audio always on (steer it in the prompt: "no dialogue", "calm music") — and it's the engine behind vid2vid below.
- **Per-model capabilities**: each engine declares its own modes, reference limit, durations, resolutions, aspect ratios, audio behavior, seed support, and pricing, and the editor matches the UI to it. Prompts even compile differently per engine — Seedance gets its YAML, Gemini gets clean prose.
- **Cost-aware**: the per-second price map drives the live estimate.
- **Credit refresh**: your fal balance updates after each render.

### Takes and versioning

Every render is a take. Keep them all, compare them, and pick a keeper, without destroying anything.

- **Takes row**: a live-recipe chip plus a chip per take, with keeper and slot labels. It appears once you have at least one take.
- **Live recipe chip**: switch a slot to the live recipe (which clears trim), or preview the recipe in the Bin. The active one is marked.
- **Pick a take**: click a take chip to set the keeper (in the Bin) or assign it to just this slot (on the timeline), loading it into the preview.
- **Drag a take**: drag a take chip onto form fields, the Bin, or the timeline.
- **Restore from a take**: drop a take chip on a field to restore that field's frozen snapshot, whether that's the prompt, references, or beats. Takes from before snapshots existed will tell you there's nothing to restore.
- **Slot-only warning**: a banner reminds you that a take assignment applies to this slot only when a clip is used in more than one place.
- **Set keeper**: choose which take shows and exports by default.
- **Clone from a take**: make a new clip from a take's snapshot (reusing the file), or drag a take chip onto the Bin to clone it into a new top-level clip.
- **Smart resolution**: playback picks the slot take, then the keeper, then the latest take, then the recipe. Effective duration clamps to a shorter take, and takes show only their own frozen beats.

---

## Clip Edit — change a video with words (vid2vid)

The roll of the dice, tamed. When a take is 90% there, you don't burn money re-rolling the whole shot — you tell it what to change. *"Remove the ball. Keep everything else the same."*

- **Two ways in**: hit **⑂** on any take chip in Clip Gen, or on a rendered block right on the timeline. Either way, Clip Edit opens with that take loaded as the source.
- **Draft until you generate**: nothing lands in the Bin while you're sliding the window and writing the instruction. Close it, change your mind — costs nothing. The first successful generation forks a new ⑂ edit clip.
- **The window**: edits take up to 10 seconds at a time. Slide the amber window along the source (drag the edges to trim, drag the middle to slide) to pick exactly which part gets edited. Fork from a trimmed timeline block and the window pre-loads to those trims. Only the windowed piece uploads.
- **Words only**: the model takes the video and an instruction — no reference images, no masks. Short sentences work best, and ending with "Keep everything else the same." protects the rest of the shot.
- **Non-destructive by design**: the source take is never touched. Every edit generation is a take on the edit clip — re-roll it, compare, set a keeper, exactly like Clip Gen.
- **Chain it**: hit ⑂ on an edit's take to edit the edit. Every step keeps its own takes, and "go to source" walks you back up the chain.
- **Into the timeline, your way**: Clip Edit never touches your timeline. Slice the original at the window points and aim the middle slot at the edit take, or just drag the edit clip in.
- **What comes back**: always 720p, 16:9, 24fps with fresh synchronized audio, whatever you feed it (a vertical or 1080p source gets reframed/downscaled). Sources longer than 10 seconds get windowed, not sent whole.
- **Cost**: roughly $0.14 per second all-in (the source video bills input tokens too), shown live before you commit. Re-rolls of the same window skip the re-upload.

Runs on Gemini Omni Flash's edit endpoint through your fal key. Voice editing isn't supported by the model, and editing your own uploaded footage is unavailable in the EEA, Switzerland, and the UK (editing generated video works everywhere).

---

## Queue

Every paid job — renders and edits — lines up and runs one at a time. Stack a night's worth of generations and walk away.

- **Auto-surfaces**: the Queue panel opens itself the moment a job joins.
- **The running job**: streams its live fal status — uploading, queue position, rendering, downloading — with a spinner in the tab even when it's tabbed away.
- **The line**: every waiting job shows its clip thumbnail, name, engine, and estimated cost.
- **Reorder**: bump a job up or down the line with ↑ ↓.
- **Pause**: the running job always finishes (it's already billing) — pause just stops the next one from starting. Resume when ready.
- **Cancel**: a waiting job cancels free. Cancelling a running job is a best-effort remote cancel — if fal finishes it anyway, the take still lands, because the money was spent either way.
- **Results flow in order**: takes drop into the Bin (and adopt into the exact timeline slot you were editing) whether or not you're watching.

The queue lives in memory: jobs still waiting when you quit don't survive the restart.

---

## Playback: Program Monitor and Clip Preview

Two monitors, like a proper NLE. The Program Monitor plays the assembled timeline. The Clip Preview gives you a frame-accurate single-clip view with trim handles.

**Program (Timeline) Monitor**

- **Plays the whole sequence**: streams the active take of each clip, fitted to the timeline aspect with correct letterboxing and a cover-fill crop.
- **Storyboard fallback**: un-rendered clips show their beat reference image or keyframe, so an all-storyboard timeline still plays through.
- **Trim-aware advance**: plays only each clip's trimmed span, then moves to the next.
- **Storyboard hold-clock**: simulates playback timing for take-less clips, tracking the active beat as it goes.
- **Details overlay**: toggle an overlay of the active beat's fields, or the clip's style, feel, and prompt with model and seed.
- **Timecode**: current and total at 24 fps.
- **Music and mute sync**: plays the music lane in sync (honoring start, trim, and drift) and reflects every mute instantly.

**Clip Preview (Source Monitor)**

- **Single-clip preview**: previews whatever you double-clicked on the timeline or selected in the Bin, with that slot's take and trim, or the live recipe.
- **Transport**: play and pause, a play-in-to-out button for the trimmed window only, and mute (muted by default per clip).
- **Scrub bar**: click to seek, drag to scrub, with per-beat colored bands and an amber trim region.
- **Trim handles**: drag either edge to set in and out (minimum 0.25 seconds), or grab the slide handle to move the whole window while keeping its length. It commits on release.
- **Details overlay**: model, seed, and the active beat's fields, or the clip's style, feel, and freeform.
- **Editable beats**: edit the live recipe's beats right under the scrub bar (saved on a short delay, flushed when you switch clips). Frozen take beats show a read-only notice.

**Shared**

- **One audible player**: only one monitor or preview plays audio at a time. Starting one mutes the rest, and the speaker icons stay in sync.
- **Waveform and beat analysis**: music is decoded to a peak envelope plus detected beats, cached, and only computed when a lane is expanded.

---

## Image Editor

<img width="1016" height="679" alt="Artboard-9-100" src="https://github.com/user-attachments/assets/ec2772f8-a458-40af-ac96-269fe1c3fe2e" />


A node-tree image editor with its own results history. Generate, branch, tag the keepers back to your Library, and set a primary that every clip follows.

- **Two ways in**: double-click a Library image to edit it, or start a from-scratch text-to-image session with "new image".
- **Canvas**: a fit-to-window view of the selected node or the original. (Drawing and masking tools are a placeholder for now.)
- **Reference strip**: drag Library images in as references, with thumbnails, clear buttons, and a fidelity warning past three references.
- **Prompt and @mentions**: a resizable prompt box with up to eight @mention matches that insert and add a reference.
- **Output controls**: aspect ratio (auto plus ten ratios), variants (1 to 4 images per run), and an optional seed (anything non-numeric means random).
- **Generate and cost**: a Generate button with a running price (variants times the per-image rate), and status through uploading, generating, and downloading.
- **Auto-jump**: selects the first new result when a run finishes, and refreshes your credit.
- **Results tree**: every generation is a node, indented by depth. Click one to view it and set it as the base. Branches collapse with a folded count.
- **Rename**: edit a node's @title inline (Enter or blur commits, and it snaps back on a collision).
- **Drag a node to the Library**: saves that result as a new Library image.
- **Make primary**: switches the Library asset and every clip that uses it to this node's file. Revert to the original from the root row.
- **Tag to Library**: save a node as a new image without making it primary.
- **Delete branch**: removes a node and its descendants. Tagged copies survive, and a branch holding the primary can't be deleted.
- **Lineage and details**: an "edited from" lineage, plus a footer with the selected node's prompt, seed, references, tag, and primary state.
- **Send to prompt**: copies a node's prompt into the box.

The canvas masking and drawing tools are still on the way. See Coming soon.

---

## Panels and workspaces

A dockable, tab-able, splittable layout you can rearrange however you want, then save as named workspaces and snap between them.

- **Dockable panels**: Library, Bin, Timeline Monitor, Clip Monitor, Timeline, Timeline Editor, Image Editor, Clip Gen, Clip Edit, Queue, and Folder panels all dock, tab, resize, split, and rearrange by dragging.
- **Default layout**: a sensible starting arrangement you can always reset to. Clip Edit and the Queue open themselves on demand, so your saved layouts stay yours.
- **Maximize a panel**: focus one group full size. Esc or "restore" brings the rest back.
- **Smart raising**: the Timeline Monitor comes forward on play, the Clip Monitor only when there's a genuinely new target, and Clip Gen only on a real double-click.
- **Open folders as panels**: pop any folder into its own dockable panel.
- **Workspace switcher**: a header dropdown shows the active workspace and the full list. Click one to apply its layout.
- **Manage workspaces**: save the current layout as a new named workspace, switch, rename, or delete them. The built-in Default stays untouched.
- **Persistent**: workspace layouts are saved by name and survive restarts.
- **Crash isolation**: every panel has its own error boundary with a retry button, so one panel crashing won't take the app down.
- **About**: version, FFmpeg license and attribution, links, a shortcut to open the crash-log folder, and re-entry to the onboarding — replay the API setup guide or the panel tour anytime.
- **First launch**: a welcome window walks you through the API keys, then a spotlight tour points out each panel. Both dismissible, both one-time (unless you want them back).

---

## Themes

The whole UI resolves to one set of colors, so the whole UI re-skins in one click.

- **Three built-ins**: **OG VDancer** (the original amber-on-black), **Cyberpunk** (neon green on near-black), and **High Tech** (smooth steel blue).
- **Make your own**: hit "customize colors" in Settings — every color in the app gets a picker, changes preview live, and "Save as theme…" keeps it under your own name.
- **Everything follows**: panels, buttons, beat bands, the music lane, even the scrollbars ride the theme.
- **Persistent**: your theme (built-in or custom) applies at launch and custom themes save with your settings.

---

## Settings

Bring your own keys, watch your fal balance live, and keep everything stored on your machine.

- **fal API key**: used for both video and image generation, stored locally.
- **fal admin key**: a billing-scope key that powers the live credit balance.
- **Astria API key**: stored for later. Not used by Video Dancer yet.
- **Anthropic API key**: stored for the Claude prompt brain that's coming later.
- **Save**: persists your keys, confirms, and refreshes your credit.
- **Local-only**: a note explaining exactly where the keys are stored.
- **Credit badge**: your fal balance in the header. Click it to refresh.
- **Missing-key banner**: an amber prompt to open Settings when no fal key is set. You can dismiss it.
- **Theme picker**: switch between the built-in themes or your own, and build new ones (see Themes above).
- **Clean up unused media**: sweeps files in the project folder that no clip, image, track, or undo step still uses — scan first, confirm with a real count and size, then delete. It refuses to run while a render or import is mid-write.
- **Saved preferences**: the filmstrip toggle, playhead snap, beat snap, thumbnail sizes, and theme all remember their state across restarts.
- **Updates**: a manual update check and a restart-to-install action on Windows. A quiet header chip appears if an update actually fails (being offline doesn't count).

Keys are encrypted at rest with your OS keychain and never leave your machine.

---

## Keyboard shortcuts

<img width="1016" height="680" alt="Artboard-7-100" src="https://github.com/user-attachments/assets/d08b0d5a-682a-45a0-9a1d-483e487dc4d3" />


The shortcuts you'd expect from an NLE, and they stay out of your way while you're typing.

| Key | Action |
|---|---|
| Space | Play or pause the timeline |
| Left | Previous clip |
| Right | Next clip |
| Home | First clip |
| End | Last clip |
| Delete or Backspace | Remove the selected block |
| Escape | Clear selection, disarm slice, exit maximize, or close a modal |
| Ctrl+Z or Cmd+Z | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Redo |
| S | Toggle the slice tool |
| ? | Toggle the cheat sheet |
| Ctrl+Scroll over the Bin or Library | Thumbnail size, Explorer-style |

Every global shortcut is suppressed while you're typing in a field. The built-in cheat sheet (open it with ?) covers these plus every drag gesture.

---

## Drag and drop

Almost everything moves by drag: images into prompts, clips onto timelines, takes onto fields, blocks into a new order.

| Drag | From, to |
|---|---|
| Image | Library, to a clip's ref, start, or end slot, the prompt, the references, or the Image Editor |
| Clip | Bin, to a timeline track |
| Take chip | Clip Gen, to a field (restore), the Bin (clone), or the timeline |
| Timeline block | reorder within the track |
| Bin clip (alt-drag) | to your desktop or any folder — copies the video file out |
| Clip or image | onto a folder, or the root |
| Beat | reorder within the beats bar |
| Music track | Library, to the timeline audio lane |
| Image-tree node | Image Editor, to the Library |
| OS files | desktop, to the Library |

---

## Projects and saving

Open, save, and switch projects without worry. Saves are atomic, history runs deep, and your media is never quietly deleted.

- **New or open**: create a project folder (with images and renders folders, a starter 16:9 timeline, and a project file) or open an existing one.
- **Recents**: reopens your last project on launch, and a header dropdown lists recent projects with full-path tooltips.
- **Atomic saves**: every save writes to a temp file and renames, so a crash can't corrupt your project.
- **Undo and redo**: deep history (up to 80 steps) with feedback. Undo never deletes your media files.
- **Migration**: older projects are upgraded automatically when you open them.
- **Per-project media**: imported images and audio are copied into the project folder. Deleting a Library asset clears its references but leaves the file on disk.
- **Timeline operations**: add, rename, duplicate, delete, and set the active timeline, and set its music, mutes, and export resolution and fps. There's always at least one timeline.
- **Safe media streaming**: clips stream from a project-scoped handler that refuses anything outside your project folder.

---

## Quality-of-life

The small stuff that adds up. Autosave, smart syncing, and a UI that keeps up with you.

- **Autosave**: the Clip Gen form saves on a short delay, and the layout saves on a delay too, but never to an empty layout.
- **First-launch onboarding**: a dismissible setup guide for the API keys, then a spotlight tour of the panels. Replay either from About.
- **Self-syncing**: reference paths update when you swap a file, @mentions rewrite themselves when you rename an image (keeping your cursor in place), and beats edited elsewhere sync back into the editor.
- **Clean switches**: the form clears, the filmstrip cache clears, and playback resets when you change projects.
- **Feedback everywhere**: renders, exports, imports, undo and redo, and opening a project all confirm.
- **Auto-import on render**: source images get imported to the Library automatically (deduped by path), and rendering with no project open spins up an Untitled one for you.
- **Smooth scrubbing**: the playhead and timecode update without re-rendering the whole panel.
- **Crash logging**: uncaught errors are written to a rotating log file you can open from the About box.

---

## Export

Turn the timeline into a finished MP4. Full re-encode, music mix, and storyboard frames for shots you haven't rendered yet.

- **Export to MP4**: a full ffmpeg re-encode to a Save dialog (defaulting to an exports folder), one at a time, with live progress.
- **From the Timeline Editor**: an export button (disabled while busy or empty).
- **Resolution and fps**: 480, 720, or 1080p (short side, defaulting to 1080) and auto, 24, or 30 fps (defaulting to auto, taken from the first clip).
- **Storyboard-aware**: un-rendered clips export as their beat reference frames, held for each beat's window, matching what the monitor shows.
- **Music mix**: the music lane is mixed under the clip audio, honoring its start and trim. Muted clips become silent.
- **Fill crop**: clips are scaled up and center-cropped to fill the canvas, with no letterboxing.
- **Quality**: H.264 at CRF 18, yuv420p, AAC 192k, faststart.
- **Progress and reveal**: a probing, exporting, and percentage readout, then click the result to reveal it in your file browser.
- **Timeline settings**: rename the timeline and set its aspect (16:9, 9:16, 1:1, 4:3, 3:4, or 21:9), with a clip count and total duration.

---

## Coming soon

What's built, building, or on the runway but not fully live yet.

- **Image Editor drawing tools**: canvas masking and guide-mark drawing for image edits are being finished. Generation and the results tree work today.
- **Timeline transitions**: crossfades and cuts-with-style between blocks.
- **More vid2vid engines**: the edit pipeline is engine-agnostic — new models slot in as they earn it.
- **Claude enhance**: a Claude prompt brain that fills your prompt and structured fields for you. The Anthropic key is already accepted in Settings.
- **Sora 2 character references**: declared by the engine, not wired into the editor yet.
- **Astria support**: the key is accepted and stored, but not used yet.
- **macOS and Linux auto-update**: Windows updates itself silently today. macOS auto-update needs Apple signing, so for now grab the newest dmg from this page.

---

## Download and install

Beta software, currently unsigned. It's safe. The warnings below are just the OS being careful about a new publisher.

| Platform | File |
|---|---|
| Windows | Video Dancer Setup (version).exe |
| macOS (Apple Silicon) | Video Dancer (version).dmg |

**Windows.** When SmartScreen pops up, click "More info", then "Run anyway". After the first install it updates itself silently in the background.

**macOS.** Because it's unsigned, right-click the app, then "Open", then "Open" the first time (a normal double-click is blocked). There's no auto-update on macOS yet, so grab the newest dmg from this page when a new version ships.

Bring your own fal API key. Add it in Settings and you're ready to generate. Your keys and files stay on your machine.
