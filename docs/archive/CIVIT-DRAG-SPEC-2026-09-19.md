# Civitai like → Image Gen: drop it on the PNG box — 2026-09-19

Status: BUILT 2026-09-19 on his GO, both calls answered (§6). Typecheck clean · npm test 56/56 ·
the full CI browser test list · build · preload smoke test: all green locally. NOT run in his app,
no Civitai call made from here. Uncommitted.
AS BUILT vs this spec: `get + use` closes the popup and reports on Image Gen's status line
(`asking Civitai… → getting <name>… → landed → in a slot`) + the sidebar's own progress — the row
does not turn into a live % (a context menu is built once). The PNG lane keeps `search civit` for a
lora it cannot name by version id (a PNG only knows a file name). `send both` and every lora row
turn the LORA switch ON and carry the image's weight (clamped 0–2). The base gate runs twice: on
the popup row (from the generation data) and again on the downloaded row's own tag.
New: `lib/civitActions.ts` (import · Co-Director · getLoraByVersion · KREA_BASES, one copy for
the box and the Watched click), `civitai.rowForVersion`, IPC `imagegen:civitGetVersion`.

His words:
1. "drag an image that is in th ewatched list that i like in civit into the image gen png drop area
   and automatically bring up the images prompt from its vicit prompt label and its lora, which
   starts downloading if it isnt added yet"
2. "if the prompt doesnt exist in the watch list either on the PNG or the linked civit page, then
   just suggest the lora, so maybe a window comes up or something that suggests what lora it is, and
   maybe under it is an option for 'Get Codev to make this as a prompt'"
3. "this thisn that come sup it shows the lora and the prompt is there is one with opton to seed both
   and also at end the 'get dodirector to make this as a prompt'"
