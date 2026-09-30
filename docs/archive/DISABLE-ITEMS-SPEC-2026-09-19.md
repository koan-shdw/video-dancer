# Disable a Library / Bin item — 2026-09-19

Status: BUILT 2026-09-19 on his GO, both calls answered (§6). Typecheck clean · npm test 57/57
(new `scripts/test-disable-items.cjs`: one save, ONE undo for a mixed selection, what uses a benched
item is untouched, the key leaves the file on enable, timelines ignored, the @ / pick-list rules) ·
the full CI browser list · build · preload smoke test: all green locally. NOT run in his app.
Uncommitted.
AS BUILT: nine kinds (no timelines). `lib/disabledItems.ts` = the list rules in one file
(`mentionMatches` replaces the four copied @-picker lines; `disabledLast` + `dimStyle` for pick
lists) · `lib/disableEntry.tsx` = the one right-click entry (Foldered for a lone pick, `selectionMenu`
for any multi / mixed selection, the Library's video + music menus) · Foldered dims the tile + draws
the `⃠` corner mark for every foldered kind · pick lists done: beat ref image, char sheet image, Clip
Gen's image picker, RefSuite image / video / audio, the field-link and character-link pickers (last
WITHIN their pinned group), Voices image + sample. The floating empty-panel pickers (FloatPick)
are untouched — they choose what to OPEN, not what to reference. Co-Director: `set_items_disabled`
tool (names or ids), the `## Disabled by the director` section in BOTH context builders, enabled-only
lists (the clip he is ON and the open image gen always stay listed), `read_object` prefixes
`DISABLED by the director`, one line in the bundled guide — the rule also lives in the tool
description and the section header, where a personal guide fork cannot hide it.

His words: "add a feature in library and bin where we can right click gorup or single disable a item
its still ther and still functions just it wont come up with we @ select in a prompt and codirector
know its disables so wont look for it imeditly, still can access if we need ansd actually can
undisable if we need, but it will look at the non disabled ones first"

## 0 What exists (read 2026-09-19)

