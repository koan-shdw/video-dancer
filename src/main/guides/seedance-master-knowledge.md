# Seedance Prompter — Master Knowledge Base v4

Reference library for Seedance 2.0 and 2.5 cinematic prompting. v4 = the production-hardened v3 canon merged with official-guide and community research (2026-08-06, see docs/SEEDANCE-AUDIT.md): reference role-binding, audio/dialogue/text direction, video+audio references, and the Seedance 2.5 grammar. Structure the app already enforces (field order, timestamps, tag formatting) stays out. House rules that are ours alone (reference_handling early, pose-exclusion lists, camera word cap) are kept — they are production-proven — and layered with the documented techniques.

---

## 1. Field Guidance

- `style:` — The single most important stylistic field. Genre, named cinematic references, art movements, production styles. Resolution targets (4K, 2K) belong here as style anchors. Technical LOOK vocabulary is welcome here — film stocks ("Kodak Vision3 500T"), camera aesthetics ("35mm film tone", "ARRI ALEXA aesthetic") — because it describes grade and texture. What stays banned everywhere is technical SPECS driving camera motion (f-stops, ISO, mm, fps). 15–30 words, tight.
- `visual_feel:` — Visual rhythm and texture in sensory language: "slow," "smooth," "warm," "gritty," "stable," "dreamy," "handheld," "gentle." Rendering intentions (subsurface scattering, volumetric fog, film grain) are fine: they describe visible texture.
- `reference_handling:` — Governs how references are used. See Sections 6–7 — the most important material in this document.
- **Characters** — every entity that appears on screen (characters, objects, hands, creatures, props with agency) gets:
  - `base:` — what it is and which reference it matches, if any.
  - `features:` — specific enough to render: colors by name, materials by texture, wardrobe by item.
  - `physics:` — how it moves, deforms, or emotes; material behavior; personality expressed through physicality, not adjectives.
  - `movement_in_this_scene:` (when relevant) — this clip's movement restrictions, placed INSIDE the character block where the model parses them together with the character. See Section 6, Rule 4.
  - `emotional_state:` (when relevant) — the tone and demeanor carried throughout.
  - `state_in_this_scene:` (when relevant) — the character's starting state this clip: wounds, missing parts, posture. See Section 6, Rule 5.
  - `power_this_scene:` (when relevant) — the mechanical behavior of an ability that activates in this clip.
- **Shots (beats)** — per shot: `camera:` (one primary move), `action:` (choreography), `lighting:` (always — even 3–5 words), plus optional `dialogue:`, `vfx:`, `reaction:`, `sfx:`.
- **Production notes** — `audio_design:` (sound philosophy — never left to default, see Section 8), `lighting:` (overall strategy; per-shot notes override), `subtext:` (what the scene is really about), `critical_constraint:` (hard creative rules, spatial locks, repeated reference rules), `avoid:` (stability — Section 5), `animation_style:` (frame cadence, interpolation, stop-motion holds).

---

## 2. Camera Discipline

### The One-Primary Rule
Every `camera:` field gets **one primary movement instruction**, optionally one secondary sequenced with "then." Never three or more. Keep the field under 20 words (house rule).

**DO:** `"Slow push-in, low angle."` · `"Handheld tracking shot, then gentle rise."` · `"Static wide shot. Hold."`

**DON'T:** `"Handheld over-the-shoulder tracking shot from behind and slightly below, pushing through the crowd with anamorphic streak flares and focus hunting."` — four competing instructions; the model jitters trying to satisfy all of them.

### Camera Types the Model Parses Cleanly

| Camera Type | Best For |
|-------------|----------|
| Push-in / dolly in | Close-up emphasis, emotional focus |
| Pull-out / dolly out | Environmental reveal, context |
| Pan / lateral | Tracking, scanning |
| Tracking / follow | Action, walking |
| Orbit / arc | Product showcase, portraits |
| Aerial / drone | Landscapes, scale |
| Handheld | Documentary, realism |
| Fixed / locked-off | Focus on subject action |
| Tilt / crane | Reveals, scale, dramatic transitions |
| Rack focus, whip pan, Hitchcock zoom | Punctuation moves — one per clip at most |

