# Sheet Gen — spec (2026-09-08)

Director's brief, his words, 2026-09-08: right-click an image with a character in it →
**make char plate** / **make scene plate** → the Sheet Gen module opens → pick **Nano** (we
inject the prompt) OR **Seedance 2 / 2.5** (the Screen Test method: turnaround video →
frames pulled → sheet assembled) → the sheet appears in the Library as an image. One module,
two modes (character / scene). Name: **Sheet Gen** (director, over Plate Gen).

Source: the "August Cohort" call (transcript in scratchpad) + his skills (2.5 KNOWLEDGE §3,
story-blocking). The method: feed ONE image to Seedance, get a 15s video — five static shots,
3s each, a different angle every shot, no camera moves, face close-up + a detail shot — pull
one frame per shot, tile them into one reference sheet. Style never passes through an image
model, so it never drifts. Characters at **3:4**, scenes at **16:9** with the subject removed.

Status: DRAFT for approval. No code until GO. Build home = the moved renderer
(`C:\Claude\koan-shared\vidancer-ui\src`, R0 package spec 2026-09-06) + vi-dancer main for IPC.

## 1. What exists (verified at HEAD / package)

- Library right-click grammar (`panels/Library.tsx`): edit (image tree) · make clip · rename
  @title · duplicate · delete. New entries copy this shape.
- Image edit lane: **Nano Banana** (`shared/imageModels.ts`, edit endpoint, refs + aspect list)
  → results land in the Library image tree already.
- Seedance render lane: `render:run` from a clip's promptData; takes land on the clip.
- Frame pull: `extractFrame(file, t, dest)` in `src/main/project.ts` (used by dynamic stills).
- Save a renderer-composed PNG to the Library: `librarySaveFrame(bytes, note)`.
- Sibling card grammar: **Voice Gen** (`panels/VoicesCard.tsx`) — name + ＋new · MODEL house
  Dropdown · 148×148 drag box · takes via `panels/shared/takeRows` · red ✕ reason line · hero
  button with price.

## 2. Entry

Library image right-click gains two entries under *make clip*:
- `▤ make char plate` → opens Sheet Gen, mode **character**, source = this image.
- `▤ make scene plate` → opens Sheet Gen, mode **scene**, source = this image.
(Glyph enters the bible table first — bible law. Placeholder ▤ until the owner picks.)

## 3. The card — Sheet Gen (copy of Voice Gen, nouns changed)