- THE SIBLING: takes already have it. `Take.disabled` = "marked as a dud: dimmed everywhere,
  skipped by keeper auto-fallback"; the take menu says `⃠ disable N (dud)` / `✓ enable N` and acts on
  the whole take selection (`RenderPanel.tsx:2048`). Score, Voice and Image Gen takes carry the same
  flag. NO Library or Bin citizen has one (Clip, ProjImage, ProjVideo, ProjAudio, CharSheet, Style,
  ScoreClip, VoiceClip, ImageGen job, Timeline). `TimelineItem.disabled` is a different thing
  (Premiere's Enable off for one placed block) and stays untouched.
- THE @ PICKER: four copies of one line — `libImages.filter((i) => i.title.toLowerCase()
  .includes(mention.query)).slice(0, 8)` — in `RenderPanel.tsx:964` (Clip Gen),
  `ImageEditor.tsx:703`, `CoDirector.tsx:137`, `DirectorsRoom.tsx:276`.
- THE CO-DIRECTOR sees the project as an INDEX (`codir.ts buildCoreContext`, RLM mode, and the same
  lines in the older full-context builder at `:870`): `## Library images` = one flat row of @titles;
  one line per style, char sheet, timeline, clip, image gen. `read_object` opens anything verbatim.
  It can already `move_to_folder`, `rename_item`, `duplicate_item`, `delete_*`.
- THE MENUS: Foldered (`panels/Foldered.tsx`) wraps every foldered kind (clips, images, sheets,
  styles, scores, voices, image gens) and appends its shared block to the panel's own item menu; a
  multi-selection goes through `lib/selectionMenu.tsx`. Library videos, music rows and Bin timelines
  have their own small menus + the same multi-select gesture.

## 1 The flag

- One optional field, the takes' word and meaning: `disabled?: boolean` on ProjImage · ProjVideo ·
  ProjAudio · Clip · CharSheet · StyleSheet · ScoreClip · VoiceClip · ImageGen job · Timeline.
  Absent = enabled. No schema bump needed (optional field, old projects read unchanged).
- MAIN `setItemsDisabled(sel: SendSelection-shaped ids per kind, disabled: boolean)` → one save, one
  delta, ONE undo step for the whole selection. IPC `items:setDisabled`.

## 2 What disabling does — and does not

DOES:
- The tile / row DIMS (the takes' look) and wears a small `⃠` in its corner; tooltip adds
  `disabled — right-click → enable`. It stays exactly where it is: same folder, same order.
- It no longer comes up in the **@** picker — all four (Clip Gen, Image Edit, Co-Director,
  Director's Room). The four copies become ONE helper (`lib/mentions.ts mentionMatches`) so they can
  never drift.
- The Co-Director is told (§3).

DOES NOT — "its still ther and still functions":
- Anything already using it keeps working: a clip whose refs include a disabled image still sends
  it; a linked disabled sheet / style still compiles into the prompt; a disabled clip still plays
  and exports on a timeline; a disabled score / voice still sounds.
- An @title he TYPES by hand still resolves (only the suggestion list skips it).
- Drag, double-click, rename, duplicate, send to project, delete: all as before.

## 3 The Co-Director

- INDEX: every list drops its disabled entries into ONE trailing section, so the enabled ones are
  what he reads first:
  `## Disabled by the director (benched, not deleted)` + one line per item in the list's own
  format, prefixed with its kind. Header line, verbatim rule: `Work from the enabled items first.
  Do not reach for these unless the director names one or nothing enabled fits. read_object still
  opens them. If one is truly needed, set_items_disabled it back on and SAY that you did.`
  Both context builders (RLM index + the full-context lane).
- TOOL `set_items_disabled { items: [{ kind, id_or_name }], disabled: boolean }` — write-class like
  `move_to_folder` (same go-gate / live-write card as the other writes). He can bench things when
  asked ("disable the old robot refs") and un-bench when needed.
- `read_object` on a disabled item prepends `DISABLED by the director` to its dump.
- The rule rides in the TOOL description + the index header, not only in `codirector.md` — a
  personal guide fork must not be able to hide it (the 09-08 fork lesson). One line is also added to
  the bundled guide's reach section.

## 4 The menus — "right click gorup or single"

- ONE entry builder, `lib/disableEntry.tsx disableEntryFor(kind, id)` (the `sendEntryFor` pattern):
  acts on the WHOLE multi-selection across cards when the right-clicked item is in it, else on that
  one item. Label, the takes' grammar: `⃠ disable` / `✓ enable` for one, `⃠ disable N selected` /
  `✓ enable N selected` for many (enable when every picked item is already disabled, else disable).
- WHERE: Foldered appends it to every foldered kind's menu (one place = clips, images, sheets,
  styles, scores, voices, image gens) · `selectionMenu` carries it for mixed selections · the
  Library's video + music menus and the Bin's timeline menu get the same entry.

## 5 Files

- koan-shared: `shared/types.ts` (the field ×10) · `lib/mentions.ts` (new) + the four pickers ·
  `lib/disableEntry.tsx` (new) · `Foldered.tsx` · `lib/selectionMenu.tsx` · `Library.tsx` ·
  `Bin.tsx` (dim + mark on tiles, the three non-Foldered menus) · `store.ts` (action) · `env.d.ts`.
- vi-dancer: `project.ts` (`setItemsDisabled`) · `index.ts` IPC · preload · `codir.ts` (index
  section ×2, tool, read_object line) · `guides/codirector.md` (one line) · a node test in
  `scripts/` (flag round-trip, one undo, index section, a disabled ref still compiles).
- Main + preload change: full restart. CI browser tests run locally before any tag.

## 6 His calls — ANSWERED 2026-09-19

ANSWERS: (1) "dimmed at wend i lie that" = **last**: in the pick popovers a disabled item shows
DIMMED, AT THE END of the list, still pickable. (2) "no" = timelines are NOT part of this; the
flag lands on nine kinds, not ten (§1's Timeline is struck, and §4's timeline menu with it).

1. PICK POPOVERS. Besides **@**, nine "pick an image / voice / sheet" popovers list Library items
   (ref slots, beats, char sheet image, the Image Gen ref boxes…). His words name only **@**.
   For those lists: **hide** disabled items too (mine: same idea, "it wont come up") / **last**
   (dimmed, at the end) / **leave** them as today.
2. TIMELINES count as Bin items here (disable hides one from the Co-Director's first look; it still
   plays). yes (mine) / no.
