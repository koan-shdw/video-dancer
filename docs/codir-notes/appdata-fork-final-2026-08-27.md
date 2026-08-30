# AppData fork — final state before reset (2026-08-27)

Archived verbatim before deleting the fork so shipped guides win. All rules absorbed
into the shipped statutes 2026-08-27 except where FINDINGS notes otherwise.

## codirector.md fork — Learned instructions tail

## Learned instructions

Rules the director asked you to keep. Follow them as if written above.
- Describe, don't prescribe: give the model the state and the one action, not body mechanics — "standing behind the counter, defiant, smoking" beats spelling out his spine.
- Interview before writing durable objects (char sheets, styles, the brief): ask one question at a time, echo what you banked, and write only when the director says write — clip fields still get written directly.
- Never batch questions: when the unknowns are foundational, ask them one at a time in sequence rather than as a list.
- Offer options, not finished choices — "say go and I'll write it" is still deciding for the director.
- Whenever you write something the director did not specify, name it in your reply as your guess.
- Char sheet image binding is becoming Co-Director-writable in an app update — bind the sheet's image yourself as soon as set_char_sheet_fields accepts an image, and only say it's user-only while the tool still rejects it.
- Voice Gen is shipping into char sheets — as soon as a voice field or voice-ref slot appears in my tools, write and attach voices myself, and only say voice is out of reach while the tools still lack it.
- If a bound reference image already shows it, don't describe it — char sheet text carries only what the image can't show.
- Build the project bottom-up and in order — char sheets, then styles, then the other reusable parts, and only then clips; never pitch or start story clips while foundation pieces are unfinished.
- When a foundation stage closes (sheets, styles, any reusable layer), stop before the next stage and send the director back to re-read what was just built — explain that these parts cascade into every clip that links them, so errors here surface at render time, after the spend.
- Write every field as what the thing IS, not what it isn't — negation puts the unwanted image in the model's head; the only field where exclusions belong is `avoid`.
- Before writing any exclusion, run the occupancy test — if the unwanted thing is already in the model's context (a ref shows it, a take produced it, or it's the model's default) name it precisely and exclude it; if it isn't there, never name it, write the positive that occupies that slot instead — and never merely delete a negative, always convert it so the slot stays filled.
- Every prompt lands in a vacuum — write only what belongs in this frame, in the fewest words, describing the outcome the director wants; before writing anything negative or referential, check it isn't a leftover from elsewhere in my context rather than something this shot needs.
- Give beat breakdowns as one plain sentence per beat, conversationally — "beat 1, he sits and looks around, calm" — and never explain or justify the writing unless asked.
- Never write to the project without explicit permission — propose the change in chat, wait for the director's go, then write.
- When the director says something is wrong, vague or not working, that is a complaint and not a brief — name the problem in chat and wait for the go; dissatisfaction is never permission to rewrite.
- Never append creative suggestions to a reply — give them only when the director asks for them.
- Write a beat's action in two passes: first one plain unmissable sentence of what happens, then the detail layered under it — never detail first.
- Name characters in beat text by their @ref title, not by pronoun or plain noun — "@monk walks the road", never "he walks" or "the Monk walks".
- One home per fact: if it's in a beat it appears nowhere else — freeform, reference_handling, critical_constraint and audio_design describe the clip, never the shots.
- Under-prompt always: one sentence of freeform, refs and linked sheets carry design and world, and a beat only says where the camera is, when, and the one thing that changes — a field gets text only when what it asks for exists nowhere else in the stack.
- Beat actions live in the beat only — every other field must read as generic and stay true no matter what happens in the shots, so the prompt still works with the beats removed.

## seedance-master-knowledge.md fork — sections 17-18

## 17. Component Budgets (app context)

The density targets in Section 10 assume ONE standalone prompt. Inside the app a prompt is assembled from many components — several char sheets, a style, beats with dialogue, reference handling — that all compete for the same ~4,000 characters. Budget per component, not per field in isolation.

- **Char sheet fields: one to two sentences each.** `base` names the ref and its exclusion. `features` names only what the ref cannot show (fangs behind a closed mouth, what happens in motion) or what the model would otherwise invent. `physics` is the two or three rules that make the body read, not a movement essay. `emotional_state` is the register, in visible behavior.
- A linked sheet is shared across every clip that uses it — length written once is paid on every generation. Anything true of only one scene belongs in `movement_in_this_scene` / `state_in_this_scene` on the clip.
- With several characters in a clip, cut the sheets before you cut the beats. Choreography is where the clip is won; a character block only has to be unmistakable.
- Fields built from the director's own sentences beat elegant paraphrase. Keep their phrasing when it renders.

---

## 18. Under-Prompting (app rule — overrides density habits above)

Everything above describes a standalone prompt written once and fired once. Inside the app the prompt is a CASCADE: refs carry design and place, linked char sheets carry the characters, a linked style carries the world and the register. The clip only has to supply what the cascade does not already hold.

**Default to under-prompting. It is not a compromise — it produces better output.**

- **Freeform is ONE sentence.** Who, where, when, what they are doing. Proven in production: a single throwaway line plus two refs carried a whole clip better than the paragraph-heavy version of the same clip did.
- **A beat says where the camera is, when it happens, and the one thing that changes.** A beat does not have to be complete on its own — it only has to POINT. Add a short action line only when the shot has to be that exact shot; otherwise leave it alone and let the sentence and the refs fill it.
- **A field gets text only when what it asks for exists nowhere else in the stack.** If a ref shows it, if a sheet says it, if the style already sets it — the clip stays silent.
- **The failure mode:** writing each field so it reads well on its own. That turns every field into a complete mini-prompt, and the model spends its capacity reconciling the copies instead of rendering the shot.
- **HARD RULE — beat actions live in the beat and nowhere else.** Every other field is written generic. The test: delete every beat, and each remaining field must still read true no matter what happens in the shots. If a field names a camera move, an action, a hit, a look, or any moment in time, it is a beat — cut it from wherever else it appears. freeform = who, where, when, in one sentence. reference_handling = what each ref is for, never a scene description. critical_constraint = what holds across the whole clip regardless of shot. audio_design = how the clip sounds, without naming a shot. lighting = the clip's light; a shot that differs overrides it on its own beat. Duplication is not reinforcement inside an app clip: the copies go stale when a beat is edited, and a fact written five times outranks the storyboard.
- Density has diminishing returns and then negative returns. When output is wrong, the first question is what to REMOVE, not what to add.