### Position/Angle Vocabulary
Set the camera's position before its movement: extreme macro close-up · low tabletop angle · over-the-shoulder · high-angle master · Dutch angle · first-person POV · low angle looking up · medium two-shot · wide establishing · overhead top-down · 90-degree side profile at ground level · worm's-eye · inverted. Shot sizes (CU / MCU / WS) parse cleanly.

### Rhythm Over Specs
Describe camera MOTION with rhythm words (slow, smooth, gentle, controlled, stable, imperceptible), never technical parameters (24fps, f/2.8, ISO 800, 85mm, rack focus at 0.3m). Look tokens live in `style:` (Section 1); they must not drive movement.

### Speed Asymmetry Rule
**Never combine fast camera + fast subject action + complex scene — the #1 cause of artifacts and jitter.** If the action is fast, the camera is slow/stable. If the camera is dynamic, the action is controlled. Complex scenes: both slow. Only one speed axis may be "fast" at a time.

### Separate Camera from Subject
Camera movement and subject movement are described independently, never blended.

**DO:** `camera: "Fixed wide shot. Hold."` + `action: "The dancer spins slowly across the frame."`
**DON'T:** `camera: "Spinning camera around a dancing person."`

### Continuous Shots Need Negative Direction
The model defaults to inventing cuts. For a one-er, say so explicitly: **"one continuous shot, no cuts, no zoom."** For POV work add "the camera IS her eyes." In freeform prose prompts, "cut to" between shots is the delimiter the model honors most reliably; in this app the beats carry that job.

### Lens Effects
Focus racks, shallow DOF/bokeh, anamorphic flares, film grain, motion blur belong in `visual_feel:` or `vfx:` — never crammed into the `camera:` field.

---

## 3. Action Writing

Every verb describes a visible, frame-by-frame movement. Choreography, not narrative summary.

**DO:**
- "Her eyes well up with tears. She pouts her lips excessively. She quickly grabs all three daifukus, hugging them to her chest."
- "He pinches a single red wire protruding from a port near her jawline. He pulls it. Slowly. Six inches of red cable slides out with a faint mechanical click-click-click."

**DON'T:**
- "She gets upset and grabs the food."
- "He activates her mechanism."

### Words That Give the Model Nothing
These degrade output in any field:

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| "epic" | Meaningless to the model | Describe the specific visual effect |
| "amazing" / "beautiful" / "stunning" | Adjectives without guidance | Specific lighting, composition, texture |
| "lots of movement" | Causes jitter from over-motion | One specific, described motion |
| "fast" (unqualified) | Causes chaos without direction | "swift single step," or keep action slow |
| "cool" / "dynamic" | Vague aesthetic | Name the exact aesthetic reference |
| "cinematic" (alone) | Too vague | Always pair with a specific reference |

Never stack multiple unqualified speed words.

---

## 4. Lighting as a Lever

Lighting is the **highest-leverage single element** in any prompt — if you can only add one thing, add a lighting line. Every shot gets a `lighting:` field, even brief.

| Keyword | Effect |
|---------|--------|
| golden hour | Warm tones, long shadows |
| rim light | Edge highlights separating subject from background |
| natural light | Soft, realistic illumination |
| neon | Colored glow, cyberpunk/urban |
| backlit | Silhouette potential, dramatic depth |
| overcast | Even, diffused, no harsh shadows |
| volumetric | Light rays visible through fog/haze/dust |
| practical light | Source visible in frame (lamp, candle, screen) |
| chiaroscuro / single-source wash | High-contrast drama |

The global philosophy still lives in `production_notes` → `lighting:`; per-shot notes override for their beat. If output comes back flat or blurry, fix the lighting line before anything else.

---

## 5. Stability Constraints (Negative Prompts)

There is no negative-prompt API field — exclusions are in-prompt text. Every prompt includes an `avoid:` field. Standard baseline:

```
avoid: "Jitter, bent or distorted limbs."
```

Add based on scene type:

| Condition | Add to Avoid |
|-----------|-------------|
| Clips over 10 seconds | "temporal flicker" |
| Character-driven scenes | "identity drift" |
| Complex scenes (crowd, particles, many elements) | "chaotic composition" |
| Multi-shot with same character | "inconsistent features between shots" |
| Slow/contemplative scenes | "unnecessary camera movement" |
| Scenes with reference images | "Character frozen in reference-image pose" (Section 6) |
| Unwanted captions appearing | "subtitles, on-screen text" |

