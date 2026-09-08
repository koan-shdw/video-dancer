# MOODS — `.vmd` briefs for the Co-Director (spec, 2026-09-08)

Director's brief, his words (2026-09-08): what we learn from the research goes into the Co-Director;
users save MDs as they work, and when one is perfect they click it and it's added to the memory.
"MOODS": an expandable section above the prompt where they're brought up and run — "we say ANIME
and this one comes up, or dark fantasy and another comes up." Click = in memory for the session.
"They're essentially briefs for co-director to create dope prompts." Our own format: **VMD**.
One file, both halves (how to write + what to know). Import/export matter — "sometimes a person
might have a session with codirector from scratch and be like, hey this is a good mood, let's
save this." Two tiers: the general VMD (the Co-Director's standing knowledge, grows as we learn)
and special VMDs (the styles — "VMD" in general means these). Chevron above the INTENSITY pill,
opens to list installed MOODS. Management: new · add · delete. Later: a community repo anyone
can install from, author credited. Tether stays a scalpel — panel and Room only.

Status: APPROVED + BUILT 2026-09-08 (GO given; questions settled: author = Settings field AND
first-save ask; ON = session-only, pins per project; size = warn, never cap). PROVEN in node:
parseVmd / buildVmd round trip, convertSkill on his real 2.5 skill, library seed (the two shipped
moods), save, `#slug` matching, moodBlock, zip import (system bsdtar), delete. UNTESTED in the app:
the fold, chips, `#` popover, the "matches" chip, + new interview, save_mood, Settings author.
Gotchas found by the proof: the halves regex first stopped at the first line end (fixed to a
title split); GNU tar on PATH reads `C:` as a host (fixed: System32 tar.exe); a OneDrive
cloud-placeholder zip fails to open (the app reports it, re-drop the file).

## 1. What exists (verified 2026-09-08)

- Guides (`src/main/guides.ts`): four shipped MDs — `codirector` (always loads), `master`,
  `prompter-claude`, `prompter-chatgpt` — toggled in Settings (`codirGuideLoad`), assembled by
  `buildSystemGuides` into the system prompt. Tools already exist to grow them: `update_guide`
  (edit a guide) and `remember_instruction` (learned instructions, always load). **That IS the
  general tier.** The brief (`update_brief`) is the per-project note.
- The prompt boxes: Co-Director panel and Director's Room both run the `@` popover (regex at the
  caret, list of matches, pick inserts the title). INTENSITY pill sits above both boxes.
- Files: `userData/` holds settings, thumbs; projects hold their own data. `Library` folders and
  the Section fold (`title`, `collapsible`) are the grammar for lists.
- fal credit chip in the top bar (`FAL $-3.23`) + the spend ledger (`spend:add`).
- The skills on disk: SKILL.md (frontmatter `name` + `description` = the ROUTER: trigger
  phrases + "do not fire" exclusions; ROLE; locked template; output rules) + KNOWLEDGE.md.

## 2. The format — `.vmd`

Plain markdown with a YAML header. Any editor opens it.

```
---
vmd: 1
name: HARDCORE ANIME
triggers: [anime, manga, hardcore anime, retro anime, 1985 OVA]
not-for: [dark fantasy, live action, practical effects]
tags: [image, style, anime]
author: ""
version: 1.0
suffix: ""            # optional always-on closing line (his locked tech spine goes here)
---

## How to write
(role · the locked template + anchor phrases · banned words · output ritual · feedback style)

## What to know
(anchor profiles · keyword pools · registers · pull-bank · proven examples · construction
sequence · merge rules · camera language · suggestion categories)
```

- `triggers` / `not-for` come straight from his `description` field — that is how "say ANIME
  and it comes up" works (§5). `author` is in from day one for the community credit.
- Import converts his two-file skills: description → triggers/not-for, SKILL body → How to
  write, KNOWLEDGE → What to know. One `.vmd` out. Export writes the file back as-is.
- The default template for a NEW mood = his skeleton (the two files share it): opening phrase
  · anchor roster (DNA / fire-when / keywords / attribution line / sources) · closing spine ·
  banned words · archetypes · register · examples · four-suggestion ritual.

## 3. Two tiers, one format

- **General** = the guides (exists). Grows by `update_guide` / `remember_instruction`, and by
  PROMOTING a mood: right-click → *promote to general* copies its How-to-write into a guide.
- **Special** = MOODS. Put on, take off. This spec builds these.

## 4. Storage and state

- Library: `userData/moods/<slug>.vmd` — installed once, available in every project.
- Session: **on** = in the renderer store only (his words: "enters the memory for the session").
- Project: **pinned** = `Project.codir.moodsPinned: string[]` (slugs) — additive, schema stamp.
- One-shot: a `#name` in the message rides that exchange only; nothing stored.

## 5. UI — the fold (Co-Director panel + Director's Room; never the tether)

