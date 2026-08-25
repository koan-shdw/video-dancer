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

## Open: to watch for as the project continues

- Styles stage: does he double up style text with what sheets carry? Does he link or copy?
- Clip stage: the §1 test. Count compiled prompt length vs what he adds.
- Does the learned "interview first" rule over-apply to clips (where direct writes are wanted)?
- Reply length drift after the cap is added.
