# Workflow & Placement Report — 2026-07-18

*Companion to today's build session. Sources: a 6-subsystem parallel code audit (every renderer file read, findings verified against code with file:line anchors), the June audits in this folder, and the owner's trigger complaint: "I can't find features on my own app." The main-process subsystem was audited by hand (project.ts / index.ts read in full during the Styles build).*

---

## A. What shipped today

| # | Change | Where it lives now |
|---|---|---|
| C1 | First/last-frame **live stills** moved out of Clip Gen | **Right-click a timeline block** → "⊢ first frame → Library" / "last frame ⊣" · **Clip Monitor** toolbar (slot-edit mode) `⊢ first · last ⊣` |
| C2 | Send a take into **Clip Edit** (v2v) | Right-click a **T-chip** in Clip Gen → "edit TN with AI" · right-click a **Bin clip** → "edit keeper take with AI" |
| C3 | **Resizable previews** | Drag the bar under the preview in Clip Gen and Clip Edit — up to the full panel, size remembered |
| C4 | **Hover-scrub** thumbnails | Hover any Bin clip tile → mouse X scrubs the keeper take |
| C5 | **Window menu** | Header → `Window ▾` — every panel listed, ● = open, click reopens/raises. Closed panels are no longer dead ends |
| C6 | **Output monitor** | Timeline toolbar → 🖥 → pick a display (the app's own display is excluded). Fullscreen muted mirror; Esc on that display closes it |
| C7 | **Draw layer** (Image Editor) | `✏ draw` over the canvas: pen, 6 colors, width slider, clear. Non-destructive, per tree-node. Visible = flattened into the image the model receives; hidden = not sent |

Also: the timeline block right-click menu carries "edit with AI" and "remove", the shared context menu now clamps to the viewport, and the cheat sheet (?) documents every one of these.

---

## B. Why features kept disappearing — the five patterns

The first/last-frame burial wasn't an accident; it's one instance of five repeating placement patterns found across the verified feature inventory:

**1. Action lives in a different panel than its object.**
The still-grab operated on a *timeline instance* but lived in the *generation form* — reachable only via double-click → tab-switch → mode-check. Same pattern, still live: the Timeline Editor (rename/aspect/export settings) is only reachable by double-clicking the timeline's row *in the Bin*; the export button's tooltip even references settings you can't navigate to from there.

**2. Mode-gated UI with no signpost.**
UI that exists only in a state the user can't see labeled: the takes section doesn't render until a take exists; trim handles silently vanish on C-instances; frame-grab buttons vanish (not disable) without a take; collapsed sections hide the keeper picker with a 9px chevron as the only clue. Rule of thumb violated: *hide states should explain themselves or disable visibly.*

**3. Event-only panels.** *(killed today by C5)*
Queue opened only when money was spent, Watched only via the Library's 👁, Clip Edit only via ⑂, Image Editor only via image double-click — and Library/Bin/Timeline/Monitors had **no** recovery at all once closed.

**4. Micro-affordances doing heavy lifting.**
An 11px `⑂` glyph is the v2v entry point on blocks; "take 1/3 ▾" (9px) is the *only* path to per-instance audio mute; alt-drag file export exists solely in a tooltip. Anything that matters deserves a menu-row twin (C1/C2 added the right-click twins for stills and v2v).

**5. Inconsistent grammar between siblings.**
Clip Gen T-chip click = *make keeper*; Clip Edit T-chip click = *just view* (double-click = keeper). Two monitors put the same "details" toggle in different corners. Three context-menu implementations with different z-indexes and styling (two remain: Bin timeline tiles, Library audio rows).

---

## C. Placement principles (proposed law)

1. **Every action on an object is reachable from a right-click on that object.** Chips, blocks, tiles, tree nodes, lanes. Buttons elsewhere are shortcuts, never the only door.
2. **Every panel is reachable from the Window menu.** No event-only panels, ever.
3. **A gated control disables with a reason; it never silently vanishes.** ("no take yet — render first" beats an empty spot.)
4. **One grammar app-wide:** click = select/view · double-click = open its editor · right-click = actions · drag = move/copy. No panel redefines a verb.
5. **The cheat sheet is part of the definition of done.** A feature that isn't on the ? card doesn't exist.
6. **One shared component per pattern** (ContextMenu, dropdown, resize handle) — no fourth hand-rolled copy.

---

## D. Ranked remaining fixes (feeds the streamlining session)

1. **Timeline Editor entry from the Timeline itself** — gear/right-click on the name readout (pattern 1, worst survivor).
2. **Image Editor tree-node right-click menu** (primary/★/delete are invisible until a row is selected).
3. **Per-instance mute + take-pick into the C1 block context menu** (frees them from the 9px chip).
4. **Converge the two leftover bespoke menus** (Bin timeline tiles, Library audio) onto ui/ContextMenu.
5. **Unify T-chip click grammar** between Clip Gen and Clip Edit (mis-set keepers waiting to happen).
6. **Auto-raise aggression audit** — play fronts Timeline Monitor, select fronts Clip Monitor, enqueue fronts Queue; power users get panels yanked constantly. Consider a "calm mode" toggle.
7. **Watched-tile context menu** (import / reveal / use-as-ref — currently double-click + tooltip only).
8. **Disabled-with-reason pass** over vanishing controls (frame-grab, trim handles, export entry).
9. **Storyboard clip hint** in Clip Gen: "renders will appear here as takes" where the takes section will materialize.
10. **Keyboard nudge keys** (frame/second playhead stepping — arrows currently jump whole slots and force progress to 0).
11. **Toast visibility with the mirror active** (C6): completion toasts render only in the main window — fine while you face it, worth a mirror-side flash later.
12. **Dead code sweep**: WebGpuVideoSpike.tsx + its CSS, the dead layoutSave/layoutLoad IPC pair.

---

## E. State of knowledge

Renderer subsystems (timeline, monitors, generation, assets, chrome, core) are fully read and inventoried with line anchors; main process read in-session (project/data model, IPC, media protocol, styles CRUD, mirror windows). The stale docs to be aware of: `feature-manual-2026-06-13.md` and `full-audit-2026-06-13.md` predate v0.2.x (no Omni Flash, Clip Edit, Queue, Watch, themes, Styles, or today's work) — treat them as architecture background, not current truth.
