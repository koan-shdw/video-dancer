# Library import + folder-from-selection — 2026-09-08

Status: BUILT (typecheck clean, not run in-app — owner test is the gate).

His brief, verbatim intent:
1. Double-clicking the Library means "import a new asset" → opens the import window.
   Double-click on an asset keeps opening its module (image → image tree). Untouched.
2. import image / import music / import video all mean the same thing → one **import**.
3. Select many objects, right-click → make a folder with them. Universal grammar:
   every folder view (Library, Bin, sheets, scores, voices, styles).

## 1 Double-click = import
- `Library.tsx`: `onDoubleClick` on the panel. Fires only when the double-click lands on
  empty space (target is the panel, the Foldered root, or a grid gap) — never on a tile,
  folder row, button or the zoom slider. Calls the same `importAny` as the button.

## 2 One import
- Main: new IPC `library:importAny` — ONE `showOpenDialog` with all supported extensions
  (images jpg/jpeg/png/webp/gif/bmp/avif · audio mp3/wav/m4a/aac/ogg/flac · video
  mp4/mov/webm/m4v/mkv/avi), routes each path by extension into the existing
  `importImages` / `importAudioFiles` / `importVideoFiles`. Returns the three results.
  The old `library:import` / `audio:import` / `video:import` handlers stay (other callers).
- Store: `importAny()` applies the three deltas, toasts counts like the siblings.
- Library button row: **import** · new image · watch folder · zoom. "import music" and
  "import video" buttons removed. Drag-and-drop untouched (already routed by extension).

## 3 New folder with selection
- `Foldered.tsx` `moveEntries`: when the selection is >1, the first move entry is
  **new folder with N** → name prompt (default "New Folder") → `addFolder` (now returns the
  new folder id) → `moveItems` selection into it. Folder is made at the current root
  (the view's scope), same as right-click-empty "new folder".
- Lives in the shared Foldered component, so every kind gets it. No per-panel code.