Positive stability vocabulary works from the camera side too: "gimbal-smooth," "stabilized," "tripod-stable."

---

## 6. Reference Image Discipline

**The most important section for production work. Failures early in a project are almost always failures of reference discipline. Apply these rules from the first prompt and cold-start drift disappears.**

### The Core Problem
The model reads reference images first and uses their composition, pose, and framing as a prior. Two distinct failure modes: (1) the scene drifts back toward the reference pose; (2) multiple unlabeled refs get AVERAGED into a hybrid face or scene — the #1 reported failure across the community.

### Rule 0: Role-bind every reference (the biggest one)
Every attached ref gets a stated JOB and an EXCLUSION, in `reference_handling` or the character's `base:`. Never leave a ref unexplained.

**DO:** `"@hero is the character's face, hair, and outfit. Do not use its background or pose. @alley_bg is the environment only — no people from it. @fight_ref is camera movement and pacing only."`

Fewer refs beat more refs: every ref you can drop reduces drift. Per character: at most 3 stills (front, three-quarter, profile) with matched lighting, plus optionally one 2–3s neutral-motion clip. Never collages — the model treats them as one busy scene. The first-listed ref carries the most weight: order refs character → product/prop → scene → style.

### Rule 1: Fill `reference_handling` whenever references are attached
It is parsed early (the app places it second, right after the title), so the model reads the reference rules before the characters and storyboard. Never leave it empty on a prompt with references. (House rule: early placement is our production-proven habit; role-binding above is what the official guides demand. Do both.)

### Rule 2: Name the specific reference composition to avoid
A general disclaimer does not work. Open the reference image, identify the pose/framing/composition that would cause drift, and name it directly.

**Weak (ineffective):** `"The reference image is for character design only, not scene composition."`

**Strong (effective):** `"CRITICAL: the references are used STRICTLY for character design, color palette, and styling. DO NOT reproduce either image's pose, framing, or composition. DO NOT show Kali frontally with four arms fanned outward in deity display pose. DO NOT show Raktabija running forward with cleaver raised overhead at the camera."`

Name the pose, the framing, the body position, the angle relationship to the camera.

### Rule 3: Describe framings that are spatially incompatible with the references
The most powerful anti-drift technique: choose shot compositions the reference image physically cannot fit into.

- Extreme macro close-up on a specific body part (hands, eyes, wound, weapon edge)
- Overhead top-down looking straight down
- 90-degree horizontal side profile at ground level
- Over-the-shoulder from directly behind
- Inverted / upside-down close-up
- First-person POV from another character's eyes
- Extreme low-angle worm's-eye looking up past feet

Rotate through these across a clip's shots — no repeated framing twice within the same clip.

### Rule 4: Use `movement_in_this_scene` inside the character block
When a character's movement in this clip is restricted or shaped, put the rule inside the character block:

```yaml
movement_in_this_scene: "Raktabija is NEVER shown running forward with cleaver overhead in this scene. He fights in close quarters — grappling, slamming, swinging at close range. His mouth is NOT constantly gaping wide — he snarls, bites, roars, closes."
```

The model parses movement rules alongside the character description — much more effective than the same restriction in the `avoid:` list.

### Rule 5: Carry visible physical damage forward between clips
In multi-clip sequences, damage sustained in a previous clip is described explicitly in this clip's `features:` or `state_in_this_scene:` ("ONE curved horn — the other was ripped off during the previous round, leaving a bloody bone stump"). This prevents narrative reset (the model has no memory across generations) and gives the model a sharper, more unique design to lock onto — a damaged character drifts less toward the clean reference. By clip five of an escalating story, the characters should look visibly battered.

### Rule 6: Identity locks and redundant enforcement
Identity-lock phrasing belongs in character-heavy prompts: **"Do not alter facial proportions, eye shape, or hairstyle. Maintain wardrobe consistency."** Keep one environment per generation where possible — drift accelerates with scene changes. And even with `reference_handling` at the top, restate the most important anti-drift rules in `critical_constraint:` at the bottom. Redundancy is not noise here — it is reinforcement.

### Policy note
ByteDance's official ModelArk route refuses references containing realistic identifiable human faces. Real-people refs are a fal-route job.

---

## 7. Video & Audio References

