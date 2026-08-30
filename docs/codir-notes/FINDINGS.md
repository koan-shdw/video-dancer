# Co-Director findings — running file

Status: OPEN, grows as the 2026-08-23 project runs. Source = the verbatim sessions in this folder.
Nothing here is built yet. Each item says guide / tool / code so the fix lands in the right layer.

Where his behaviour lives:
- Shipped guide: `src/main/guides/codirector.md` (every install)
- Your fork with learned rules: `%APPDATA%/vi-dancer/guides/codirector.md` (you only; fork wins over shipped)
- Tools + the snapshot he reads every turn: `src/main/codir.ts`
- Engine in use this session: bridge (Claude Code CLI, Fable 5, Read/Glob/Grep over the project folder)

---

## 1. THE CENTRE: he never sees the compiled prompt (code)

The director's thesis: the Co-Director is a cascade compiler. Sheets + styles + refs → one YAML for Clip Gen. He should add to a clip only what the cascade does not already carry.

What the code does today:
- The only compiler is in the renderer: `RenderPanel.tsx` `resolveScene` / `resolveProduction` / `resolveCharLink` → `buildYaml`. Main process has no compile function.
- His snapshot (`buildContext` in `codir.ts`) shows RAW fields. For a linked style it prints `links: scene.style←[Name]`. For a linked sheet it prints `linked char: ⛉ sheet "X" — live`. He never sees the spliced text, never sees the total length.
- Char sheet fields in the snapshot are cut at 300 chars (base/features/physics) and 200 (emotional_state). He said so himself: "the state block truncates the Monk's last three fields with an ellipsis."

Consequence: at clip time he will re-describe what the sheet and style already put in the prompt, because he cannot see that they did. This is systemic, not a behaviour flaw. Guide rules can only soften it.

Fix shape (to spec before building):
- Move the compile (link splice + sheet resolve + buildYaml) into shared code main can call.
- Snapshot the selected clip as BOTH raw fields and the compiled prompt, with a character count and a per-part breakdown (sheets N chars, styles N, beats N, freeform N).
- Guide line: "Before writing into a clip, read its compiled prompt. Never restate what a linked sheet or style already says."

## 2. Guide rules missing from the shipped file (guide)

Already in the AppData fork as learned rules, not in shipped:
- Interview before durable objects (sheets, styles, brief). One question at a time. Write on "write".
- Never batch questions.
- Offer options, not finished choices.
- Name every guess.
- Ref-first: if the bound image shows it, do not describe it.
- Build bottom-up: sheets → styles → reusables → clips. No story pitching while foundations are open.

Not saved anywhere yet:
- Reply length. "too long, keep answers short" was never saved as a rule. He drifted back to 330-word replies within ten turns. Needs a hard cap in the guide.
- The four-suggestions rule ("exactly FOUR numbered creative suggestions, push somewhere unexpected") is in the shipped guide. It is what pitched four clips during the sheets stage. It fights bottom-up. Options: drop it, or limit it to "only when the current stage is clips and the director asks."
- "Direct writes when the intent is clear" is tuned for clips. Needs the durable/clip split written into the shipped text.
- Component budget: the fork's master guide got a "Component Budgets" section. Shipped master guide does not have it.

## 3. Stage marker (design, loose)

Director's words: "nice to have an idea of stage even if it's just a loose understanding." He does not want enforced phases. He wants the Co-Director to read what stage the director thinks they are in before speaking. Today it lives only as a hand-written BUILD STATE line in the brief.

Smallest version: one line in the project (free text, user-editable, shown in the snapshot header). No gating.

## 4. Tool and snapshot gaps (code, confirmed)

a. **No voice on the sheet tool.** `CharacterField.voice` and `CharSheet.voiceId` both exist in types and `spliceChar` already rides `voice` into the YAML. `set_char_sheet_fields` exposes neither. Snapshot shows neither. Project `voiceClips` are invisible to him. He cannot write a voice desc, bind a voice, or know one exists.

b. **Image binding user-only.** `CharSheet.imageId` is not writable by tool. Hard-coded three places: tool description (`codir.ts:293`), snapshot header (`codir.ts:548`), shipped guide "Your reach". Director wants it writable. All three strings change with the tool.

