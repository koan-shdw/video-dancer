# Link Override Spec - 2026-08-26

STATUS: BOTH surfaces BUILT 2026-08-26 (schema v21; typecheck clean, not yet run in-app).
The two OPEN questions were resolved by GO without an answer; defaults chosen and stated:
Q1 open-the-source moved to RIGHT-CLICK on scene/production chips (house grammar; double-click
is now the push). Q2 revert = CLEAR, same grammar as the characters surface.

## The feature (user's brief, locked in chat 2026-08-26)

Today a linked field splices the source's live text first, then appends whatever you type
in the field ("add text after the linked field"). New gesture:

- **Double-click the link chip** -> the chip's current text is pushed into the field,
  the chip fades, and from then on the FIELD REPLACES the chip's text in the emitted
  prompt. Edits replace, they do not append.
- **Click the faded chip** -> revert: the field CLEARS, the chip goes live again,
  splice back to normal (link first, field appends after).
- Per field only. Only the chip you double-click is overridden.
- Applies wherever link chips exist.

WYSIWYG rule: at the moment of push, the field is filled with exactly what the splice
was emitting for that chip (source text, plus any append text already in the field,
joined the same way the splice joins). The emitted prompt does not change until you edit.

## The two surfaces

### 1. Linked characters (ClipFields.tsx `LinkedField`) - CLEAN, no conflicts

One source per field (the linked char sheet / clip character). Chip currently has no
click behavior at all; double-click is free.

- Push: `override[k] = join(src[k], override[k])`, mark `k` replaced. Field shows it.
- While replaced: `spliceChar` emits `override[k] ?? ''` for that key, source ignored.
  Empty field = field is blank in the emit (replaced-with-nothing is valid).
- Chip stays visible, faded (opacity ~0.45), still shows the source's LIVE text.
  Title: "overridden - field replaces this. click to relink (clears the field)".
- Revert (single click on faded chip): remove replaced mark, delete `override[k]`.
  Field is empty, splice is live again.
- "(source empty)" rows have no chip: no gesture, nothing to push.
- `referenceLabel` is exempt: @ref already has its own replace rule.

Data: `CharacterLink.replaced?: (keyof CharacterField)[]` (shared/types.ts).
Optional key, absent = old behavior, old project JSON loads unchanged.
`setOverride`'s empty-value cleanup must NOT drop a key that is in `replaced`
(replaced + empty is a real state). Persists automatically via
`PromptData.characterLinks` (save at RenderPanel ~893/~957, load ~567). Nothing
main-side or Co-Director-side changes; codir writes the same paths it always did.

### 2. Scene / production field links (ClipFields.tsx `FieldLink`) - two OPEN calls

Chips stack (several sources on one field) and the field under them is the clip's own
persisted field text, not an override box.

Per-chip: double-click chip X pushes X's text into the field (spliced into X's position:
earlier live chips still emit before the field, later ones after - in practice X's text
joins the front of the field, matching today's splice order), X fades and is excluded
from the splice. Other chips in the stack stay live.

Data: `PromptData.fieldOverrides?: Record<string, string[]>` - path -> source ids
currently overridden (faded). Optional, old projects load unchanged.
`resolveScene` / `resolveProduction` skip overridden ids when gathering `vals`.
Load/save beside fieldLinks in RenderPanel; add to PromptData in shared/types.ts;
confirm main/project.ts and pending.ts pass the key through untouched.

**Q1 (resolved - default):** open-the-source moved to RIGHT-CLICK (both chip states);
double-click is the push. Tooltips teach both.

**Q2 (resolved - default):** revert = CLEAR, exactly like the characters surface - even
text typed before the link existed. One grammar everywhere.

Also: unlinking a chip (its ✕) drops its override entry; reverting one chip of a
multi-overridden stack clears the shared field, the other overridden chips stay faded
(click them too to relink). Send-to-project remaps fieldOverrides ids like fieldLinks.

## Out of scope

- The freeform prompt link (before/after whole-prompt splice): different mechanism, untouched.
- @ref chips, voice slot, audio/video refs: untouched.
- Co-Director: no new verbs; it keeps writing fields as today.

## Build order (after answers + GO)

1. shared/types.ts: `CharacterLink.replaced`, `PromptData.fieldOverrides`.
2. RenderPanel.tsx: splice changes (`spliceChar`, `resolveScene`/`resolveProduction`),
   linking bundles grow push/revert, persistence load/save.
3. ClipFields.tsx: chip gestures + faded state on `LinkedField` and `FieldLink`.
4. Verify: push -> preview YAML unchanged; edit -> replaces; revert -> field empty,
   splice live; old project loads clean; stacked chips fade independently.
