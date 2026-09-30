# What the Co-Director can and can't reach (list 27)

Date: 2026-09-30 · Status: BUILT that day (untested by him): Image Gen, firing, and the rest of
the reach in the order of §3 question 2. §5 says what was built and what stays his.

His words: "codriector needs full access to all the latest features image gen etc" (09-21) ·
"also add to list giving codirector access to making new image gen clips and whtaever else hes
missing" (09-29).

How this list was made: every action the app's own screens can call (the `ipcMain.handle` list
in `src/main/index.ts`) was set against the Co-Director's tool list (`TOOLS` in
`src/main/codir.ts`), both read on 09-30.

---

## 1. What it reaches today

| area | what it can do |
|---|---|
| Clips | make one; write every prompt field, the beats, the freeform; add and remove image refs; link fields to styles and clips; link char sheets; set duration and engine; rename, duplicate, delete; flag the keeper take |
| Image Gen (new 09-30) | make a job; write the prompt; set the two ref slots; set every dial in the panel (model, aspect, size, renders, seed, the refs switch and both boosts, loras and their weights, unleashed); rename and duplicate a job; flag the ★ take; copy a take into the Library; read what is installed (models, loras and their trigger words) |
| Char sheets | make, write the seven fields, delete |
| Styles | make, update, delete |
| Timelines | make one; lay a sequence on one video track (clips, takes, trims, a timeline as a nest); rename, duplicate, delete; set the aspect; put it on screen |
| Library and Bin | rename an image (its @mentions follow); folders for clips and for images; bench or un-bench any item |
| Looking | watch a take; watch a timeline; read a clip, sheet, style, timeline or image gen in full; read the exact prompt a render will send; read old conversation; put a take on the Room's screen |
| Its own | the brief, the open questions, the three prompting guides, learned rules, MOODS (save one, import a skill) |

## 2. What it can't reach

**A. Firing anything.** Kept with him by the guide's own rule ("anything that SPENDS"): a clip
render, an image gen render, Image Edit, the Video Editor, a Sheet Gen build, a score render, a
voice render, an export, the queue.

**B. Clip Gen's dials.** Resolution, aspect ratio, seed, sound on or off, the negative field, the
mode (refs / first frame / video edit / words only), the end frame, video refs and audio refs, the
LTX size, loras on the local video engines, the H3 options, the pictures on beats, the prompt
link.

**C. Takes.** Delete, colour, disable; make a clip from a take; make clips from images.

**D. Char sheets.** The image binding and the image slots; the voice field. (Both are on the
list under 31.)

**E. The timeline beyond one video track.** More video tracks, audio blocks, score blocks,
dissolves, speed, reverse, effects, mutes, slices, unlink, turning a selection into a nest,
export settings.

**F. Score.** Make a score, write its style and beats, pick the model, compose from the cut,
flag a keeper, duplicate, delete.

**G. Voice.** Make a voice, write its description and test line, pick the model, flag a keeper.

**H. Image Edit and the Video Editor.** All of it.

**I. Library.** Import, delete, duplicate, crop, set the primary image, tags. Videos and audio:
rename, delete. Folders for videos, audio, scores, voices and image gens.