- **Collapsed**: one row directly ABOVE the INTENSITY pill: `⌃ MOODS` on the left, then the
  active names as tiny amber tags (`ANIME · 80S DARK FANTASY`), count on the right. Click the
  chevron → the fold rises.
- **Open**: a chip per installed mood. Chip = name in mono caps. States: off (plain button
  grammar) · on (amber fill) · pinned (amber fill + `📌`). Click = on/off. Hover = the
  description line + size in tokens ("~14k tokens — cached after the first exchange").
  Right-click menu: pin / unpin · edit (opens the file) · export · promote to general · delete
  (confirm). Bottom row: `+ new` · `⇪ add`. Drop a `.vmd` / `.md` / skill `.zip` on the fold =
  add. Empty state (the floating citizen grammar): "no MOODS — add one or ask me to make one."
- **`#` popover**: typing `#` in either prompt box lists moods matching the query (the `@`
  mechanics, same look); pick inserts `#NAME`. That message rides with the mood once.
- **"It comes up"**: when a typed message contains a trigger phrase of an installed mood that
  is off, a one-line chip appears above the box: `MOOD ANIME matches — ✓ turn on · ✕`. Never
  auto-on; the user clicks. (His description routing, made visible.)
- Room: the same fold above its input; one component, two homes.

## 6. Context — what he reads

- Every on/pinned mood is appended to the guide block as `## MOOD: <name>` with the full body
  (both halves) and its `suffix` stated as "close every prompt with: …". A one-shot `#NAME`
  appends the same for that exchange. The "Where the user is" line lists the active moods.
- Prompt caching makes a 14k-token mood cheap after the first exchange; the chip tooltip says
  its size so the user knows what they're loading. Not-for lists are shown to him as "do not
  reach for this mood when …" — he never fires a mood himself; the user does.

## 7. New · add · save-from-session

- **`+ new`** → sends the app line: "(app: the user wants to create a new MOOD. Interview them
  briefly — name, triggers, the look and its lineage, the anchors, the locked opening/closing
  lines, banned words, rules, two example prompts. When it is settled, call save_mood.)" Then it
  is a normal conversation.
- **`save_mood`** — a new write tool, go-gated like every write: `{ name, triggers, not_for,
  tags, suffix, how_to_write, what_to_know }` → the app writes `userData/moods/<slug>.vmd`
  (author = the name in Settings → "your name on MOODS you make", default "you"). Also fires
  on "save this as a MOOD" in any thread.
- **`⇪ add`** → file picker (`.vmd`, `.md`, `.zip` of a skill) or drop. Skill pairs convert.
- **Export** → reveal the file / save-as. **Delete** → confirm, file removed.

## 8. Community (format-ready now, wired later)

`⇪ browse` reads `index.json` from a public repo (`koan-shdw/vidancer-moods`): name, author,
tags, description, download URL. One click installs. Author from the header is shown on the
chip's hover from day one. Publishing = a PR to the repo (later: in-app).

## 9. Files

- main: `moods.ts` (list / read / save / import / convert skill pair / export / delete),
  IPC `mood:list · mood:save · mood:import · mood:export · mood:delete · mood:reveal`;
  `codir.ts` — `save_mood` tool, mood block in `buildSystemGuides` (moods ride with the guides),
  active names in the "Where the user is" line; `project.ts` — `codir.moodsPinned` (stamp).
- package: `ui/MoodFold.tsx` (the fold + `#` popover hook), used by `CoDirector.tsx` and
  `DirectorsRoom.tsx`; `store.ts` — `moods` (list), `moodsOn` (session), pin/on actions;
  `SettingsModal` — "your name on MOODS".
- ship: `moods/hardcore-anime.vmd` and `moods/80s-dark-fantasy.vmd` converted from his files,
  installed on first run.

## 10. Acceptance

1. Fresh install: the fold shows ANIME and 80S DARK FANTASY, off.
2. Click ANIME → amber; the next exchange's system prompt carries `## MOOD: HARDCORE ANIME`
   (read_compiled_prompt-style check: the bridge log shows it); ask for "a prompt for a
   cyborg dancer" → his answer follows the anime template (anchor phrases, code block, four
   suggestions).
3. Pin it → survives a restart in that project; off in another project.
4. Type `#dark` → the popover offers 80S DARK FANTASY; pick → `#80S DARK FANTASY` in the
   message; that exchange carries it; the next does not.
5. Type "give me a retro anime look" with ANIME off → the "matches — turn on?" chip appears.
6. `+ new` → he interviews, calls save_mood → new chip appears; the file opens in a text editor
   with the header intact.
7. Drop his `seedance-prompter-2.5.zip` on the fold → converts to one `.vmd` with both halves.
8. Delete → gone from the fold and disk after confirm.

## 11. Open (director)

1. Author name: a Settings field, or ask the first time you save?
2. Should ON moods also persist per project (like pins), or stay session-only as you said?
3. Size guard: warn above ~30k tokens per mood, or no cap?
