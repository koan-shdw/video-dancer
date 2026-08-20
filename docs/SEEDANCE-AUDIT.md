# Seedance MD Audit — original v3 files vs the app, plus 2.5-era research

> **HISTORICAL — EXECUTED.** Guides v4 shipped the same day (`fcd678f`): the gap list
> (§2.2) is fixed, the approved hybrid rules (§4) are IN the live canon, the engine enum
> is current. The working truth is `src/main/guides/*.md` + `emitYaml.ts` — audit those,
> not this. Kept as the research record behind v4.

*2026-08-06. Part 1-2 = closeness audit (code-verified). Part 3 = web research (official + community). Part 4 = the proposed hybrid rule set, decided point by point with the director.*

Source files audited:
- Desktop originals: `seedance-prompter-v3-CLAUDE-instructions.md`, `seedance-prompter-v3-master-knowledge.md` (the director's provided canon)
- In-app: `src/main/guides/codirector.md`, `seedance-master-knowledge.md` (v3.1), `seedance-instructions-claude.md`, `seedance-instructions-chatgpt.md`
- Code: `guides.ts`, `codir.ts`, `codirBridge.ts`, `emitYaml.ts`, `shared/models.ts`, `docs/WORKFLOW.md`, `docs/feature-manual-v0.6-addendum-2026-08-01.md`

---

## 1. How close are the app's guides to the originals?

### 1.1 File-by-file verdict

| In-app file | Relation to your originals | Loaded by default? |
|---|---|---|
| `seedance-instructions-claude.md` | **Byte-identical** to your Desktop CLAUDE file (diff-verified) | OFF |
| `seedance-instructions-chatgpt.md` | Faithful condensed variant, same rules | OFF |
| `seedance-master-knowledge.md` | **v3.1 — a streamlined cut** of your master file | **ON** |
| `codirector.md` | New file: adapts the prompter's output format to app tools | **ON, always** |

Every Co-Director exchange (both engines — API loop and bridge) loads `codirector.md` + master v3.1 as the cached system block. The two prompter-instruction files sit unused unless toggled on in Settings. So the working canon = codirector.md + v3.1.

### 1.2 What v3.1 kept (verified line by line)

All of: camera one-primary rule, under-20-words, rhythm-over-specs, speed asymmetry, camera/subject separation, lens-effects placement, action-as-choreography, banned-words table (+ added "cinematic alone"), lighting-as-highest-lever, per-shot lighting, avoid baseline + scene-type table, all six genre patterns, reference discipline rules 1-6 (specific-pose naming, incompatible framings, movement_in_this_scene, damage carry-forward, critical_constraint redundancy), density budgets, redundancy test, timestamp scaling table + stagger + pacing principles, audio design table, all seven common critical constraints, i2v-vs-t2v table, multi-clip discipline (all 5 points). The Unraveling example survives in full.

### 1.3 What v3.1 dropped

The header claims "every rule survives." Almost true. The drops:

| Dropped | Type | Verdict |
|---|---|---|
| **`prompt_start: "Continue from @video1."` + all video-continuation guidance** (v3 §14, instr. #4) | **RULE** | **Real regression.** The app now supports up to 3 video refs bound as `@video1…@video3` — the rule is needed more than in v3, and the default-loaded canon says nothing about prompting them. |
| Supported Camera Types table (10 types: push-in, orbit, crane…) | Vocabulary | Loss. Menus like this steer the Co-Director's camera fields. |
| Position/Angle vocabulary (14 entries) | Vocabulary | Partial loss — 7 survive inside the incompatible-framings list. |
| High-Impact Lighting Keywords table (golden hour, rim light, volumetric, practical…) | Vocabulary | Loss, and lighting is the guide's own "highest-leverage element." |
| 2 of 3 worked examples (Koi Grillz surface-animation macro, Matcha stop-motion) | Examples | Loss of genre coverage — only cyberpunk survives. |
| Three concrete 15s staggered-pacing patterns | Examples | Minor. |
| "Close-up on a specific detail" framing bullet; i2v alt opener phrase | Micro | Trivial. |

Correctly dropped (the app enforces these mechanically): field order, timestamp `XX_YY_name` format, `@image1` tag spacing/numbering (the app uses `@titles`), YAML assembly.

### 1.4 Is the app still working according to your files? — the emitter check

`emitYaml.ts` emits exactly your v3 skeleton: title → reference_handling (second, always) → style → visual_feel → duration → character_modeling with all seven sub-fields in your order → `XX_YY_shotname` storyboard with camera/action/lighting + dialogue/vfx/reaction/sfx → production_notes in your order (audio_design, lighting, subtext, critical_constraint, avoid, animation_style). **Conforms.**

The lint (`lintFields`) enforces: camera ≤20 words, beats sum = duration, avoid-field baseline nag, attached-but-unreferenced refs, and filler words. **Conforms — but only checks 5 of the guide's banned words** (epic, amazing, beautiful, stunning, cool). Missing: unqualified "fast", "cinematic" alone, "lots of movement", "dynamic".

`prompt_start:` is not an emitted field. Video continuation is done by @mentioning `@video1` in the freeform prompt, which sits on top of the YAML — positionally equivalent to v3's rule (before `title:`). Fine mechanically; undocumented in the canon.

---

## 2. Co-Director instruction audit (codirector.md + tooling)

### 2.1 What's right

- Output ritual preserved from your v3: scene breakdown + exactly four creative suggestions after filling a clip.
- Ask-duration-first rule preserved. Direct-writes, one-question rule, precision edits, reuse-before-writing (styles/links/char sheets) all coherent with the app's design.
- reference_handling discipline preserved and adapted (@titles, annotated-refs rule, never i2v with annotated refs — i2v reproduces marks literally).
- Guide-editing machinery is sound: `update_guide` surgical edits fork a personal copy; `remember_instruction` appends learned rules; revert deletes the fork. Bridge engine shares all of it.

### 2.2 Gaps found (code-verified)

| # | Gap | Evidence |
|---|---|---|
| G1 | **Engine briefing is stale.** codirector.md briefs only `seedance2` + `omniflash`. The app now ships `seedance25` (4K, t2v, every integer 4-15s, NO seed), `seedance2ark` (official ByteDance: no video refs, **no real-human-face refs policy**, 10-bit 4K), and `sora2` (i2v only, no refs, audio always-on, 4-20s). The Co-Director knows none of it. | codirector.md "Engine differences" vs `shared/models.ts` |
| G2 | **`set_clip_fields.engine` enum is stale**: `['seedance2', 'sora2', 'omniflash']`. The Co-Director cannot switch a clip to Seedance 2.5 or ModelArk at all. | `codir.ts` sceneProps block |
| G3 | **No video/audio-ref prompting rules anywhere in the loaded canon.** App supports 3 video refs + 3 audio refs (`@video1…`, `@audio1…`, 15s combined caps, ≤12 ref files). v3.1 dropped the only video-ref rule; audio refs never had one. | addendum §B vs master v3.1 |
| G4 | Ref limits unstated: 9 images max (Seedance), 12 files total, videos 2-15s. Your v3 file still says "@image1…@image4" (four). | `models.ts` maxRef* |
| G5 | Duration "auto" exists on Seedance engines; the canon never mentions it (and the ask-duration rule doesn't offer it). | `models.ts` durations |
| G6 | Timestamp table still carries 20s/30s rows — above every Seedance engine's 15s single-clip cap. Harmless but misleading inside this app. | master §10 vs `models.ts` |
| G7 | Sora 2 is selectable (enum) but emits Seedance-style YAML (`promptStyle` defaults to yaml) with zero guidance — the guides are Seedance-specific. | `models.ts` sora2 has no promptStyle |

---

## 3. Research — Seedance 2.0/2.5 prompting, official + community

*Three independent research passes, 2026-08-06: (A) official 2.0 canon verification, (B) Seedance 2.5 deltas, (C) community/forum prompt collections. Scope per the director: Seedance 2 + 2.5 only.*

### 3.1 Verdicts on the v3 canon (claim by claim)

| v3 claim | Verdict | Notes |
|---|---|---|
| Structured prompts + timestamped storyboard | **CONFIRMED** | Officially endorsed ("0-3s: … 3-6s: …"). The specific YAML field set is our house invention — undocumented anywhere, but structure demonstrably beats flat prose. Community's #1 technique ("timeline prompting", ~10 sources). |
| @image tags for refs | **CONFIRMED** | fal docs verbatim: `@Image1`, `@Video1`, `@Audio1` (capitalized in docs). Replicate variant uses `[Image1]`. |
| `prompt_start: "Continue from @video1."` | **PARTIAL** | "Continue from @Video1" works (community-documented). Official verb is **"Extend @Video1 by 5s"** (+ backward extension, + insert-between-clips). `prompt_start:` as a field is our invention. Gotcha: duration = NEW seconds, not total. |
| One primary camera move per shot | **CONFIRMED** | Official anti-example matches ours. Secondary allowed if subtle. |
| Camera field under 20 words | **UNSOURCED** | Appears nowhere. Our house rule. Harmless. |
| Rhythm words over tech specs | **CONFIRMED, nuanced** | True for MOTION. But technical LOOK tokens (35mm film, ARRI ALEXA aesthetic, Kodak stock names) are widely used successfully for grade/style. Rule: no specs for movement; film vocabulary fine for look. |
| Speed asymmetry | **CONFIRMED** | "Fast camera + fast cuts + busy scene almost guarantees jitter." |
| Lighting = highest lever | **CONFIRMED** (consistent folklore) | "If you can only add ONE element, add a lighting description." |
| avoid: line | **CONFIRMED** | In-prompt only — no negative_prompt API field exists. End-of-prompt placement is the documented pattern. |
| Vague-word ban | **CONFIRMED** | Official + fal agree, same word list. |
| 4,000-char limit | **REFUTED on the number** | Model-side ~5,000 chars; platform caps vary (Runway ~3.5k, Venice 10k, fal undocumented). 60-100 words applies to simple flat prompts only; structured multi-shot prompts legitimately run 150-600+ words. |
| Anti-drift language parses better at the top | **UNSOURCED** | Our production-hardened house rule. Official/community fight drift with identity anchors + reference hygiene instead, position-agnostic. Kept as house rule, layered with theirs. |
| Zero memory between generations | **CONFIRMED** | Continuity = re-feed refs, re-describe, chain last-frame→first-frame. Degradation curve: clips 1-3 fine, re-anchor aggressively past 6. |
| Pose-exclusion lists ("DO NOT show X pose") | **UNSOURCED** | Nobody else does this. Ours worked in production. Kept, layered under identity anchors. |

### 3.2 Seedance 2.0 rules we were missing (official + strong community consensus)

1. **Role-bind every reference.** Unlabeled refs get AVERAGED into hybrid faces/scenes. Every @ref needs a stated job + exclusions: "@Image1 is the character's face and outfit. Do not use its background." Vague @mentions are the #1 reported failure. (Official manual + ~8 community sources.)
2. **Reference-pack discipline.** Fewer refs = less drift (cutting 6→2 refs reduced drift ~60% in one test). Per character: ≤3 stills (front, three-quarter, profile) + optional 2-3s neutral-motion clip. Never collages. Matched lighting across refs. First-listed ref carries most weight.
3. **Audio is under-directed.** Name diegetic sounds explicitly; write "no music" when silence matters (and expect it to be ignored sometimes — mute in post); state a mix hierarchy ("dialogue clean and prominent, music low, ambient subtle"); audio texture words (muffled, echoing, crunchy) work. Audio refs: MP3 safest (WAV/AAC reported failing silently on some hosts).
4. **Dialogue rules.** Double quotes = lip-synced speech (fal official). 5-10 words per line; long monologues drift out of sync — split across cuts. Language + delivery tags work ("speaks in Japanese, dry and a little proud"). Best lip-sync: front-facing medium close-up, stable camera.
5. **On-screen text is controllable.** Quoted text + when + where in frame + how it appears + style ("the words 'SLOW MORNINGS' fade up in the lower third in a thin serif"). 3-5 word supers perform best.
6. **"Cut to" is the reliable shot delimiter** in prose blocks; for continuous shots, negative camera direction is required ("one continuous shot, no cuts, no zoom").
7. **Identity-lock phrasing**: "Do not alter facial proportions, eye shape, or hairstyle. Maintain wardrobe consistency."
8. **Start small**: probe at 4-5s cheap resolution before the long spend; change one variable at a time.
9. **Stability vocab doubles as jitter control**: "gimbal-smooth", "stabilized", "tripod-stable".
10. **Policy**: official ByteDance platforms (ModelArk) refuse realistic identifiable human faces in refs.

### 3.3 Seedance 2.5 — what's new (launched 2026-07-31; fal rollout pending)

| Change | Prompting consequence |
|---|---|
| **30s native** (any integer 4-30; API launch = 480p/720p 24fps; consumer apps market 4K) | New grammar: 3-4 timed BEATS, each = start state → ONE primary change → end state, plus a "maintain consistency" block. Max 4-6 shots per 30s. Drift over 30s is the top failure. |
| **50 reference slots** (30 img / 10 vid / 10 audio; up from 9/3/3=12) | "Reference-first creation" replaces prompt-maximalism: if a ref can show it, don't describe it. Text carries only what refs can't: action, camera, pacing. Per-beat ref binding works ("@Image1 close-up in beat 2"). |
| **Timestamp + region editing** of existing clips | New prompt genre: "Edit @Video1. Within 4-6s, replace X with Y. @Video1 is the sole editing master. Keep everything else the same." Output locks to input duration ±0.3s. Fix, don't re-roll. |
| **Extension to minutes** (multi-round) | Extension prompts with continuity checklists at splice points (pose, props, lighting, camera, motion direction). |
| **Audio upgrades** | Timestamped SFX placement ("SFX: thunder crack at 3s"), audio editing in existing clips. Bracket conventions documented on ByteDance platforms: `( )` music, `<>` SFX, `{ }` dialogue, `【 】` on-screen text. |
| **No seed input** | Iteration = prompt/ref discipline, not seed pinning. |
| 3D blockout refs, ≤10 keyframes (Multiframes) | Platform-side (Jimeng/Dreamina) for now; watch for API exposure. |

### 3.4 Community failure→fix table (cross-source)

| Failure | Fix |
|---|---|
| Identity drift across shots | Ref + repeated description per shot + ONE environment per generation |
| Two refs blend into hybrid face | One explicit role per ref, exclusion clauses |
| Chaotic random cutting | Declare shot count up front; or "single tracking shot"; POV needs literal "no cuts, no zoom" |
| Camera jitter | "gimbal-smooth" / "stabilized"; speed asymmetry |
| Flat or blurry output | Fix the lighting line first |
| Lip-sync drift | Short quoted lines, front-facing MCU, locked camera |
| Muddy audio | Max 2-3 layers + mix hierarchy |
| "No music" ignored | Expect it; mute/replace in post |
| Unwanted subtitles | "Generate video without subtitles" |
| 30s narrative collapse (2.5) | Timecoded beats, ≤4-6 shots, consistency block |

*Key sources: fal official docs + learn guide, BytePlus ModelArk guide (via paralleldistribution translation), apiyi interpretation, Dreamina 2.5 guide, atlascloud 2.5 templates, Higgsfield/OpenArt/magichour/WaveSpeed/CrePal guides, ZeroLu + makesupday + Anil-matcha GitHub prompt compilations, levelsio + EHuanglu X threads.*

---

## 4. Hybrid rules (v4) — decision list

**APPROVED IN FULL by the director, all 24 points, 2026-08-06.**

**KEEP (confirmed):** YAML skeleton + field order as house style · one primary camera move · rhythm words for motion · speed asymmetry · per-shot lighting · avoid: line · vague-word ban · zero-memory full re-establishment + damage carry-forward · staggered beats · choreography-not-summary · reference_handling early + pose-exclusion (house rules, layered).

**FIX:** char budget (4k target, ~5k real ceiling, structured prompts may run long) · ref counts (9+3+3=12 on 2.0; ~30/10/10=50 on 2.5) · continuation verb ("Extend @Video1 by Ns" official; duration = new seconds; backward + insert-between exist) · tech-LOOK tokens allowed in style (film stocks, camera names) while specs stay banned for motion.

**NEW (2.0-era):** role-bind every ref + exclusions · reference-pack discipline (≤3 stills/character, no collages, matched lighting, first = strongest) · audio brief every prompt (diegetic list, explicit no-music, mix hierarchy) · dialogue rules (quotes, 5-10 words/line, language+delivery, MCU+stable camera) · on-screen text rules · "cut to" delimiter + "one continuous shot, no cuts, no zoom" · identity-lock phrasing · start-small probe workflow · Ark no-faces policy note · MP3-only audio refs.

**NEW (2.5-only):** 30s staged-beat grammar + consistency block (≤6 shots/30s) · reference-first creation (show, don't describe) · edit-prompt template · extension-prompt continuity checklist · no-seed note (iterate via refs/prompt) · timestamped SFX.

**RESTORE (dropped in v3.1):** video/audio-ref prompting section (modernized to app @titles + slots) · camera-type + framing + lighting keyword menus (compact).

**APP FIXES (code):** add `seedance25` to the Co-Director's `set_clip_fields` engine enum in codir.ts (+ `seedance2ark`) · update codirector.md engine briefing (2.5: no seed, t2v, video+audio refs; Ark: no real faces, no video refs) · extend the lint word list · note "auto" duration in the canon.

### Next step

Rewrite the in-app guides to v4 with everything above: `seedance-master-knowledge.md` (the loaded canon) + engine briefing in `codirector.md`, keeping the two prompter-instruction files in sync. Then the code fixes. Each lands only on the director's GO.