**J. Image Gen, the rest.** Deleting a job or a take (the files go, so it can't be undone), take
colour and disable, the Civitai drag and downloads, the PNG reader.

**K. Assembly.** Concept, lock, assemble.

**L. The project itself.** Undo and redo, saved states, opening or making a project.

**M. Settings.** Keys, bridge logins, model downloads.

**N. Switching a MOOD on.** His by design.

## 3. Questions

1. **Firing.** May it start a render itself? Three levels: never (today) · free local renders
   only (Image Gen, local LTX and H3: his GPU, no money) · paid renders too, each on his "go".
2. **What next.** My order: B (Clip Gen's dials), then F and G (Score and Voice), then E (audio,
   score and dissolves on the timeline), then H (Image Edit), then the rest. His order wins.
3. **Things that can't be undone.** Deleting an image gen, a take or a Library file removes the
   file. Keep those with him, or let it delete when he asks by name?

## 4. Answers (09-30)

He asked on 09-30 for the obvious questions to be answered for him. An answer in quotes is his own.

1. **Firing.** "yes but needs go command and there needs to be a button in the UI for codirector
   which enables it". So: a switch in the Co-Director's UI, off by default. With it on, and only
   on his go, it may start a render, paid ones included. The app checks both itself.
   BUILT 09-30 (untested by him) for clips and image gens: `fire_render`, the "renders" switch
   (`ui/RenderSwitch.tsx`, saved as `codirFire`), the go = his whole message is the word go. The
   panel that owns the render presses its own button, so the job is the one a click would make.
   The other render kinds join as the Co-Director learns to set them up.
2. **What next.** Every area, in the order given in question 2. Settings, keys, bridge logins and
   model downloads (M) stay his, and so does switching a MOOD on (N).
3. **Things that can't be undone.** They stay with him.

## 5. Built (09-30), untested by him

Code: `src/main/codirReach.ts` (the new tools, their index lines, read_object, the fire jobs),
hooked into `codir.ts`. Tests: `scripts/test-codir-reach.cjs` (in `npm test`), and the window's
half in `scripts/test-codir-fire-browser.cjs`.

| area of §2 | what it reaches now |
|---|---|
| A. Firing | `fire_render` also takes `score` (a score or a sound fx), `voice`, `image_edit`, `video_edit` (a lip-sync too). Same two gates. A clip and an image gen press their panel's own button; the other four have no saved form, so main builds the same queue row the panel's button would and the window queues it |
| B. Clip Gen's dials | `set_clip_settings`: mode, resolution, aspect, sound, negative, draft, start and end frame, video and audio refs, loras and the switch, the local size, the prompt link, the pictures on beats. A size or shape the clip's engine does not make is refused; a thing the engine ignores is kept and said |
| C. Takes | `set_take_flags` (colour, disabled: clip, score, voice, image gen), `delete_take` (a clip's: the file stays, undoable), `clip_from_take`, `clips_from_images` |
| D. Char sheets | already there: `set_char_sheet_fields` writes the voice line and binds the image |
| E. The timeline | `set_timeline_audio` (Library audio on the A tracks; the clips' own sound is never touched), `set_timeline_scores` (scores and sound fx on the S tracks, no overlap on a track), `set_timeline_output` (export settings, the two whole-track mutes). Dissolves, speed and mute per clip were already in `set_timeline_clips` |
| F. Score | `create_score` (music or sound fx), `set_score`, `set_keeper_take` (`score_id`), `rename_item`, `duplicate_item`, `delete_item` |
| G. Voice | `create_voice`, `set_voice`, `set_keeper_take` (`voice_id`), `rename_item`, `delete_item` |
| H. Image Edit, Video Editor | through `fire_render` (their recipe rides the call); `set_image_primary` picks which edit is the image's face; `read_object` on an image lists its edits |
| I. Library | `rename_item` (audio, video), `duplicate_item` (image), `create_folder` / `move_to_folder` for every folder kind |
| J. Image Gen, the rest | take colour and disable (`set_take_flags`) |
| K. Assembly | `set_assembly_outline` (write the outline, lock it). Assemble stays his button |

**What it sees.** Its index (both the full one and the short one) gained: scores and sound fx,
voices, Library audio, Library videos, and each timeline's sound (A and S tracks). `read_object`
opens a score, a sound fx, a voice, a Library audio or video.

**Kept with him** (his answers, and the reasons):
- M and N: keys, bridge logins, model downloads, switching a MOOD on.
- Things that can't be undone: deleting a Library file, an image gen or an image gen's take.
- L: undo and redo, saved states, opening or making a project. Undo is one key for him, and an
  assistant that rewinds the project by itself is a worse risk than the help is worth.
- Anything that needs a file picker: imports, exporting a file.
- E, the rest: more video tracks, slices, unlink, effects. `set_timeline_clips` still lays one
  video track; a multi-track layout he built by hand is his.
- Compose (Score's button): it can watch the cut and write the beats itself, so the button is not
  on its list.
