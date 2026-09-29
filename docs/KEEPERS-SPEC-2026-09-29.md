# Keepers, the Lightroom way: a keeper is a flag, many per take set, ~ and click, keeper-only. Spec 2026-09-29

Items 53, 55, 56 on `TODO-2026-09-22.md`. Status: SPEC, nothing built. No picks owed.

## 1. His words

53 (09-24, confirmed 09-27): "add ability to hit tilder when selecting takes to make it a 'take'
and again to turn the take off, like lightroom, also add it to right click" · "related to hitting
tilde to set something as a keeper".

55 (09-27): "add a 'keeper' only toggle for the takes".

56 (09-27): "we'll need more than one keeper in a take set and for the stars to stay on when they
are".

His answer to the first draft (09-29): "no you misunderstand what a keeper is, we can have mutple
keepers in a take set, tilda or click keepersets is as a keeer, its a flag".

## 2. What the app does today (read 09-29)

- ONE keeper per take set: `keeperTakeId` on clips, score clips, voice clips and image gens
  (`shared/types.ts`). No keeper saved = the newest take that isn't disabled plays.
- Clicking a take makes it the keeper and plays it; the ★ moves to it. Arrow keys preview only,
  never the keeper (his 09-22 call). Ctrl/Shift-click multi-selects.
- Five take surfaces: Clip Gen (`RenderPanel.tsx`), Sheet Gen, Image Gen, Score and Voice (the
  last two share `AudioTakeRow` in `panels/shared/takeRows.tsx`).
- The keeper is what a timeline block that follows its clip plays, what the Bin tile shows, what
  export and assembly use, and what the Co-Director reads and sets (`set_keeper_take`).
- Main has one setter per kind: `setKeeperTake`, `setScoreKeeper`, `setVoiceKeeper`,
  `setImageGenKeeper` (`project.ts`).
- The ~ key is free everywhere.

## 3. The rule

A keeper is a flag, Lightroom's pick flag, and a take set holds as many as you like.

- **Click** a take: it becomes a keeper and plays. Every other keeper stays flagged.
- **~**: flags the selected take, or takes the flag off if it has one.
- **Click a lit ★**: takes that take's flag off.
- **Right-click**: "★ keeper" or "☆ not a keeper".
- Stars stay lit.
- **★ only** shows just the keepers.
- Arrow keys still preview only and never flag (his 09-22 call).
- **What the timeline plays** (a block that follows its clip, the Bin tile, export, assembly):
  the take flagged LAST. Unflag it and the one flagged before it plays. No keepers = today's
  rule, the newest take that isn't disabled. Clicking a take that is already a keeper keeps its
  flag and makes it the one that plays. The last-flagged rule is my pick, told to him 09-29
  before his GO.

## 4. Build

### A. Data
- Every take set keeps `keeperTakeId` with the SAME meaning (the take that plays), so every
  reader in the app keeps working untouched.
- New optional `keeperIds`: every keeper, in the order they were flagged. `keeperTakeId` = the
  last one in it, or none when it's empty.
- Old projects load as they are: `keeperIds` = `[keeperTakeId]` when a keeper is saved.

### B. Main
- One toggle per kind replaces the four setters' core: flags on or off for a list of takes, one
  save, one undo step.
- The old "set keeper" calls now mean "flag it and make it the one that plays": a take click,
  the Co-Director's `set_keeper_take`, the Image Gen menu's "★ keeper".
- The Co-Director's snapshot names every keeper and says which one plays.

### C. Click
- A plain click flags the take and plays it: today's click, except the other flags stay.
- Clicking a lit ★ takes that take's flag off.
- Ctrl/Shift-click still only selects; ~ or right-click then flags the whole selection.

### D. The ~ key
- Works on the takes row that has focus (the same box the arrow keys use, `lib/arrowNav.ts`).
- Toggles the flag on the selected takes: one take, or every take in a Ctrl/Shift selection
  (a mixed selection all turns on). Ignored while typing in a field.

### E. Right-click on a take
- "★ keeper" or "☆ not a keeper", for the take or the whole selection.

### F. How keepers look
- Every keeper wears a lit ★ and keeps it.
- The one that plays keeps today's amber border as well.

### G. Keeper-only (55)
- A small "★ only" switch at the head of every takes row. On = only keepers show (Clip Gen's
  S-B tile stays). Remembered per panel.

### H. Everywhere at once
- Clip Gen, Sheet Gen, Image Gen, Score and Voice, one shared helper so all five behave alike.
- A take pinned on a timeline slot is untouched: picking a take while editing a slot still sets
  that slot only.

## 5. Where it lands

- Renderer: `RenderPanel.tsx`, `SheetGen.tsx`, `ImageGen.tsx`, `ScoreCard.tsx`, `VoicesCard.tsx`,
  `shared/takeRows.tsx`, `lib/arrowNav.ts`, `store.ts`.
- Main (dev app restart): `project.ts` (toggles + old-project load), `index.ts`, preload,
  `env.d.ts` (the toggle wires), `codir.ts` (snapshot + tool).
- Format: one new optional field. Old projects open unchanged.
