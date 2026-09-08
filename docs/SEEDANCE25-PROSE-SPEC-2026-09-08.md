# Seedance 2.5 bracketed-prose emitter — spec (2026-09-08, rev 2)

Director's brief: Seedance 2.5 wants bracketed prose, not YAML; we send it Seedance 2 YAML.
Applies to EVERY door that serves 2.5 (the grammar belongs to the model, not the supplier —
director 2026-09-08). Rev 2 corrects rev 1: the shape is bracketed SECTION HEADERS with prose
inside, not one flowing paragraph.

Status: DRAFT for approval. No code until GO.

## 1. Sources — verbatim

**August cohort call (a call transcript):**
- "you select which prompter you want to use, the 2.0 prompter or the new 2.5 prompter. The
  2.0 prompter is going to be a slightly updated version of the V3, and the 2.5 prompter is
  going to be a non-YAML format written in more of the paragraph style."
- "I do run one in both 2.0 and 2.5, and then I choose which one I like better."
- "2.0 resolved [the rack focus] as a push-in with the camera … 2.5 understood better."
- Lip-sync: do it in H3, then use that video as a reference for 2.5 quality.

**The `seedance-prompter-2.5/KNOWLEDGE.md` (the skill files; "built 2026-08-03 from
the official ByteDance/Dreamina Seedance 2.5 Prompt Guide + User Guide"):**
- §1: "Every top-performing 2.5 example in the official guide … is written as bracketed section
  headers with natural-language prose inside, plus inline `@image1 defines…` role lines up top
  and inline timestamp markers in the storyboard. It is NOT `key: value` YAML." "YAML still
  generates, but you leave motion quality and instruction-following on the table."
- The canonical skeleton: `[Reference Roles]` (only if refs) → `[Global Setting]` (Base
  Environment & Texture / Visual Style / Camera Language) → `[Character Styling]` (one block
  per character) → `[Core Performance]` (the ONE thing the render must nail) → `[Timestamp
  Storyboard]` (`[00:00–00:03] <shot> — <action/expression> — <emotion or camera subtext>`,
  one primary change per beat) → `[Negative Prompts]` ("2.5's negatives actually work now").
- "Bracket names are flexible, not a schema … The invariants are: (1) global/world block
  FIRST, (2) subjects modeled before the timeline, (3) a timeline with one change per beat and
  inline timestamps, (4) negatives last. Reference-role lines always sit at the very top."
- §4: the token is `@image1` — lowercase, no space, positional (the Nth material attached to
  THIS clip), every token enumerated. Official Dreamina web UI displays `@Image 1`; the
  platform resolves raw `@image1`.
- §5 typed channels: `( )` music · `< >` sound effects · `{ }` dialogue · `【 】` on-screen
  text. Dialogue formula: **Dialogue Language + Regional Variety/Accent + Delivery Style +
  Speaker + {line}** — e.g. "Dialogue language: American English. The girl says in natural,
  conversational American English: {I thought you weren't coming.}" Default working
  convention: no BGM, no subtitles → in `[Negative Prompts]`.
- §7.3: ranges `[00:00–00:03]` consecutive and non-overlapping; one-second precision only for
  a critical handoff; never demand a frequency.

**fal's 2.5 reference-to-video page:** refs are `[Image1]` / `[Video1]` / `[Audio1]` by list
order — the one door with its own documented token.

## 2. What exists

- `promptStyle` per engine (`shared/models.ts`): `'yaml' | 'natural' | 'prose'` →
  `buildCombinedFor` in `shared/compile.ts`. Every 2.5 engine today has NO promptStyle → YAML.
- Six 2.5 engines: `seedance25` (fal), `seedance25hfmcp` (Higgsfield), `seedance25runway`,
  `seedance25mag` (Magnific), `seedance25bridge`, `seedance25ark` (ModelArk). No Astria 2.5.
- Ref tags: `applyRefTags(text, titles, 'IMAGE_REF' | 'ImageN')` swaps `@title` → the engine's
  token at render; the visible prompt keeps `@title`. Seedance doors keep `@title` today.
- The freeform prompt rides on top verbatim for every style (law). `read_compiled_prompt`,
  the "generated from fields" box and the wire all use the one compiler.

## 3. The emitter — `buildSeedance25(d, refs)` → `promptStyle: 'seedance25'`

The skeleton, our fields. Empty fields vanish; empty sections vanish. Bracket labels are
his canonical ones. Every line is prose (sentences, periods), never `key: value`.

```
[Reference Roles]                         ← only when refs are attached
@viking defines Viking's appearance, clothing and material. Do not use its pose or framing.
@snow_ridge_sheet defines the environment — take identity from all its panels, copy none of its framings.
Reference handling: <scene.referenceHandling verbatim>.

[Global Setting]
Base Environment & Texture: <scene.title>. <production.lighting>.
Visual Style: <scene.style>, <scene.visualFeel>. <production.animationStyle>.
Camera Language: <N> shots, hard cuts.          ← N = beat count; one beat = "one continuous take"

[Character Styling]                       ← one block per character with a name
<name>: <base>. <features>. <physics>. <movement>. <emotionalState>. <stateInThisScene>. <power>.

[Core Performance]
<production.criticalConstraint>. The mood is <production.subtext>.

[Timestamp Storyboard]                    ← one line per beat, ranges from beat lengths
[00:00–00:04] <camera> — <action> — <lighting>. <vfx>. <reaction>. <A bell rings> <sfx>
Dialogue language: English. <speaker or "The character"> says: {<dialogue>}
[00:04–00:08] …

[Negative Prompts]
No <avoid item>, no <avoid item>, no subtitles, no BGM.
```

Rules:
- **Reference roles** come from what the app KNOWS: a character whose `referenceLabel` matches
  a ref's `@title` → "defines <name>'s appearance, clothing and material. Do not use its pose
  or framing."; a sheet-tagged ref → the sheet law line; a plain ref with no link → "@title is
  a reference." (never an invented role). `scene.referenceHandling` rides as its own sentence.
- **Format facts** (duration / aspect) go in `Camera Language` only when set: "<dur>-second,
  <aspect>." Aspect on auto = nothing (the API param carries it).
- **Timestamps**: `[mm:ss–mm:ss]` from beat lengths, consecutive, non-overlapping, the last
  range ends at the clip duration. Camera goes first in the line (the "shot"), then action,
  then lighting — the `<shot> — <action> — <subtext>` triplet.
- **Dialogue**: every `{line}` preceded by `Dialogue language: English.` (director 2026-09-08:
  default English) and the speaker's voice note when the character has one ("says in <voice>").
  SFX `< >`, music `( )` from `production.audioDesign` ONLY when it names music — otherwise
  audioDesign rides as a plain sentence in `[Global Setting]`; `【 】` never emitted (no field).
- **Negatives**: `production.avoid` split on commas/semicolons → "No x, no y" + the working
  convention "no subtitles, no BGM" appended unless audioDesign asks for music.
- Deterministic and pure like `buildProse`; the freeform stays on top verbatim.

## 4. Ref tokens at the wire

- fal `seedance25`: `refTagPrompt: '[ImageN]'` — a third `applyRefTags` format, `[Image N]` by
  upload order (fal's own doc). Director: "agreed, if fal is image1".
- Every other 2.5 door: `refTagPrompt: 'imageN'` → `@imageN` lowercase positional (the
  official deck via the guide §4). The visible prompt keeps `@title` everywhere; the swap is
  render-time, as Gemini/LTX do today. Reference-role lines get the same swap.

## 5. Lint (when promptStyle = seedance25)

- Beat camera stacking three moves → "pick one move per beat" (the guide §8.3 "PICK ONE EVERY BEAT").
- "cinematic" alone as a camera → "not a camera move".
- A beat with more than one dialogue line or "do N things in one second" phrasing → "never
  demand a frequency" (§7.3).
- YAML key lints skipped.

## 6. Files

- `shared/compile.ts`: `buildSeedance25`, `buildCombinedFor` gains the style, the lint branch,
  `applyRefTags` gains `'[ImageN]'` and `'imageN'`. `shared/models.ts`: `promptStyle:
  'seedance25'` on the six 2.5 engines; `refTagPrompt` per §4. Types: the promptStyle union.
- Main: the compile path is shared — the `[ImageN]`/`@imageN` swap rides the existing
  refTagPrompt hook in the render wire. Guide: one line — "2.5 doors emit the bracketed
  skeleton; read it with read_compiled_prompt before judging a 2.5 prompt."

## 7. Acceptance

1. Clip Gen on a 2.5 engine: "generated from fields" shows the bracketed skeleton; Seedance 2
   still shows YAML.
2. A 3-beat clip: `[Timestamp Storyboard]` has three consecutive `[mm:ss–mm:ss]` lines
   matching the beat lengths, the last ending at the duration.
3. A clip with a linked character ref: `[Reference Roles]` names it with "Do not use its
   pose or framing"; a sheet ref gets the sheet law line.
4. Dialogue emits as `Dialogue language: English. … says: {…}`; sfx as `< >`.
5. fal 2.5 wire prompt carries `[Image1]`; Higgsfield 2.5 wire carries `@image1`; the visible
   prompt keeps `@viking` (bridge log = the wire; read_compiled_prompt = the visible form).
6. `[Negative Prompts]` ends with "no subtitles, no BGM" unless audioDesign asks for music.

## 8. Settled (director, 2026-09-08)

1. Dialogue language: default English.
2. fal = `[Image1]` (its doc); the other doors = `@image1` (the official deck).
3. Aspect: say it only when set; auto = nothing.
