# Seedance 2.0 Prompter — Master Knowledge Base v3.1

Reference library for Seedance 2.0 cinematic prompting: field-by-field guidance, model-specific rules derived from the official ByteDance prompt guide, reference-image discipline (hard-won in production), genre patterns, and a full example. v3.1 is the streamlined cut of v3 — structure the app already enforces (field order, timestamps, reference tag formatting) and duplicated material were removed; every rule survives.

---

## 1. Field Guidance

- `style:` — The single most important stylistic field. Genre, named cinematic references, art movements, production styles. Resolution targets (4K, 2K) belong here as style anchors, not as technical specs. 15–30 words, tight — specific references, not stacked adjectives.
- `visual_feel:` — Visual rhythm and texture in sensory language: "slow," "smooth," "warm," "gritty," "stable," "dreamy," "handheld," "gentle." No camera specs (f-stops, ISO, focal lengths) — the model responds to rhythmic feel, not photography jargon. Rendering intentions (subsurface scattering, volumetric fog, film grain) are fine: they describe visible texture.
- `reference_handling:` — Governs how reference images are used. See Section 6 — the most important section in this document.
- **Characters** — every entity that appears on screen (characters, objects, hands, creatures, props with agency) gets:
  - `base:` — what it is and which reference image it matches, if any.
  - `features:` — specific enough to render: colors by name, materials by texture, wardrobe by item.
  - `physics:` — how it moves, deforms, or emotes; material behavior (jiggles, flexes, glows); personality expressed through physicality, not adjectives.
  - `movement_in_this_scene:` (when relevant) — this clip's movement restrictions, placed INSIDE the character block where the model parses them together with the character. Far more effective than burying the rule in `avoid`. See Section 6, Rule 4.
  - `emotional_state:` (when relevant) — the tone and demeanor carried throughout, for character-heavy dramatic scenes.
  - `state_in_this_scene:` (when relevant) — the character's starting state this clip: wounds, missing parts, posture. See Section 6, Rule 5.
  - `power_this_scene:` (when relevant) — the mechanical behavior of an ability that activates in this clip, so the model can render it.
- **Shots (beats)** — per shot: `camera:` (one primary move), `action:` (choreography), `lighting:` (always — even 3–5 words), plus optional `dialogue:`, `vfx:`, `reaction:`, `sfx:`.
- **Production notes** — `audio_design:` (sound philosophy — never left to default), `lighting:` (overall strategy; per-shot notes override for their beat), `subtext:` (what the scene is really about — emotional thesis, comedic logic, lore grounding), `critical_constraint:` (hard creative rules, spatial locks, repeated reference rules), `avoid:` (stability — see Section 5), `animation_style:` (frame cadence, interpolation, stop-motion holds).

---

## 2. Camera Discipline

### The One-Primary Rule
Every `camera:` field gets **one primary movement instruction**, optionally one secondary sequenced with "then." Never three or more.

**DO:** `"Slow push-in, low angle."` · `"Handheld tracking shot, then gentle rise."` · `"Static wide shot. Hold."`

**DON'T:** `"Handheld over-the-shoulder tracking shot from behind and slightly below, pushing through the crowd with anamorphic streak flares and focus hunting."` — four competing instructions; the model jitters trying to satisfy all of them.

### Rhythm Over Specs
Describe camera with rhythm words (slow, smooth, gentle, controlled, stable, imperceptible), never technical parameters (24fps, f/2.8, ISO 800, 85mm, rack focus at 0.3m). Technical specs may appear in `style:` as aesthetic anchors ("35mm film tone") but must not drive camera behavior.

### Speed Asymmetry Rule
**Never combine fast camera + fast subject action + complex scene — the #1 cause of artifacts and jitter.** If the action is fast, the camera is slow/stable. If the camera is dynamic, the action is controlled. Complex scenes (crowds, particles, many elements): both slow. Only one speed axis may be "fast" at a time.

### Separate Camera from Subject
Camera movement and subject movement are described independently, never blended.

**DO:** `camera: "Fixed wide shot. Hold."` + `action: "The dancer spins slowly across the frame."`
**DON'T:** `camera: "Spinning camera around a dancing person."`

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

The official Seedance guide identifies lighting as the **highest-leverage single element** in any prompt — one lighting line does more for output quality than ten adjectives.

Every shot gets a `lighting:` field, even brief:
- `"Warm golden-hour backlight through window."`
- `"Single red overhead wash, everything else dark."`
- `"Neon blue rim light against deep shadow."`

The global philosophy still lives in `production_notes` → `lighting:`; per-shot notes override for their specific beat.

---

## 5. Stability Constraints (Negative Prompts)

Every prompt includes an `avoid:` field. Standard baseline:

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
| Scenes with reference images | "Character frozen in reference-image pose" (see Section 6) |

---

## 6. Reference Image Discipline

**The most important section in this document for multi-clip production work. The failures that happen early in any project are almost always failures of reference discipline. Apply these rules from the first prompt and cold-start drift disappears.**