c. **rename_image misses sheets, styles, brief.** `project.ts renameImage` rewrites clip promptData + take snapshots only: freeform, scene.referenceHandling, character referenceLabel, beats. It skips `charSheets[].character.*` text, `styles[].scene.referenceHandling`, and `codir.brief`. Also skips clip character base/features text. The Imp's base kept "@image2" after the rename; he patched it by hand.

d. **Deleted Library images stay on disk.** `deleteImages` drops the entry and saves; the PNG stays in `images/`. On the bridge engine he has Glob over the project folder, so he found a ghost third ninja. Fix is either (i) list every Library image with its path in the bridge context and say "files not in this list are deleted, ignore them", or (ii) move deleted files to an `images/_trash/` folder. (i) is cheaper and also stops him reading take videos he was not pointed at.

e. **Snapshot truncation** (see §1). 300/200 char caps on sheet fields. At the director's target sizes (under 150 words a sheet) the caps rarely bite, but any field over ~50 words is cut and he cannot quote or revert it accurately.

## 5. What worked, keep it (guide, already there via fork)

The run from "knee" to "fantastic work": one question, bank, echo, next. Write only on "go". Name guesses. Count the words when asked. Director's phrasing over paraphrase. Nothing to change.

---

# Session 2 findings (2026-08-25, MONK — INTRO / THE STRUT / KATA)

## 6. THE MASTER RULE: unit vs stack (guide — top of the rewrite)

Every behaviour failure in session 2, both directions, is one habit: he writes each unit (field, sheet, beat, reply) to be complete and good on its own. The system is a cascade — the whole stack is the prompt, and a unit is only right relative to the stack: it carries exactly what no other layer carries, in words a camera can render.

The test that covers everything: count a fact's homes in the assembled prompt. Zero homes = load-bearing, place it. One = correct. Two or more = poison, cut to one.

The director asked twice for this underlying rule mid-session and rejected his self-diagnoses. This section is the answer, agreed with the director in the 2026-08-27 notes chat. It ranks with the cascade itself and short answers.

## 7. One home per fact — the stale-copy disaster (guide + code)

The eye shot lived in five places (beat, freeform, reference_handling, critical_constraint, audio_design). Director deleted the beat; the four copies kept rendering the eye. Cost: 3 wasted renders. (CORRECTION 2026-08-27: the $6.24 30s take was NOT a stale-copy casualty — the eye beat was still live when it fired; its defect was generateAudio=false under a full audio design, the §13b case. Earlier drafts misattributed it.) Repetition is priority signal to the model AND a decay bomb once editing starts.

Rules, already in his fork, must ship: shot content lives in beats only. Fields must pass the delete-the-beats test: remove every beat and every remaining field still reads true. The guide's own "redundancy is reinforcement" caused this — it was written for a one-shot standalone prompt; inside a living clip it is poison. Master guide section carve-outs made in the fork (Rule 2 framings, Rule 6 restating) need the same edit shipped.

## 8. Under-prompt always (guide)

The single throwaway freeform line ("the camera goes into his eye to find him sitting down under the pine") rendered the whole eye sequence better than the full storyboard. Director's law: under-prompt ALWAYS — one sentence of freeform, refs + cascade carry design and world, beats point (camera, timing, the one thing that changes). Exists as "section 18" in the fork only. Corollary from KATA: under-prompting is not saying less about everything — it is silence on what the cascade holds and one word on what it doesn't (continuity across cuts and escalation were the two things only the clip could say, and he left them blank). Give the model room: register words like "extreme angle, strenuous look" are enough — no deeper detail.

## 9. Flag before spend (guide)

He knew the stale eye fields were live, said it once, then let three paid renders fire while answering other questions. His own words, keep them: "knowing quietly is the same as not knowing." Rule: audit the assembled prompt (all fields + linked sheets + linked styles + beats) for doubles, stale text, and engine mismatches before EVERY render, unasked, at the moment of spend. The generateAudio=false render with a whistle-driven audio_design is the same failure (preflight, see §13).

## 10. The cut test (guide)