Seedance 2.0 (fal) accepts up to **9 images + 3 videos + 3 audio files — 12 refs total**. Videos: each 2–15s, combined ≤15s. Audio: combined ≤15s, requires at least one visual ref alongside; MP3 is the safe format (WAV/AAC have failed silently on some hosts). In this app the slots are positional (`@video1…`, `@audio1…`) and the user attaches them in the Render Panel; images go by @title.

- **Role-bind these too.** "reference @video1" alone is the #1 reported failure. Say WHAT: `"@video1 is camera movement and pacing only."` · `"@video1 is the action choreography — not the characters."` · `"@audio1 is the score: match its rhythm and mood."`
- **Continuation:** the official verb is **"Extend @video1 by 5s."** — and the duration you set is the NEW seconds generated, not the total. Backward extension ("Extend backward 5s: [what led here]") and insert-between ("Add a scene between @video1 and @video2: [content]") exist. "Continue from @video1." also works as an opener. Either way, still fully re-describe characters and scene — extension aids continuity, it does not replace re-establishment (Section 15).
- **Chained extensions degrade.** Clips 1–3 hold, then drift compounds — re-anchor aggressively: re-attach the original character stills every 2–3 extensions and repeat the identity locks.
- **Audio refs steer music/voice.** A music window ref sets the score's character; say whether to follow its rhythm, mood, or instrumentation.

---

## 8. Audio, Dialogue & On-Screen Text

Seedance generates audio natively — and audio is where most prompts under-direct. Never leave it to default.

### The audio brief
- **Name the diegetic sounds:** "the low roar of the furnace, the creak of the turning rod, a faint hiss as the surface cools."
- **Silence must be explicit:** "no music" / "no voiceover" when you mean it. Expect "no music" to be ignored sometimes — plan to mute in post. Requested SFX behave better than requested silence.
- **State the mix hierarchy:** "Dialogue clean and prominent, music low, ambient subtle." Max 2–3 simultaneous layers or it muddies.
- **Texture words work:** muffled, echoing, crunchy, reverb, sharp.
- **Timing anchors work:** "SFX: thunder crack at 3s" (rock-solid on 2.5).

### Dialogue
- Exact lines in **double quotes** = lip-synced speech. In this app, the beat `dialogue:` field carries them.
- **5–10 words per line.** Long monologues drift out of sync — split a speech into short lines across cuts.
- Language and delivery tags work: `speaks in Japanese, dry and a little proud: "…"`.
- Best lip-sync conditions: front-facing medium close-up, stable camera. Strongest languages: Mandarin, then English; JP/KR drift on long phrases.

### On-screen text
Controllable: give the text (in quotes) + when it appears + where in frame + how + style. `"the words 'SLOW MORNINGS' fade up in the lower third in a thin serif at 12s."` 3–5 word supers perform best. Unwanted captions: add "subtitles, on-screen text" to `avoid:`.

### Audio design patterns by genre

| Genre | Audio Approach |
|-------|---------------|
| Macro / ASMR | Wet textures, contact sounds, amplified material interaction |
| Horror / Cyberpunk | Silence as weapon, sub-bass detonations, metallic impacts |
| Comedy / Dramedy | Ambient room tone, sharp punctuation sounds, dialogue pacing |
| Anime / Healing | Soft ambient, wind, water, kitchen sounds, gentle musical stings |
| Action / Fantasy | Layered SFX (impact + reverb + environmental), orchestral swells, bass drops |
| Stop-Motion | Diegetic only, tactile material sounds, no score unless specified |
| Brutal Deity Combat | Distinct vocal signatures per combatant, wet organic impacts, silence beats |

---

## 9. Genre Adaptation Patterns

The template skeleton stays the same. The vocabulary, density, and emphasis shift by genre.

### Cute / Kawaii / Stop-Motion
- `style:` references Laika, Aardman, Pixar short films. Names material textures (clay, felt, dough).
- Character modeling emphasizes tactile material physics (jiggles, squishes, bounces).
- Action lines lean into exaggerated expressions and held comedic beats.
- Production notes specify animation cadence ("stop-motion holds and pops, no smooth tweening").
- SFX are diegetic and ASMR-forward. Camera mostly fixed or slow.

### Cyberpunk / Horror / Action
- `style:` references specific films or directors, volumetric atmospheric effects.
- Character modeling emphasizes material science (automotive paint sheen, translucent tubing, chrome vertebrae).
- Action lines rapid and precisely sequenced — but apply the speed asymmetry rule.
- Camera work can be aggressive but still follows the one-primary rule.
- Audio design often uses silence as a weapon.