### The Core Problem
The model reads reference images first, processes their compositions, poses, and framings, and uses them as a prior for how the scene should look. If the anti-reference language is buried at the bottom in `avoid:` or `critical_constraint:`, the model sees the image composition before the instruction not to reproduce it — and the scene drifts back toward the reference pose.

### Rule 1: Fill `reference_handling` whenever references are attached
It is parsed early (the app places it second, right after the title), so the model reads the reference rules before the characters and storyboard. Never leave it empty on a prompt with references.

### Rule 2: Name the specific reference composition to avoid
A general disclaimer does not work. Open the reference image, identify the pose/framing/composition that would cause drift, and name it directly.

**Weak (ineffective):** `"The reference image is for character design only, not scene composition."`

**Strong (effective):** `"CRITICAL: the references are used STRICTLY for character design, color palette, and styling. DO NOT reproduce either image's pose, framing, or composition. DO NOT show Kali frontally with four arms fanned outward in deity display pose. DO NOT show Raktabija running forward with cleaver raised overhead at the camera."`

The specificity is what makes it work: name the pose, the framing, the body position, the angle relationship to the camera.

### Rule 3: Describe framings that are spatially incompatible with the references
The most powerful anti-drift technique: choose shot compositions the reference image physically cannot fit into.

- Extreme macro close-up on a specific body part (hands, eyes, wound, weapon edge)
- Overhead top-down looking straight down
- 90-degree horizontal side profile at ground level
- Over-the-shoulder from directly behind
- Inverted / upside-down close-up
- First-person POV from another character's eyes
- Extreme low-angle worm's-eye looking up past feet

Rotate through these across a clip's shots — no repeated framing twice within the same clip. Varied angles create kinetic rhythm and prevent any single frame from slipping into the reference pose.

### Rule 4: Use `movement_in_this_scene` inside the character block
When a character's movement in this clip is restricted or shaped, put the rule inside the character block:

```yaml
movement_in_this_scene: "Raktabija is NEVER shown running forward with cleaver overhead in this scene. He fights in close quarters — grappling, slamming, swinging at close range. His mouth is NOT constantly gaping wide — he snarls, bites, roars, closes."
```

The model parses movement rules alongside the character description — much more effective than the same restriction in the `avoid:` list.

### Rule 5: Carry visible physical damage forward between clips
In multi-clip sequences, damage sustained in a previous clip is described explicitly in this clip's `features:` or `state_in_this_scene:` ("ONE curved horn — the other was ripped off during the previous round, leaving a bloody bone stump"). This prevents narrative reset (the model has no memory across generations) and gives the model a sharper, more unique design to lock onto — a damaged character drifts less toward the clean reference. By clip five of an escalating story, the characters should look visibly battered.

### Rule 6: Repeat key reference rules in `critical_constraint`
Even with `reference_handling` at the top, restate the most important anti-drift rules in `critical_constraint:` at the bottom. The model reads the rule at parse-time and again at generation-time. Redundancy is not noise here — it is reinforcement.

---

## 7. Genre Adaptation Patterns

The template skeleton stays the same. The vocabulary, density, and emphasis shift by genre.

### Cute / Kawaii / Stop-Motion
- `style:` references Laika, Aardman, Pixar short films. Names material textures (clay, felt, dough).
- Character modeling emphasizes tactile material physics (jiggles, squishes, bounces).
- Action lines lean into exaggerated expressions and held comedic beats.
- Production notes specify animation cadence ("stop-motion holds and pops, no smooth tweening").
- SFX are diegetic and ASMR-forward.
- Camera mostly fixed or slow. Let the characters carry the energy.

### Cyberpunk / Horror / Action
- `style:` references specific films or directors, volumetric atmospheric effects.
- Character modeling emphasizes material science (automotive paint sheen, translucent tubing, chrome vertebrae).
- Action lines rapid and precisely sequenced — but apply the speed asymmetry rule.
- Camera work can be aggressive but still follows the one-primary rule.
- Audio design often uses silence as a weapon — contrast between chaos and dead quiet.

### Comedy / Dramedy / Dialogue-Driven
- `style:` references specific shows or directors for comedic timing.
- Character modeling includes personality and wardrobe as comedy signals.
- Storyboard paced around dialogue beats, not visual spectacle.
- Camera uses snap-zooms and held reaction shots for comedic timing.
- `subtext:` explains the joke's underlying logic.

### Anime / Moe / Japanese Healing
- `style:` references specific anime aesthetics (4K Moe, healing genre, ukiyo-e).
- Character modeling includes anime-specific features (ahoge, chibi proportions, star-highlights in eyes).
- VFX stays stylized — painted-on effects, 2D surface animation, watercolor dissolves.
- Lighting warm, golden-hour, soft-focus bokeh. Per-shot lighting notes matter here.
- Audio tends toward quiet ambient and ASMR.

