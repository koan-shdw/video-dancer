# Style Sheets — Bin citizenship for Project Styles

STATUS: SPEC — awaiting approval. No code yet.
Date: 2026-08-23. Companion to the co-director work in docs/codir-notes/.

## What changes

Project Styles leave their own panel (left-hand selector + fields) and become Bin citizens,
exactly like char sheets. The panel becomes **Style Sheet**: one style's fields, no selector.
New name everywhere the user reads: **style sheet**. Data model and linking are untouched —
a style is still a `ProjectStyle`, links still resolve by id, nothing re-saves.

The sibling being copied is the char sheet, end to end:
tile in a Bin section → double-click opens the docked editor panel on that item →
create button in the section header → right-click menu (edit / rename / delete) →
folders, drag-to-folder, multi-select via the same Foldered machinery.

## Data (src/shared/types.ts)

1. `ProjectStyle` gains `folder?: string | null` — same as `CharSheet.folder`. Optional,
   old projects load unchanged, no migration step.
2. `Folder.kind` union gains `'style'`:
   `'bin' | 'lib' | 'sheet' | 'score' | 'voice' | 'style'` (types.ts:93).

## Store (src/renderer/src/store.ts)

3. New `editorStyleId: string | null` + `setEditorStyle(id)` — copy of
   `editorSheetId` / `setEditorSheet` (store.ts:200, 426, 521) including the two
   cleanup spots: project-load prune (≈542) and delta-removal prune (≈750), keyed on
   `removedStyleIds` / styles list.
4. `stylesFocusId` / `setStylesFocus` (273-274, 682-683) DELETED — `editorStyleId`
   replaces it. Its only two consumers are App.tsx:201 and the old panel.
5. `tileZoom` gains `style?: number` (fallback `?? bin`, same as sheet/score/voice).

## Bin (src/renderer/src/panels/Bin.tsx)

6. Fifth section **style sheets**, placed after char sheets, before scores. Copy the
   char sheets section verbatim (536-546), nouns swapped:
   - `zStyle` zoom + `styleSecRef` + `useSectionWheelZoom(styleSecRef, 'style')`
   - `editStyle = (id) => { setEditorStyle(id); openStyleSheetPanel() }`
   - tile: Palette icon + name; title tooltip
     "🎨 style sheet · double-click = edit · right-click = actions · link into clips via a field's ⛓ picker"
   - drag sets MIME_MOVE `{ kind: 'style', id, ids }` for folder drops
   - menu: edit / rename (textPrompt) / delete — delete confirm keeps the existing
     panel's wording: "links to it just stop resolving" + undoable note
   - header button: `+ style sheet` → `createStyle().then((id) => id && editStyle(id))`
   - `Foldered kind="style" items={project.styles}`
7. `openStyleSheetPanel` wired the same way as `openCharSheetPanel`
   (App.tsx:598 `setCharSheetOpener(() => ensurePanel('charsheet'))` — add the style twin).

## Foldered (src/renderer/src/panels/Foldered.tsx)

8. Kind union gains `'style'` (line 17); zoom selector (141) reads `tileZoom.style ?? bin`;
   the reorder guard (159/175) treats `'style'` like sheet/score/voice (no manual reorder).

## Panel (ProjectStylesPanel.tsx → StyleSheet.tsx)

9. New `StyleSheetPanel`, replacing `ProjectStylesPanel` (file renamed StyleSheet.tsx).
   Keep from the old file: the field components (Inp/Area), the field list and paths, the
   FieldMeta/enhanced tinting, the debounced autosave, the undoTick re-pull, the header
   hint line (reworded to "A style sheet is..."). Drop: the whole left column, `add`,
   selection state, `stylesFocusId` effect.
   Target = `editorStyleId` from the store (grammar of CharSheet.tsx:195-196).
   Empty state: "double-click a style sheet in the Bin — or create one there".
10. Panel registration (App.tsx:82): id **stays `'styles'`** so saved workspaces keep
    their layout; title becomes **Style Sheet**. Guard label likewise.
11. Link-chip double-click (App.tsx:201): `setStylesFocus(styleId)` →
    `setEditorStyle(styleId)`; `ensurePanel('styles')` unchanged.

## Main process

12. Folder plumbing already generic over `Folder['kind']` (addFolder project.ts:2231,
    moveToFolder:3172, send-to-project folderFor:3126). Verify moveToFolder accepts
    styles: it must resolve the item by id in `current.styles` and set `.folder`, as it
    does per-kind for sheets/scores/voices — add the `'style'` arm where kinds switch.
13. `deleteStyle` already exists and is undoable; no change.

## Words (rename sweep, user-facing only)

14. "Project Styles" → "Style Sheets" / "style sheet" in: App.tsx panel title + menus,
    ClipFields ⛓ picker copy ("styles sit pinned above the clips" wording keeps the word
    style where it means the stack source), RenderPanel comments/labels if user-visible,
    WhatsNew entry (new item announcing the move), CheatSheet/TourOverlay mentions.
15. Co-director: tool NAMES stay (`create_style`, `update_style`, `delete_style`,
    `set_field_links` semantics unchanged). Tool DESCRIPTIONS and the snapshot header
    "## Project styles" → "## Style sheets". Shipped guide `codirector.md`: "PROJECT
    STYLES are named..." paragraph reworded to "STYLE SHEETS (project styles)..." — one
    line noting they live in the Bin like char sheets. The AppData guide fork carries the
    old wording; note in the release notes that a purge/re-fork picks up the new text.
16. Internal identifiers (`styles`, `ProjectStyle`, `stylesFocusId` aside) do NOT rename —
    UI words only. No project-file format change.

## Out of scope (explicit)

- Send-to-project for styles (sheets have it, styles never did) — separate decision.
- Any change to link resolution, splice order, or the cascade.
- Voice/image/codir tool gaps — tracked in docs/codir-notes/FINDINGS.md.

## Verify

- Old project opens: styles appear in the new Bin section, unfoldered.
- Double-click opens Style Sheet on that style; edits autosave; undo re-pulls.
- ⛓ picker still lists styles pinned above clips; double-click a link chip opens the panel
  on the right style.
- New folder in the section, drag a style in, reload — placement survives.
- Delete a linked style: clip renders without it, link chip dangles as before.
- Co-director create_style/update_style still land; snapshot shows "## Style sheets".
- Saved workspace with the old Project Styles panel opens as Style Sheet (same id).