### Comedy / Dramedy / Dialogue-Driven
- `style:` references specific shows or directors for comedic timing.
- Storyboard paced around dialogue beats, not visual spectacle.
- Camera uses snap-zooms and held reaction shots. `subtext:` explains the joke's logic.

### Anime / Moe / Japanese Healing
- `style:` references specific anime aesthetics (4K Moe, healing genre, ukiyo-e).
- Character modeling includes anime-specific features (ahoge, chibi proportions, star-highlights).
- VFX stays stylized — painted-on effects, 2D surface animation, watercolor dissolves.
- Lighting warm, golden-hour, soft-focus bokeh. Audio quiet ambient and ASMR.

### Game / HUD / Interactive Style
- `style:` specifies game genre and perspective (TPS, FPS, ADS transitions).
- HUD element placement and state-machine animation logic go in the freeform prompt.

### Brutal Deity Combat / Mythological Violence
- `style:` references specific anime combat lineages (Samurai Champloo, Ninja Scroll, Madhouse-era violence).
- `subtext:` grounds attacks in specific lore sources — canonical powers land harder than invented ones.
- Physical damage visible and carried forward (Section 6, Rule 5). Both combatants always in motion.
- Spatial layout locked throughout and stated in `critical_constraint`.
- Audio layers each combatant's distinct vocal signature plus wet organic impacts.

Director-name style anchors ("Wong Kar-wai palette," "Villeneuve scale") outperform stacked adjectives in any genre.

---

## 10. Prompt Density & Workflow

The model's practical ceiling is ~5,000 characters; our working target stays **under 4,000** for headroom. Flat prose prompts do best at 60–100 words; structured multi-shot prompts legitimately run far longer — density has diminishing returns and can introduce conflicts, so every sentence must earn its place.

- `camera:` under 20 words. One primary, optionally one secondary.
- `action:` 30–80 words per shot — choreographic specificity is the competitive advantage.
- `style:` 15–30 words. `visual_feel:` 15–25. `lighting:` per shot 5–15.
- `reference_handling:` 30–80 words — specificity is the entire point.

**The Redundancy Test:** before finalizing, ask of every sentence — "can the model render this in a video frame?" If not, cut it. **Exception:** `subtext:` and `reference_handling:` may contain non-renderable directorial guidance.

**Start small:** probe a new scene at 4–5s and cheap resolution before the long spend. Change ONE variable between takes — prompt, refs, or duration, never all three.

---

## 11. Timestamp Scaling and Pacing

| Duration | Recommended Shots | Avg Seconds Per Shot |
|----------|-------------------|----------------------|
| 5s       | 2–3               | 1.5–2.5s            |
| 10s      | 3–4               | 2.5–3.5s            |
| 15s      | 4–7               | 2–4s (staggered)    |
| 20s (2.5) | 4–6              | 3–5s                |
| 30s (2.5) | 4–6 max          | 4–8s (staged beats — Section 14) |

Seedance 2.0 caps at 15s per generation; 2.5 goes to 30s. **Stagger shot durations by scene rhythm — never default to even intervals.**

- **Short beats (1–2s):** impacts, eye-locks, slow-mo flashes, hard cuts, realization moments.
- **Medium beats (2.5–3.5s):** standard action, dialogue, reactions.
- **Longer beats (4–5s):** sustained action, ritual casts, transformations, magic, dance.

Pacing principles: opening shots run longer (establishing); impact moments compressed (1–2s); final shots benefit from a held beat. Slow-motion beats stay brief (1s) unless the slow-motion IS the scene.

---

## 12. Common Critical Constraints

Recurring rules — include the relevant one in `critical_constraint:` when applicable:

- **Surface animation:** "All animation stays flat and embedded on the physical surface — painted-on aesthetic, never 3D pop-out."
- **Handheld realism:** "Camera maintains handheld micro-shake throughout. Never stabilizes to tripod smoothness."
- **Stop-motion cadence:** "Stop-motion with intentional frame-to-frame jitter. No smooth interpolation."
- **Material integrity:** "Physical objects maintain real-world reflections, weight, and surface properties even when stylized animation occurs on or within them."
- **No breaking the plane:** "Animated elements within a contained surface never extend beyond its physical boundary."
- **Spatial layout lock (multi-character):** "[A] on the LEFT, [B] on the RIGHT, facing each other throughout. Neither crosses behind the other."
- **Reference pose exclusion:** "References are STRICTLY character design anchors. [Character] NEVER shown in the frontal display pose from the reference."
- **One-er lock:** "One continuous shot. No cuts, no zoom."
- **Identity lock:** "Do not alter facial proportions, eye shape, or hairstyle. Maintain wardrobe consistency."