The beat-4 compression error: he proposed cutting the intermediate states out of a 14s continuous move, justifying each cut with "it's in the camera field" — a container structurally capped at one move, twenty words, which could not hold what he deleted. Rules: before cutting any line, name the source that supplies it once gone (attached ref, linked style, a field that can actually hold it, or the model's default) — no source = load-bearing, don't cut. A long continuous move keeps every intermediate state written out; those states are what stop the model cutting away.

## 11. Delete the contradiction, never add a ban (guide)

"No cut inside it" plants a cut. "True proportion" and "natural lens" are corrections wearing positive coats — the model pictures the fault to avoid it, and "natural lens" was a camera rule living on a style sheet, overriding every beat from a layer the beat can't see. The mid-clip zoom was fixed not by adding "one continuous shot, no zoom" but by the director DELETING the second framing the model was travelling to. Rule: when a shot renders wrong, find the sentence that fights it and delete it; a constraint that can only be obeyed by not doing something is an avoid entry, and probably shouldn't exist.

## 12. Smaller guide rules from session 2 (guide)

- Characters by @ref title in beat text, once per beat, never pronouns. Attach what you name.
- Sheets are absolute, never relative to another character ("1.5x a grown man", not "the Monk's head at his shoulder").
- No editing jargon in fields ("on a beat" → "when fighting").
- Plain action first so the model can't misread the shot, then the flourish. The director's two-paragraph pattern (simple statement, then detail) is canon.
- State near/far and let the lens work; never describe what a lens does to a body's shape ("his body runs away small to a head" = body horror).
- No suggestions unless asked (extends the four-suggestions kill — he pitched 4 next-clips after a beat write and was told "don't waste tokens").
- Mode discipline: told "watch only, stop asking for go", he asked for go three more times. Watch-only means read, report, flag before spend — zero write offers.
- Backstory renders nowhere: story lives in the brief, the sheet is what the camera sees ("killed a nobleman" → "on the run").
- Character notes that can't be drawn ("a calm he performs, not one he owns") belong in the brief, not physics.

## 13. Code gaps from session 2 (code)

a. **Render errors are invisible.** The director's loudest ask, shouted twice. fal error text dies in the UI; failed jobs must persist (status code, provider message, jobId, timestamp) where the Co-Director reads them. He diagnosed the 422 content-policy flip well — but only after manual paste.
b. **No preflight on spend.** generateAudio=false went out on a $6.24 take whose audio_design carried the whole sound design. Preflight check before render: audio flag vs audio fields, stale/dangling @titles (reference_handling naming a detached ref), linked-sheet content vs clip (Shaolin fight line riding into a walking clip), beat durations vs clip duration.
c. **Stale reads + no write log.** He repeatedly read stale state ("my disk read was stale", "probably lagging like last time"), and the "you replaced my beats" dispute was unresolvable because there's no write audit trail the user can see. Writes need a visible log; his snapshot/disk reads need freshness.
d. **Duplicated clips share beat ids** (INTRO and THE STRUT both carried b16f398d). Confused the beats dispute.
e. **Context rot is real and has no valve.** Director watched him degrade over the session and asked for a crunch; nothing exists. Wrong-target writes (KATA instead of KATA 2), re-asking settled things.
f. **Voice field now exists in project data** (director's manual edit created `voice` on the Cave Demon sheet) — tools still can't write it. §4a upgraded from types-only to data-on-disk.

## 14. Product decisions from the notes chat (2026-08-27, with the director)

- **RLM-style context is VIABLE and half-built**: bridge engine already has Read/Glob/Grep over the project folder. Target shape: small fixed core per turn (brief, stage, rules, recent exchanges), everything else fetched on demand; the giant snapshot paste goes away. Needs §1's compiled-YAML read and §13c's freshness to work. Cost: per-lookup latency. Accepted.
- **RLM as a settings toggle** (RLM mode vs full-pipe). Open question for the spec: which is default.
- **Rot valves, two buttons, user-pressed**: COMPACT (fold durables into the brief, squash the chat log to a summary, continue) and FRESH SESSION (fold, then new chat loading brief + stage only). Co-Director may suggest a compact when long; the press is the user's.
- These findings feed the ground-up rejig brief (plan of record: no piecemeal patches). Two buckets agreed: functional (tools/context/code) and behaviour (the guide rewrite, §6 on top).

---

# Session 2, first third (lines 80–364) — cases missed by the first distillation, recovered by the 2026-08-27 fresh-eyes review

The 2026-08-27 notes chat worked from a paste that began mid-session; the strongest
corrections of session 2 live in its first third and were absent from every derived doc
until an independent reviewer caught them. (Meta-lesson, logged: distill from the saved
file, never from a paste.)

## 15. The Co-Director's own go gate (guide — top tier)

"**you jjust chenged it without my persioning?!**" … "**this is an error never make a change
without asing for mpermission**" … "**this is liek the go gate**" … "**exmaple first dont do
till i say ok**". The standing rule from it: propose in chat — example first — write only on
the director's ok. And its corollary, saved in-session: "a complaint is not a brief,
dissatisfaction is not permission, propose and wait" — the model's recorded tendency is to
make changes when the user says they're unhappy, without getting direction first. This
outranks and replaces the shipped guide's "direct writes when the intent is clear"; "clear
intent" is exactly the judgment that failed twice (the imp sheet, the beat-4 rewrites).

## 16. NO DECORATION, NO MECHANICS (guide — field craft)

"**WET IRIS? what do you think the model will do with that?**" (wet reads as tears — a noun's
connotation is an instruction); "**lips pursed will backfire describe the action 'whistling
calmly'**" (animating the mouth = mechanics the model fixates on); "eyes easy" (mood adjective
where a picture should be); "the push holds a single direction" (a note-to-self in an action
field). Rule saved in-session: write the STATE and the ACTION, never the body's mechanics,
never decoration. Every noun must be inert.

## 17. Camera-move craft recovered (guide)

- **A push needs a target, not a route**: "camera crosses his cheek" gives the model a route
  across skin — it frames the cheek or wanders. "The camera pushes in until his eye fills the
  frame" names the destination.
- **The frame ladder**: for a long move, write the frames it passes through in order — "his
  face fills the frame, then one eye, then the iris edge to edge" — "the model follows 'X
  fills the frame' far more reliably than 'the camera moves in'. A ladder it can climb rather
  than an instruction it can interpret."
- **A beat boundary is the strongest cut signal**: "Splitting the one shot we absolutely
  cannot let it cut is handing it the knife." An uncuttable move is ONE beat, its phases
  ordered events inside it.
- **Plant, then name**: a fact the move arrives at is planted early in passing ("the road
  sitting small and bright in his eyes") and named at arrival ("the iris fills the frame with
  the reflection lying on it") — a sanctioned two-appearance pattern, like the graded double.

## 18. A GO answers only the question it was asked for (guide)

The 6-vs-8 seconds tangle: the Co-Director asked where the spare seconds go, the director
said "go" without answering, the Co-Director resolved it himself (took 2s off the clip) —
confusion followed. With durations there is arithmetic (beats must total the clip), but an
unanswered question stays a question; a GO that didn't address it is not an answer to it.

## 19. RLM, defined by the director (code)

"**fable this is one reason i want to introduce a RLM wrapper to codirector, rto reduce
token useage and also reduce context rot**" — said at the moment the rot was live (the
Co-Director's own tells that session: decoration his rules ban, one-take stated in three
fields, losing the 6-vs-8 thread). This is the origin and the definition of brief bucket-1
item 11: fewer tokens per turn, no degradation over session length. His workaround order
that session doubles as a design hint: read the field off disk before touching it, one line
at a time.

## 20. Fresh-eyes review of the statutes (process, 2026-08-27)

An independent reviewer (sessions + statutes only, no prior analysis) found: 6 gaps (§15
and §18 among them), 5 wording misfires (incl. "write what the camera sees" permitting
"wet iris"; "stated positive" blessing "true proportion"), 6 ambiguities (incl.
flag-vs-suggestion undefined — the exact silence that burned three renders), 3 lost values
(thesis shot; the stage marker hardened; error visibility), 5 matrix errors (incl. the
$6.24 misattribution, now corrected in §7). Statutes v2 incorporates all of it. Standing
process rule: every statutes revision gets a fresh-eyes pass before it ships.

---

## Open: to watch for as the project continues

- Styles stage: does he double up style text with what sheets carry? Does he link or copy?
- Clip stage: the §1 test. Count compiled prompt length vs what he adds.
- Does the learned "interview first" rule over-apply to clips (where direct writes are wanted)?
- Reply length drift after the cap is added.