His screenshot: the box's dead end today — `no prompt found in that PNG — no ComfyUI or A1111
metadata · no loras in that PNG · close`.

## 0 What exists (read 2026-09-19)

- ONE shared menu, `lib/settingsMenu.tsx` `buildSettingsMenu(PngSettings, folderRows, actions, head)`:
  `→ send to prompt` · one row per LoRA (`use` when it is in his folders, else `search civit`) · the
  dim `model · seed · size — shown, not applied` line · `close`. Two callers:
  - Image Gen's `drop png here to read` box (`ImageGen.tsx:501`): accepts OS FILES only, `.png`
    only, reads the PNG's own metadata (`readPng`). Civitai strips metadata from the images it
    serves, so a saved civit image reads as the dead end in his screenshot.
  - Watched → civit tile CLICK (`Watch.tsx openMenu`): asks the site lane for the image's
    generation data — `vd().civitGeneration(id)` → main `civitai.generationData` →
    `{ source:'civit', prompt, loras:[{ name, weight, versionId }], model, seed, size }` — and
    builds the same menu, with three head rows: `→ import to Library` · `→ send to Co-Director`
    (imports into the Library's `civit` folder, seeds the Co-Director's box with `@title write an
    image gen prompt from this`, opens the panel; he presses send) · `open on civitai.com`.
- A civit tile DRAG carries `MIME_CIVIT {id, url}` (+ the cached file as MIME_WATCH / MIME_IMAGE
  once prefetched). The PNG box ignores all of those today.
- LoRA downloads: `imagegen:civitDownload(row: CivitVersionRow)` — own folder inside his LoRA
  folder, `.civit.info` + previews, sha gate, progress on `imagegen:dlProgress`, first download
  prompts for the folder. It needs a full ROW; the generation data only has a `versionId`.
  `civitai.versionRaw(versionId)` returns the version object (file, sha256, downloadUrl,
  `baseModel`, trigger words) — everything a row needs.

## 1 The drop

- The PNG box accepts a `MIME_CIVIT` drag (border lights amber like a file drag). On drop it asks
  `civitGeneration(id)` and opens the SAME popup at the box, by itself — "automatically bring up".
  The box reads `reading…` while it asks. OS `.png` drops keep today's path.
- Box hint grows to `drop png or a civit like`; tooltip says both.

## 2 The popup (one menu, both callers — the box and the Watched click)

Top to bottom:
1. `→ send both` — NEW, only when there is a prompt AND at least one usable LoRA: prompt → the
   prompt field, LoRAs → the slots (§3), one press.
2. `→ send to prompt — <first 48 chars>…` (today's row). No prompt: the dim line `no prompt shared
   for this image` (today's words) — the rest of the popup still stands, which is his "just suggest
   the lora".
3. One row per LoRA the image used, `<name> × <weight>` + its state on the right:
   - `use` (green) — it is in his folders → into a slot at the image's weight.
   - `get + use` (amber) — NOT in his folders → downloads it now (§4); the row turns into a live
     `NN%` and the LoRA drops into a slot the moment it lands. `search civit` is retired from this
     menu (the download IS the answer); the sidebar search stays where it is.
   - a LoRA Civitai tags for another base (SDXL, Flux, Pony…): amber `tagged <base> · may not
     load`. `send both` skips it; pressing the row still gets it on purpose (his folder outranks
     the tag — the ZImageTurbo lesson, 2026-09-09).
4. The dim `model · seed · size — shown, not applied` line (today's).
5. `→ import to Library` · `open on civitai.com` (today's head rows, moved under the settings).
6. LAST, his words: `get Co-Director to make this as a prompt` — today's `send to Co-Director`
   flow, renamed and moved to the end: import into the Library's `civit` folder → the Co-Director's
   box is seeded with `@title write an image gen prompt from this` → the panel opens, he presses
   send. Always present, prompt or no prompt.
7. `close`.

## 3 Slots

Image Gen has two LoRA slots (+ the fixed unleashed row).
- `use` / `get + use` on one row: first empty slot; both full → it replaces slot 2 (the newest pick
  wins) and says so in the status line.
- `send both`: the image's first two usable LoRAs, in Civitai's order, at their weights (clamped
  0–2). More than two: the rest stay as rows in the popup, and the status line says
  `2 of N loras loaded — the popup lists the rest`.
- The LORA switch turns ON when a LoRA lands from here.

## 4 Get + use

- MAIN `civitai.rowForVersion(versionId, key)`: `versionRaw` → the same row shape the sidebar's
  browser produces (`rowsOf`) → handed to the EXISTING `imagegen:civitDownload`. One download path,
  one progress channel, the same folder layout, the same sha gate. IPC `imagegen:civitGetVersion`.
- No Civitai key: the row is greyed with `paste your Civitai key in Settings to download`.
- No LoRA folder yet: the existing first-download folder prompt runs.
- The popup may close while it downloads; progress continues in the LoRA sidebar's local tab, and
  the slot fills when the file lands (the panel keeps a `pending use` for that version id).
- Failure = the status line says why (Civitai's words), nothing half-loaded.

## 5 Files

- koan-shared `lib/settingsMenu.tsx` (rows, `send both`, the last row, base tag) · `ImageGen.tsx`
  (box accepts MIME_CIVIT, pending-use on landed downloads, slot rules) · `Watch.tsx` (head rows
  move into the shared menu's tail, same actions) · `env.d.ts`.
- vi-dancer `src/main/civitai.ts` (`rowForVersion`, `baseModel` on each generation-data LoRA) ·
  `index.ts` (`imagegen:civitGetVersion`) · preload.
- Main + preload change: full restart.
- CI: run the browser test list locally before any tag (0.20.0's lesson).

## 6 His calls — ANSWERED 2026-09-19

1. MORE LORAS THAN SLOTS — "yes correct": `send both` loads the first two, the rest stay in the
   popup (§3).
2. WRONG BASE — "yeah skip loras not in supported model": a LoRA tagged for another base is
   SKIPPED everywhere — never loaded, never downloaded. Its row stays, greyed, with the reason
   (`made for <base> — Krea 2 can't load it`). This REPLACES §2.3's "still gettable on purpose".
   A LoRA already in his folders is never greyed (his folder outranks the tag).
