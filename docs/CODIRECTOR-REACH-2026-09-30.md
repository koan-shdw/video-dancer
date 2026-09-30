# What the Co-Director can and can't reach (list 27)

Date: 2026-09-30 · Status: Image Gen BUILT that day (untested by him). The rest is a list for his
pick: nothing else here is built.

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
2. **What next.** Every area, in the order given in question 2. Settings, keys, bridge logins and
   model downloads (M) stay his, and so does switching a MOOD on (N).
3. **Things that can't be undone.** They stay with him.