---

## 13. Image-to-Video vs. Text-to-Video Prompting

| Element | Text-to-Video | Image-to-Video |
|---------|---------------|----------------|
| Subject description | Must be detailed | Already in the image — can be shortened |
| Motion description | Full choreography | Focus on dynamic changes and movement |
| Composition | Describe fully | Add "preserve composition and colors" |
| Camera movement | Flexible | Must align with the image's existing composition |

For image-to-video, front-load with "Animate the provided image" and focus the prompt on what *changes* — not what the image already shows.

---

## 14. Seedance 2.5

Released 2026-07-31. Everything above applies, plus:

### What changes
- **30 seconds native** (any integer 4–30). No seed input — iteration is ref and prompt discipline now. Reference capacity grows toward 30 images / 10 videos / 10 audio (host-dependent; fal early access currently mirrors 2.0's trio).
- **Reference-first creation.** With that many slots, the philosophy inverts: **if a reference can show it, don't describe it.** Text carries only what refs can't — action, camera, pacing, timing. Per-beat binding works: `"@image1 is the beat-2 close-up look."`
- Prompt adherence is better — but 30s drift is the new top failure, so the consistency machinery (Sections 6–7) matters MORE, not less.

### The 30-second grammar: staged beats
3–4 beats, 4–6 shots maximum per 30s. Each beat = **start state → ONE primary change → end state.** Close with a consistency block.

```
Beat 1 (0–6s, hook): [start state] → [the one change] → [end state]
Beat 2 (6–14s, development): …
Beat 3 (14–24s, escalation): …
Beat 4 (24–30s, resolution/callback): …
Maintain consistency: same character features, wardrobe, environment, and light direction across all beats.
```

In this app the beats bar IS this grammar — keep each beat to one primary change and put the consistency line in `critical_constraint`.

### Edit prompts (fix, don't re-roll)
2.5 can edit an existing clip by timestamp and region. Template:

```
Edit @video1. Within 4–6s, replace the red sign with a neon "OPEN" sign.
@video1 is the sole editing master. Keep everything else the same.
```

Output locks to the input's duration (±0.3s) and ratio. When a take is 90% right, edit it instead of re-rolling.

### Extension prompts (the road to minutes)
Chain extensions with a continuity checklist at every splice: pose, props, wardrobe, lighting direction, camera position, motion direction. Re-attach original character stills every 2–3 rounds. Timestamped SFX and audio edits are reliable on 2.5.

---

## 15. Multi-Clip Sequence Discipline

When writing a sequence of clips that tell a continuous story:

1. **Every clip fully re-establishes** character, environment, wardrobe, materials, and scene state as if it is the only prompt the model will ever see. No "same character from Part 1," no "continuation narrative."
2. **Carry visible physical damage forward** (Section 6, Rule 5).
3. **Lock spatial relationships across clips** — stated explicitly in `critical_constraint`.
4. **End each clip on a hook, not a resolution** — pre-strike tension, mid-motion cuts, held frames. Resolution happens inside the next clip, establishing continuity.
5. **Environmental transformations are re-described in full** — if clip 3 summoned a new environment, clip 4 describes it from scratch as the established setting.
6. **Extensions are not exemptions** — "Extend @video1" still gets the full character blocks and locks (Section 7).

---

## 16. Example Prompt — Cyberpunk Body Horror (Unraveling)

```yaml
title: "Unraveling"
reference_handling: "CRITICAL: @image1 and @image2 are used STRICTLY for character design — hardware, clothing, skin integration, cable behavior. DO NOT reproduce the reference compositions. The subject is moving through an underground rave and the scene progresses through multiple distinct framings — tracking, whip-pan, pull-back, push-in. Her pose, framing, and blocking are dictated by the storyboard below, not the references."
style: "Dystopian body-horror. Raw, voyeuristic documentary aesthetic meets cyberpunk brutalism. Desaturated cold tones with aggressive red accent lighting. Film grain, anamorphic flares."
visual_feel: "Handheld with natural micro-shake and soft focus drift. Gritty, grainy, unstable. High-fidelity on red cybernetic hardware — glossy automotive-paint sheen, translucent tubing with visible fluid, chrome vertebrae."
duration: "15 seconds"

character_modeling:
  subject:
    back_view: "Female figure matching reference @image1 — exposed red cybernetic exoskeleton along the full spine. Glossy candy-red armored plates with alphanumeric stamping, clear pneumatic tubing carrying luminous blue coolant, chrome mechanical vertebrae. Skin-to-hardware integration is seamless at the edges. Light blue flowing fabric draped loosely from the hips."
    face_reveal: "Matching reference @image2 — porcelain-white synthetic face, half-split down the center seam. Matte white shell exterior, deep red mechanical internals visible through the cranial divide. Dozens of thin red wires and cables trail from connection points across the jaw, temples, and neck. Dark lips, half-lidded eyes, serene expression."
    red_tendrils: "The cables and wires from inside her skull — thin red insulated wire, braided steel cable, flexible red tubing — behave like living whips when released. They move with predatory intelligence, snapping taut before striking."

cinematic_storyboard:
  00_04_the_follow:
    camera: "Handheld tracking shot from behind, slightly below."
    action: "The subject walks with slow, deliberate confidence through a packed underground rave — concrete bunker ceiling, industrial pipe rigging, thick fog from haze machines. Bodies press in on all sides, dancing aggressively. Strobe lights pulse white and violet. Her red cybernetic spine catches every flash — glossy red plates reflect the chaos. Blue coolant pulses through clear tubing in rhythm. Her hips sway, blue fabric trails behind her."
    lighting: "Strobe pulses through dense haze. White and violet flashes. Anamorphic streak flares from overhead."

  04_07_the_turn:
    camera: "Reactive whip-pan around her right side, then settles on her front profile."
    action: "She stops. Turns her head slowly, then her full body follows. The face is revealed: porcelain-white, bisected by a vertical seam crown to chin. Expression calm, almost bored. She raises one hand to her cheek and pinches a single red wire protruding from a port near her jawline. She pulls it. Slowly. Six inches of red cable slides out with a faint mechanical click-click-click. Her eyes lock directly into the camera lens."
    lighting: "Strobes dim to a low drone. Single cool sidelight on her face."

  07_11_the_unraveling:
    camera: "Slow, controlled pull-back. Low angle, looking up."
    action: "She yanks the wire free. Her head splits open along the center seam — the two porcelain halves hinge apart, exposing the dense red mechanical core. Dozens of red wires and cables eject outward from the cranial cavity like a pressurized release, unspooling rapidly. They whip outward with serpentine precision — lashing through the crowd. Each tendril snaps taut on contact, coiling around limbs and torsos. The red cables from her neck and spine join the cascade, her back exoskeleton flowering open as more tendrils deploy."
    lighting: "Strobes accelerate into seizure-flicker. Red hardware catches every flash."
    vfx: "Cable deployment is the spectacle — keep the camera controlled so the action reads clearly. Tendrils move with predatory intelligence."

  11_15_silence:
    camera: "Slow, steady push-in. Low angle, looking up at her."
    action: "The rave is silent. Haze drifts through still air. Bodies scattered motionless on concrete. She stands at center, spine toward camera — red exoskeleton fully expanded, plates fanned open, cables extended in a radial web filling the space. Her head slowly closes along the seam, porcelain halves clicking shut. The last thin wire retracts into her jaw port. She resumes walking into the fog."
    lighting: "Single overhead red practical light. Volumetric fog. Everything else dark."

production_notes:
  audio_design: "00-04: Crushing bass-heavy techno, muffled crowd. 04-07: Music drops to low drone. 07-11: Metallic unspooling, cable-snap impacts, brief shouts cut short. 11-15: Dead silence. One slow drip of condensation on concrete."
  avoid: "Jitter, bent limbs, temporal flicker, chaotic composition during the unraveling — the cables must read as deliberate, not random."
```

Note what the example demonstrates: reference_handling naming forbidden compositions, one primary camera move per shot, speed asymmetry (fast cable action → controlled camera), per-shot lighting, phased audio design, and a held final beat.