### Game / HUD / Interactive Style
- `style:` specifies game genre and perspective (TPS, FPS, ADS transitions).
- HUD element placement and state-machine animation logic go in the freeform prompt (no dedicated fields).
- Camera describes perspective transitions as single primary instructions per beat.

### Brutal Deity Combat / Mythological Violence
- `style:` references specific anime combat lineages (Samurai Champloo, Ninja Scroll, Madhouse-era violence).
- `subtext:` grounds attacks and dialogue in specific lore sources — actual canonical powers land harder than invented ones.
- Physical damage visible and carried forward between clips (Section 6, Rule 5).
- Both combatants always in motion — no static tableau moments mid-fight.
- Spatial layout (who is on which side, facing which direction) locked throughout and stated in `critical_constraint`.
- Audio layers each combatant's distinct vocal signature — breathing, growls, feral laughs, pain sounds — plus wet organic impacts on every strike.

---

## 8. Prompt Density

The official guide recommends 60–100 words for flat-text prompts; our structure is intentionally denser for director-level control — but density has diminishing returns and can introduce conflicts.

- `camera:` under 20 words. One primary, optionally one secondary.
- `action:` 30–80 words per shot — choreographic specificity is the competitive advantage, but every sentence must describe visible movement.
- `style:` 15–30 words. `visual_feel:` 15–25. `lighting:` per shot 5–15.
- `reference_handling:` 30–80 words — specificity is the entire point.
- Overall prompt: target under 4,000 characters.

**The Redundancy Test:** before finalizing, ask of every sentence — "can the model render this in a video frame?" If not, cut it. **Exception:** `subtext:` and `reference_handling:` may contain non-renderable directorial guidance.

---

## 9. Example Prompt — Cyberpunk Body Horror (Unraveling)

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

---

## 10. Timestamp Scaling and Pacing

| Duration | Recommended Shots | Avg Seconds Per Shot |
|----------|-------------------|----------------------|
| 5s       | 2–3               | 1.5–2.5s            |
| 10s      | 3–4               | 2.5–3.5s            |
| 15s      | 4–7               | 2–4s (staggered)    |
| 20s      | 5–7               | 2.5–4s              |
| 30s      | 7–10              | 3–4.5s              |

**Stagger shot durations by scene rhythm — never default to even intervals.** Even-interval pacing flattens scenes and removes kinetic shape.

- **Short beats (1–2s):** impacts, eye-locks, slow-mo flashes, hard cuts, realization moments.
- **Medium beats (2.5–3.5s):** standard action, dialogue, reactions.
- **Longer beats (4–5s):** sustained action, ritual casts, transformations, magic, dance.

Pacing principles: opening shots can run longer (establishing); impact/transformation moments compressed (1–2s) for energy; final shots benefit from a held beat — let the image breathe. Dialogue scenes use longer shots; action scenes shorter cuts. Slow-motion beats stay brief (1s) unless the slow-motion IS the scene.

---

## 11. Audio Design Patterns

Audio is always specified, never left to default. Use specific sensory keywords — "muffled," "echoing," "crunchy," "reverb," "sharp" — not generic descriptors.

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

## 12. Common Critical Constraints

Recurring rules — include the relevant one in `critical_constraint:` when applicable:

- **Surface animation:** "All animation stays flat and embedded on the physical surface — painted-on aesthetic, never 3D pop-out."
- **Handheld realism:** "Camera maintains handheld micro-shake throughout. Never stabilizes to tripod smoothness."
- **Stop-motion cadence:** "Stop-motion with intentional frame-to-frame jitter. No smooth interpolation. Characters move in holds and pops."
- **Material integrity:** "Physical objects maintain real-world reflections, weight, and surface properties even when stylized animation occurs on or within them."
- **No breaking the plane:** "Animated elements within a contained surface (teeth, screen, painting) never extend beyond the physical boundary of that surface."
- **Spatial layout lock (multi-character):** "[Character A] on the LEFT, [Character B] on the RIGHT, facing each other across the [aisle/space] throughout. Neither character crosses behind the other at any point."
- **Reference pose exclusion:** "Reference images are STRICTLY character design anchors. [Character] NEVER shown in the frontal display pose from the reference."

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

## 14. Multi-Clip Sequence Discipline

When writing a sequence of clips that tell a continuous story:

1. **Every clip fully re-establishes** character, environment, wardrobe, materials, and scene state as if it is the only prompt the model will ever see. No "same character from Part 1," no "continuation narrative."
2. **Carry visible physical damage forward** (Section 6, Rule 5).
3. **Lock spatial relationships across clips** — if two characters face each other across an aisle in clip 3, they do in clip 4, stated explicitly in `critical_constraint`.
4. **End each clip on a hook, not a resolution** — pre-strike tension, mid-motion cuts, held frames on a reaction. Resolution happens inside the next clip, establishing continuity.
5. **Environmental transformations are re-described in full** — if clip 3 summoned a new environment, clip 4 describes it from scratch as the established setting.