Row 1: name (default `<@title>_sheet`) + ＋ new.
Row 2: **MODE** Dropdown: character · scene. **MODEL** Dropdown: Nano Banana · Seedance 2 ·
Seedance 2.5 (the app's existing engine ids; Seedance 2.5 default — highest quality law).
Row 3: source image = the 148×148 drag box (drop from Library; the right-click pre-fills it).
Row 4: **prompt** — textarea, pre-filled with the injected Screen Test prompt for the mode
(§4), editable. His words when we have them, ours until then.
Row 5: hero button `render sheet` + price line (Seedance 15s at the clip rate · Nano at the
edit rate — the same price plumbing the siblings use).
Takes card: the turnaround videos (Seedance path) as standard take rows; each row has
`▤ build sheet` which pulls frames and composes (§5). Nano path: no video — the result is the
sheet itself, straight to the Library.
Red ✕ reason line on failure, as the siblings.

## 4. The injected prompts — the Screen Test contract (skill zip received 2026-09-08)

His skill does not carry a verbatim prompt: it carries a CONTRACT the host prompter fills.
Ours fills it through the clip's own fields (the cascade) — the card pre-fills scene /
characters / beats / production from the mode; the user can edit any of them. Both clips:
**Seedance ref2v, 15s, 3:4, 720p, ONE reference (the base image), audio on but near-silent.**

**CLIP A — five-view turnaround** (the contract, his words condensed):
- `reference_handling`: the base image = identity AND style anchor — keep the design and its
  exact rendering (name the line, highlight behavior, palette, grain). Change ONLY three
  things: the pose (calm standing model-sheet views instead of the base image's dramatic pose),
  the background (strip the environment → neutral seamless grey studio), the framing per view.
  "All staging is decided by the storyboard."
- `style`: saturated with the aesthetic, and restated in visual_feel, production_notes,
  animation_style — a cue stated once drifts. Put "flat character on neutral seamless grey
  studio background" inside the style line itself.
- `visual_feel`: calm, still, fully displayed, a model sheet; even readable light; hard cuts,
  no dissolves.
- character block: base / distinguishing features / signature prop / `pose_in_this_scene` =
  calm standing, near-still, micro-motion only (breath, cloth drift); "no combat, character
  and gear identical across all five shots, only the viewpoint changes."
- conditional blocks: **scale_logic** + a fail_test when a prop is outsized (else it shrinks
  to human scale); **color anchor** when skin/costume is saturated ("render as-is on grey; do
  not lighten, grey out, desaturate" — grey studios pull color toward grey);
  **proportion_logic** when the base crops the body ("the reference shows no legs; long legs
  in proportion, standing").
- beats, 5 × 3s, every one "locked, static", hard cut between: (1) full-body FRONT eye level,
  whole figure + prop in frame with margin; (2) full-body SIDE, clean 90°; (3) full-body BACK;
  (4) tight FACE close-up, head and shoulders, face lifted to camera; (5) DETAIL close-up of the
  one element that must never drift. Lighting: even frontal key, soft fill, faint cool rim;
  the side view lets the key rake for highlight behavior.
- production_notes: audio = no music, minimal room tone, one soft breath; motion register =
  calm, near-still, held on twos, no interpolation smoothing, ANY camera movement forbidden,
  no dissolves; critical_constraint restates exact render / neutral grey / five locked views /
  identical character across cuts; avoid: camera movement, dissolves, the base image's
  environment, hero angles, combat, motion blur, photoreal/CGI/3D/smooth interpolation,
  jitter, warped limbs, flicker, identity drift between cuts, extra limbs, set dressing.

**CLIP B — expression sheet**: run from a PULLED FACE FRAME of Clip A (already the video
model's texture), "match its rendering exactly." Framing locked for all five cuts: tight
frontal head-and-shoulders, identical framing and key. Identity marks PINNED BY NAME ("must
appear in every shot, same position, shape, size; never fades, moves, shrinks" — unpinned
marks vanish by cut three). Five emotions pushed to extremes, each with an `expression_read`
NOT-line ("pure warm joy, not smugness, not a sneer"); typical set joy · anger · grief ·
laughter · the character's peak state. Micro-motion inside each hold only; no head turns; one
matching vocalization per hold under room tone; no music.

**SCENE mode** is our extension of the same recipe (his cohort call, 2026-08): subject
removed, five distinct angles/locations of the space, 16:9.

His six corrections, kept as law: locked static views + hard cuts (a slow turnaround
drifted) · scale_logic with fail_test · color anchor · proportion_logic · marks pinned by
name · pulled frames beat the base image as the expression-pass reference.

Earlier shape notes (superseded by the contract above, kept for the record):
- **character**: `@image1` defines the character — identity, outfit, palette, line style; do
  not use its background or pose. 15 seconds, five static shots of 3 seconds each, a hard cut
  between them, NO camera movement inside a shot: (1) full-body FRONT, (2) full-body SIDE,
  (3) full-body BACK, (4) face close-up, (5) one detail shot (his example: the hand). The
  character alone on a **neutral gray background**, full body in frame. Same style as the
  image — no restyle. No text, no BGM. **Aspect 3:4** — he tested every ratio, 3:4 won.
- **expression pass** (his second step, OPEN — director names it): take the face close-up
  frame as the new `@image1`, same 15s / 3s / 3:4 recipe, five distinct emotions and facial
  expressions instead of angles → an expression sheet. Specific emotions can be requested.
- He runs the CHINESE prompt on Seedance ("they work better") — note only; our wire is
  English until proven otherwise on our engines.
- **scene**: `@image1` defines the environment — architecture, materials, light, palette; do
  NOT show any person or creature from it. 15 seconds, five static shots of 3 seconds each,
  hard cuts, no camera movement: five distinct angles and locations within the space (wide,
  reverse wide, low detail, high top-down, a doorway/threshold). No characters. No text, no BGM.
- **Nano** (single image, edit endpoint): same content, phrased as one image — "make a
  character reference sheet: front, back, 3/4, face close-up, detail, on a flat neutral ground,
  same style as the input" / "make a 2×2 environment reference sheet of this space, empty of
  people". Aspect 3:4 (character) / 16:9 (scene).
Emitted in the engine's flavor via the shared compiler (YAML for Seedance 2, prose for 2.5
when the prose emitter lands — until then the YAML wire the app has).

## 5. Build sheet (Seedance path)

Port of his `screen_test.py` (ffmpeg + ffprobe, stdlib only) into a main module
`src/main/sheet.ts` — same math, no Python:
1. **Find the real cuts**, don't trust the 3s grid (measured cuts landed at 2.9 / 4.7 / 6.4 /
   12.7s): ffmpeg `select='gte(scene,0)'` per-frame scene scores → take the 4 biggest jumps
   with ≥1.0s spacing, ignoring 0.5s at each edge. Fewer than 4 found → fall back to the grid.
2. **One frame per segment**: the middle of each detected segment, 0.35s clear of both cuts.
   `extractFrame`-style ffmpeg pull → `<name>_view<N>.png` ×5 into the project's images
   folder (all five land in the Library; the side view is a loose reference even off the sheet).
3. **The sheet**: 1080×1440 canvas, four 534×714 quadrants, 12px black cross gutter, no outer
   border, stills cover-fit (3:4 sources fit with a hair of crop; never letterboxed). Default
   layout TL front · TR back · BL face · BR detail (his `--pick 1,3,4,5`); the card lets the
   user swap any quadrant from the five pulled views. Scene mode: the four full-environment
   views. Built with ffmpeg `filter_complex` hstack/vstack exactly as his script does.
4. **QA before it shows** (his rule, ours automated + one human check): four DIFFERENT views
   — if two quadrants read the same, offer the contact strip (12 thumbs per segment) so the
   user picks; frames sharp, not on a transition smear.
3. `librarySaveFrame(png, 'sheet · <name> · <mode> · <engine>')` → Library image titled
   `@<name>` (the card's name field), genPrompt = the prompt used. Undoable like any import.
4. The turnaround video stays as the take on the Sheet card (re-pull any time). OPEN §7.

## 6. Data — a sheet is a CLIP (director, 2026-09-08)

"Sheet Gen really makes a Clip Gen clip, streamlined for its purpose." No new citizen:
- The turnaround is a normal Bin clip. Sheet Gen seeds its promptData from the contract
  (§4) for the mode; every render lands as a TAKE; re-roll freely; keeper rules as usual.
- The clip carries one tag: `sheet: { mode: 'character' | 'scene' | 'expression',
  sourceImageId }`. Opened in Clip Gen it is just a clip — every field visible, editable.
- Bin double-click routes a tagged clip to **Sheet Gen** by default; right-click adds
  **open in Clip Gen** for the full card. Untagged clips never open in Sheet Gen.
- **build sheet** runs on the keeper take (or right-click any take → build sheet); output =
  the five pulled views + the 1080×1440 sheet in the Library, titled from the card's name.
- Delta/undo through the standard clip paths — nothing new to persist beyond the tag.

## 7. Open questions (director)

1. SETTLED (director): the turnaround is a Bin clip, renders are its takes, re-roll allowed;
   Sheet Gen by default, "open in Clip Gen" on right-click (§6).
2. SETTLED by his skill: default tiles front · back · face · detail, side stays loose.
3. Glyphs: DRAWN person (char plate) + scene (scene plate), entered in bible ch. 03
   2026-09-08 (first drawn entries; drawing awaiting the owner's eye — scratchpad
   sheet-glyphs.svg). They become the app's first non-lucide icons in `ui/icons.tsx`, same Ic
   contract (24-box, stroke 1.75, currentColor). Expression plate reuses person until told.
4. SETTLED: the contract is in §4 (skill zip received).
5. SETTLED (director): expression plate = right-click the pulled face image → `make
   expression plate` (Clip B, §4).
6. SETTLED (director, "make it into the bible"): bible 12.8 carries the law; the wire writes
   "a multi-panel model sheet — take identity from all panels, copy none of the framings" for
   every sheet-tagged ref; the Co-Director guide carries the same sentence. Sheet-tagged =
   an image produced by build sheet (`ProjImage.sheet` marker).

## 8. Acceptance

1. Right-click → make char plate opens Sheet Gen with mode + source set.
2. Seedance 2.5 render lands a 15s take on the card; build sheet lands a Library image with
   five distinct angles + the source; title `@name`; undo removes it.
3. Nano path lands the sheet image directly; same title rule.
4. Scene mode: no subject in any tile, 16:9 tiles.
5. Field-run by the owner on a real character image (KATA's @monk).
