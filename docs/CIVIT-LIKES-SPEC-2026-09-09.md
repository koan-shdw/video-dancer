# CIVIT LIKES in WATCHED — spec 2026-09-09 (for his read; no code before GO)

## 0. His brief (his words)

"with the civit AI api if i like an image can it appear in the watch window, so there s a filter in
the watch window similar to the local / civit one we have in the lora window and the civit one will
show images liked in civit with the ability to insert their prompts into image gen?" · "look into it"

## 1. Probed 2026-09-09 — his key, READ-ONLY (decrypted through Electron's own key store, never printed)

- [V] `GET /api/v1/me` → username **K0AN**, id 768706, key scope reads everything below.
- [V] The public v1 `/images` has **no "liked by me" filter**: `favorites=true`, `reactions=`,
  `liked=`, `reaction=`, `collectionId=` all returned the identical ids as the baseline (ignored).
- [V] v1 `/images` carries **no meta any more**: 0 of 30 top images for his checkpoint, and
  `hasMeta:false` for his one liked image — while the site lane below returns the full prompt for
  the same ids. v1 is useless for prompts today.
- [V] **The site's own lane accepts the API key**: `GET https://civitai.com/api/trpc/<proc>?input=
  <urlencoded {"json": …}>` with `Authorization: Bearer <key>`:
  - `image.getInfinite` `{ reactions: ['Like','Heart','Laugh','Cry'], period: 'AllTime', sort:
    'Newest', limit, useIndex: true, browsingLevel: 31, cursor? }` → **the images HE reacted to**.
    Today: 1 (id 9714067, by TijuanaSlumlord, 824×1216, `hasMeta: true`, `reactions:
    [{userId: 768706, reaction: 'Like'}]`). Paged by `nextCursor`. Naming `userId` explicitly
    returns 0 — the caller (the key) IS the filter; never pass userId.
  - `image.getGenerationData` `{ id }` → `meta { prompt, negativePrompt, steps, sampler,
    cfgScale, seed, Model }` + `resources[] { modelName, modelType 'LORA' | 'Checkpoint',
    versionName, versionId, strength }` + `tools, techniques, canRemix, external`. Proven on his
    liked image AND on 136237857 (which v1 showed without meta).
  - `collection.getAllUser { permission: 'VIEW' }` → his collections: Favorite Models, Bookmarked
    Articles, Concepts. No image collection exists yet, so `image.getInfinite { collectionId }` for
    image bookmarks is NOT proven (nothing to test on) — likes are the lane.
  - Wire format: `result.data` is a JSON **string** holding a devalue array (nodes; values are
    indices; `-1` = undefined; `["Date", ms]`…). Probe 2's 40-line hydrator reads it cleanly.
- [V] Image URL = `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/<url uuid>/width=<px>`; the
  account hash was identical on every image seen; v1 hands the same base. Thumbs come through
  main as data URLs (CSP) — the LoRA sidebar's `imagegen:thumb` lane already does this.
- **Risk, said plainly**: the trpc lane is Civitai's private site API — undocumented, can change
  without notice. Law 10 when it breaks: the civit tab says *"civitai changed its site api — the
  likes list is off until we catch up"*, never a blank, and local keeps working.
- Probe scripts: scratchpad `civit-probe.cjs` / `civit-probe2.cjs` (delete with the session).

## 2. From his seat

1. The **Watched** panel head gains the LoRA sidebar's pair: **`local | civit`** (the same two
   buttons, one lit — ImageGenSidebar's `headBtn`). **local** = today's panel, untouched (folder
   path, pick / change / stop, self-refresh, tiles, drag, double-click import). **civit** = a grid
   of the images he reacted to on Civitai, newest first, the same tile size (shares the Library
   zoom exactly as local does), `more` at the bottom (cursor paging).
2. Hover a civit tile: `<poster> · <first line of the prompt when it has one> · click = prompt menu
   · drag = Library or a slot · double-click = import` (law 13).
3. **Click** a civit tile → **the PNG reader's menu** (the app's ContextMenu, at the tile), the
   same rows as the `drop png here to read` box: `→ send to prompt — <first 48 chars>` · divider
   · one row per LoRA in its resources, `<name> × <strength>` with **use** (a file with that
   versionId or name in his folders) or **search civit** (opens the sidebar's civit tab with the
   name) · divider · the dim line `model <Model> · seed <n> · <w>×<h>` (shown, never applied).
   "send to prompt" fills the OPEN image gen's prompt (its box re-syncs — the 2026-09-09 fix).
   No prompt on that image → the row reads `no prompt shared for this image`, disabled.
4. **Drag** a civit tile into the Library = import the full-size image (main downloads first);
   onto a clip slot / an Image Gen ref box = attach it the same way a Watched file attaches.
   **Double-click** = import now (Watched's grammar). **Right-click**: `open on civitai.com` ·
   `→ send to prompt` · `import to Library`.
5. No key: the civit tab is the sidebar's empty line — `paste your Civitai key in Settings to see
   your likes` (EmptyState). Nothing liked yet: `nothing liked yet — ♥ an image on civitai and it
   lands here`. Refresh: on tab open, and every 60 s while the tab is showing (his likes change on
   the site, not here); a `↻` beside `more` for now.

## 3. Mechanics

- **main `src/main/civitai.ts`** gains the site lane: `trpcGet(proc, input, key)` + the devalue
  hydrator; `reacted(key, cursor?)` → `{ items: CivitLikedImage[], nextCursor? }` with
  `CivitLikedImage = { id, thumbUrl (width=450), fullUrl, width, height, username, hasMeta,
  hasPrompt }`; `generationData(key, id)` → **`PngSettings`** (the PNG reader's own shape:
  prompt, negative, model, seed, steps, cfg, sampler, width, height, `loras[] { name, weight,
  versionId? }`) — one contract, so the menu code is shared, not copied; `imageFile(id, fullUrl)`
  → downloads once to `userData/civit-cache/<id>.<ext>` and returns the path (Library import,
  slot drops).
- **IPC / preload / env.d.ts**: `civit:liked(cursor?)`, `civit:generation(id)`,
  `civit:imageFile(id, url)`. Thumbs ride the existing `imagegen:thumb`.
- **Renderer**: `panels/Watch.tsx` gains the toggle and a `CivitLikes` section (same file). The
  menu builder leaves `ImageGen.tsx` (`pngMenu`) for **`lib/settingsMenu.tsx`**
  `buildSettingsMenu(s: PngSettings, folderRows, actions)` — Image Gen's box and Watched call
  the same builder (law 11: one menu). Actions from Watched go through the store: `sendPromptToImageGen(prompt)`
  (writes the OPEN image gen's recipe.prompt through `saveImageGen`), `imageGenUseLora(rel)`
  and `imageGenSearchSeed(name)` (two seeds the Image Gen panel consumes, like `imageGenReadFile`).
- **Drag**: a new `MIME_CIVIT` (id + fullUrl JSON) in `lib/dragDrop.ts`; every drop handler that
  reads `MIME_WATCH` today reads `MIME_CIVIT` beside it and resolves the file through
  `civit:imageFile` first (Library drop, clip ref/start/end slots, Image Gen ref boxes — enumerate
  the `MIME_WATCH` readers at build time and touch every one).
- **`use` matching**: the folder row's Civitai versionId (from the by-hash sidecar) first, then
  the name — the PNG reader's name match stays as the fallback.
- **Settings**: nothing new; the Civitai key already lives there with its sign-in check.

## 4. Files

- edit `src/main/civitai.ts`, `src/main/index.ts` (3 handlers), `src/preload/index.ts`
- koan-shared: edit `panels/Watch.tsx`, `panels/ImageGen.tsx` (menu → shared builder, seeds),
  `store.ts`, `env.d.ts`, `lib/dragDrop.ts` + the `MIME_WATCH` readers; new `lib/settingsMenu.tsx`
- docs at the next PUSH IT: README Watched section + Image Gen section, manual §4 Watched line,
  What's New.

## 5. OPEN — his calls

1. **"send to prompt" with no image gen open**: start one (`＋ new`) and fill it, or refuse with
   the reason `open an image gen first`? Spec default: refuse with the reason.
2. **Which reactions**: likes only, or every reaction (like · heart · laugh · cry)? Spec default:
   every reaction — the site's own "my reactions" list.
3. **Private-API risk** (§1): build on it, knowing it can break? The fallback line is written.
4. Poll cadence 60 s and the `↻` — fine?

## 6. Proof (untested until his session)

- His one like (9714067) shows as the first civit tile with the poster's name; click → the menu
  shows the prompt's first line and 3 LoRA rows (CharaSilhouette × 0.8, Square Hammer × 1, Moody
  Time × 0.5) reading `search civit`; send to prompt fills the open image gen.
- Like a new image on civitai.com → it is on the tab within 60 s.
- Drag it to the Library → a full-size import; onto a Clip Gen ref slot → attached.
- Key removed → the empty line; site lane down (simulate 404) → the law-10 line, local untouched.
