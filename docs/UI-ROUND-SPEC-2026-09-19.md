# UI round — five items — 2026-09-19

Status 2026-09-19: §1 workspace dropdown BUILT · §5 tree zoom BUILT · §2 external editor BUILT +
PROVEN BY HIM end to end ("awesome works" · "it worked": list, Photoshop opens the copy, save,
return prompt, import lands) · §4 compare BUILT (typecheck clean, not seen on screen). All
uncommitted. §3 = spec, builds on its own GO.
§4 as built: `compare` is a toolbar toggle beside crop / draw (their amber-when-on grammar, text
only — no new glyph); labels ride the top-left chips (`base — …` / `result — …`), not under the
images; the live img stays the canvas box's direct child (the draw / crop overlays measure against
it) — compare pads the box's left half and hangs the view-only base there.
§2 proofs, outside the app: the real `editors.ts` finds Photoshop · Illustrator · Paint on his
machine (Photoshop first); the watch ledger walks open → no ask · PSD appears → ask · answered →
quiet · next save → ask; the bundled ffmpeg flattens Adobe's own 7 MB all-layer-types PSD (text,
shapes, photos) into a correct PNG; PDF answers in plain words. UNPROVEN: the launch itself
(Photoshop actually opening the copy), the focus-return prompt, the import landing — his walk.
Mac lane written, untested.

His brief, his words:
1. "move the workspace drop down to the middle center of the scren and make it bigger and easier
   to use,at least the same height as the other buttons more bold text."
2. "right click edit images an choose to open them in an external editpor with ability to select
   from installed editors including photoshop"
3. "ability to paste screen grabs into image library and drag images from browser into library"
4. "add a compare viee to image edit which lets you see base image next to the new one"
5. "add the same zoom function as elsewhere for image edit result tree"

Code read 2026-09-19. Renderer = `koan-shared/vidancer-ui/src`, main = `vi-dancer/src/main`.

---

## 1 Workspace dropdown → center of the top bar

TODAY (`App.tsx` header, `styles.css`): one flex row. Left: logo · New · Open · ▾ · Snapshots ·
project name. `max` carries `margin-left:auto`, so everything after it packs right: max · update ·
Window ▾ · ? · Settings · **workspace** · SPND · FAL · GEM · HF. The workspace chip is `.vd-ws`:
11 px dim text, `padding: 2px 8px` (≈19 px tall; header buttons are `.vd-hbtn` 5px 12px ≈ 23 px).
Its menu rows are 12 px (`wsMenuItem`), menu anchored right.

CHANGE (pure CSS layout, no listener):
- `.vd-header` holds three zones: `.vd-hzone.left` (`flex:1 1 0`, today's left items) · `.center`
  (`flex:0 0 auto`) · `.right` (`flex:1 1 0; justify-content:flex-end`, today's right items in
  today's order, `max` loses its auto margin). Equal side zones = the center zone sits at the true
  middle of the bar; when the window is too narrow for that, flex shifts it instead of overlapping.
- The center zone holds ONLY the workspace dropdown.
- The trigger: house `.btn` face (amber, like New / Open), padding `6px 18px`, 13 px, weight 700,
  min-width 200, text `KOAN MAIN ▾` (the word "workspace:" moves to the tooltip: `workspace:
  switch the panel layout`). Height ≥ every other header button.
- The menu: opens CENTERED under the trigger (`left:50%; transform:translateX(-50%)`), min-width
  260, rows 13 px with `8px 12px` padding (easier targets), active row keeps the ✓ + amber wash.
  Entries unchanged: Default + saved names · Reset to Default · Add / Manage….
- Header height stays 34 px.

Files: `App.tsx` (header JSX regroup + trigger/menu styles), `styles.css` (`.vd-hzone`, `.vd-ws` out).

---

## 2 Open in an external editor

TODAY: no image menu offers it. `shell:openExternal` is https-only. On his machine Windows' App
Paths registry names Photoshop 2026, Illustrator 2026 and Paint; the per-user "open with" list for
.png also holds junk (PickerHost, chrome, electron), so it is NOT the source.

CHANGE:
- MAIN `src/main/editors.ts`:
  - `listEditors()`: a known-editor table (Photoshop · Illustrator · Affinity Photo · GIMP · Krita ·
    Paint.NET · Clip Studio · Paint / mac: the same names under /Applications + Preview) checked
    against `HKLM|HKCU\…\App Paths\<exe>` (Windows) or folder existence (mac). Plus his own picks
    from settings `externalEditors: { name, exe }[]`.
  - `openInEditor(file, exe)`: spawn detached `exe file` (mac: `open -a`). `file` must sit inside
    the open project or userData (the renderer never names an arbitrary path); `exe` must be one
    `listEditors()` returned.
  - `pickEditor()`: file dialog (.exe / .app) → appended to `externalEditors`.
  - IPC `editors:list` · `editors:open` · `editors:pick`; preload + env.d.ts rows.
- RENDERER `lib/externalEditor.tsx` — ONE entry builder (the `sendEntryFor` pattern):
  `openInEntry(file)` → `{ label: 'open in ▸', sub: [...found editors, sep, 'choose another app…'] }`
  using ContextMenu's existing `sub` flyout. Last-used editor lists first (settings
  `lastExternalEditor`). No editor found → the flyout holds only `choose another app…`.
- WHERE it appears: Library image menu (`Library.tsx imageMenu`, under `edit (image tree)`) ·
  Image Gen take menu (`ImageGen.tsx`, beside `reveal file`) · Image Edit results-tree rows
  (no right-click exists there today — rows get one: `open in ▸` · `reveal file`).

### 2.1 What a save does — ANSWERED 2026-09-19: **new**, asked on return

His words: "external editor new, make it look for the new file too some time it might save as a PDF
for exmaple" · "prompt when user goes back to vdacer saying 'a new edit was made, want to import it?'"

- OPEN = a COPY. `open in ▸ <editor>` copies the image to
  `<project>/external-edits/<title> edit N.<ext>` and opens THE COPY. Nothing lands in the Library
  yet. The original never changes (Library images, takes and tree results alike — renders are
  immutable, WORKFLOW law 3).
- WATCH: main remembers the copy's mtime and watches its folder for SAME-NAME files in another
  format (`<title> edit N` + `.psd / .psb / .tif / .tiff / .pdf / .png / .jpg / .webp`) — Photoshop
  forces a PSD (or PDF / TIFF) save the moment layers exist.
- ASK ON RETURN: when the Video Dancer window regains focus and the copy changed or a sibling
  appeared, a house confirm asks, verbatim: **a new edit was made, want to import it?** (detail line:
  the file name + editor). Yes = the newest saved file lands as a NEW Library image, `editedFrom` =
  the source, same folder, title `<title> edit N`. No = nothing; the next save asks again. A later
  save of an already-imported edit asks again and, on yes, lands as the next new image (never an
  overwrite).
- FORMATS: png / jpg / webp import as they are. PSD / PSB / TIFF → the flattened picture via the
  bundled ffmpeg → PNG. PDF: PROBE at build; if the app cannot read it the prompt says so in plain
  words (`saved as PDF — the app can't read that, export a PNG`) — never a silent nothing.
- Watches live for the app session (and the list persists per project, so a save made while the
  app was closed is asked about at the next open).

---

## 3 Paste screen grabs · drag images from a browser

STATUS: BUILT 2026-09-22 (todo 10 in TODO-2026-09-22.md holds the as-built + what he has not
tested). Deviations from the text below: the clipboard is read by MAIN (`clipboard.readImage`)
so the "paste image" row works on a click, not only on a keypress; titles are `@`-safe
(`@screen_grab_2026-09-22_14-03-11`, word characters and dashes only); the browser probe was
NOT run here — his first drops from Chrome / Edge / Firefox are the probe.

TODAY (`Library.tsx` panel `onDrop`): OS files only, resolved to disk paths (`dropPath`). A
browser drag carries a pathless file, so it hits the toast "drag them from Explorer/Finder, not
from a browser". No paste handler exists.

CHANGE:
- MAIN `library:importBytes(name, bytes)`: writes into the project's images folder (unique name,
  extension sniffed from the magic bytes, png/jpg/webp/gif/bmp/avif only, 64 MB cap) then runs the
  existing `importImages` on it. `library:importUrl(url)`: https only, image content-type only,
  same cap, then the same path. Both return the usual delta.
- PASTE: a `paste` listener on the Library panel root (the panel is focusable; clicking it focuses
  it). Clipboard item `image/*` → bytes → `importBytes('screen grab <yyyy-mm-dd hh.mm.ss>.png')`.
  Ignored while focus is in an input / textarea. Pasted FILES (copied in Explorer) route through
  today's import-by-path. Right-click empty Library space gains `paste image` (grey with the
  reason `clipboard holds no image` when it doesn't — placement law).
  Lands in the folder tab that is open (`rootFolder`), else root.
- BROWSER DRAG, in order: (a) a pathless image File in `dataTransfer.files` → `importBytes`;
  (b) else the first `<img src>` in `text/html`, else `text/uri-list` → `importUrl`; a `data:`
  URL decodes locally. The old "not from a browser" toast goes; a failed fetch says why
  (`that site blocked the download — save the image first`).
- Title = the file name without its extension (browser) or `screen grab <time>`.
- PROBE at build (facts, not guesses): what Chrome, Edge and Firefox actually put in the drop on
  Windows — logged once, recorded here.

Files: `Library.tsx`, `store.ts` (importBytes / importUrl actions), `env.d.ts`, preload, `index.ts`,
`project.ts` (the byte writer).

---

## 4 Compare view in Image Edit

TODAY (`ImageEditor.tsx`): one canvas box (`previewH` tall) shows the selected tree node, or the
original. Nodes know their parent (`EditNode.parentId`). The tree's own words: "click = view + set
as base".

CHANGE:
- A `compare` switch in the canvas toolbar row (house switch, remembered per session in the store,
  off by default).
- ON: the canvas box splits into two equal halves, same height, each image `object-fit: contain`
  on the black ground. LEFT = **base**: the image the selected result was made from (its parent
  node; the original for a first-level result). RIGHT = the selected result. A 10 px dim label
  under each: `base · <parent prompt or "original">` / `result · <prompt>`.
- Original selected (it has no base) → the switch greys with the reason `pick a result to compare`.
- Mask / brush tools work on the RIGHT image only, exactly as today; the left is view-only.
- The resize handle under the canvas still sizes both.

Files: `ImageEditor.tsx`, `store.ts` (one boolean).

---

## 5 Zoom on the Image Edit results tree

TODAY: tree thumbs are fixed `56×36`; the right column is fixed 230 px.

SIBLING copied: the Image Gen LoRA sidebar zoom (`tileZoom.lora`: list-row previews, slider +
ctrl+scroll, own floor / ceiling, persisted `tileZoomLora`) — the tree is list rows too, not tiles.

CHANGE:
- Store `tileZoom.edittree` (floor 40 · ceiling 200 · default 56), persisted `tileZoomEditTree`,
  one more kind in `setTileZoom` / `TileZoomSlider` / `useCtrlWheelZoom`.
- The slider sits on the `results tree` title row, right-aligned (the Library's slider, 84 wide).
  ctrl+scroll anywhere over the tree column zooms too.
- Thumbs render `w = zoom`, `h = zoom × 36/56` (today's shape) — the original row and every node.
- The column widens with the thumbs: `width = clamp(230, zoom + 174, 420)`, so the prompt text
  beside each thumb keeps today's room.

Files: `ImageEditor.tsx`, `lib/tileZoom.tsx`, `store.ts`, `shared/types.ts`, `App.tsx` (settings load).

---

## Build order (his to change)

1 → 5 → 4 → 3 → 2. Small to large; 2 is the biggest (watcher + ask-on-return + converters). Items 1, 4, 5
are renderer-only (no restart). Items 2 and 3 touch main + preload (full restart).

---

## 6 Image Edit: MODEL · VIA + the SELECT tool — BUILT 2026-09-19 (typecheck clean, uncommitted)

AS BUILT: his call 6.6-1 = yes → MODEL lists Nano Banana · Nano Banana 2 · Nano Banana Pro · GPT
Image 2 · Seedream 5.0 Pro, all VIA fal. Seedream's ModelArk VIA shows GREYED ("ModelArk image lane
not wired yet"): their image door is not the video tasks API the app speaks and no confirmed doc
was reachable. The §6.4 probes do NOT run from a side script (his stored key stays in the app) —
his first selected renders ARE the probes: GPT's mask colour (white = change per fal's two
articles; if it edits the wrong side it is a one-line flip in `maskPngFor`) and Seedream holding the
outside. MODEL · VIA · size · quality sit on their own row above aspect (the old row had no room);
size defaults to each endpoint's own default (1K; Seedream 2K), quality to HIGH.
PROVEN outside the app (real `pasteBack.ts`, the repo's electron, a real 1000×714 picture, the
"model" inverted the WHOLE image at 1.4× size with a red outline on the box): 0 of 571,200 pixels
outside the selection differ from the original · the centre is the result · the outline does not
survive (1 full-red pixel) · 132 ms · a wrong-shape result is refused with its reason.
UNPROVEN: everything on screen and every paid call — the model row, the select overlay, the mask
upload, each new endpoint's first render.

---- the spec as written ----

His words: "can we add anythign to iimage edit with nano banana what lets us select trhe area we
want the edit to happen?" · "so if i select an area it still sees the entire image for the image gen
but only generates for that area?" · "both your picks are good, how does this effect the workflow in
image edit? add a model and via?"

### 6.0 Today (read 2026-09-19)
- Image Edit is hardwired to ONE model: `const model = NANO_BANANA` in `ImageEditor.tsx:186` and
  `src/main/falImage.ts:50`. No model picker exists. The registry (`shared/imageModels.ts`) holds
  one descriptor: the ORIGINAL Nano Banana, `fal-ai/gemini-25-flash-image/edit`, $0.039 / image,
  6 images, aspect list with `auto`, seed.
- The draw layer already flattens pen marks into the base the model receives.

### 6.1 Supplier facts (sources in the chat; checked 2026-09-19)
| model | served by | region input | price | notes |
|---|---|---|---|---|
| Nano Banana (all versions) | fal | NONE (fal's own July article) | $0.039 (ours) · NB2 $0.08 · Pro $0.15 | whole image redrawn |
| GPT Image 2 Edit | fal `openai/gpt-image-2/edit` | REAL mask: `mask_url` | ≈ $0.15–0.22 high · cheaper at `quality` low / medium | 16 input images · sizes presets or {w,h} · NO seed · mask colour convention NOT on the API page (fal's articles say white = change) → PROBE |
| Seedream 5.0 Pro | fal `bytedance/seedream/v5/pro/edit` (and ModelArk, his cheap lane) | NO mask field. It is trained to read ANNOTATIONS DRAWN ON THE INPUT ("label a region with a colored box and write an instruction for just that box") | $0.0675 ≤ 1536² · $0.135 ≤ 2048² · + $0.0045 / extra ref | 10 refs · sizes 1024–2048 · NO seed · ModelArk's native API may take structured boxes (`spatial_coordinates`, third-party claim, their doc page would not load) → PROBE |
| FLUX.1 Fill [pro] | fal `fal-ai/flux-pro/v1/fill` | REAL mask (must match the image size) | $0.05 / MP | the dedicated inpainter; not picked for v1 |

### 6.2 MODEL · VIA — Clip Gen's grammar, copied (`lib/engineOptions.ts` FAMILIES)
- The settings row gains **MODEL** then **VIA**, left of `aspect`. Same house Dropdowns.
- MODEL: Nano Banana · GPT Image 2 · Seedream 5.0 Pro.
- VIA: who serves the pick, remembered per model (localStorage, Clip Gen's rule), LOCKED when there
  is one. Nano Banana → fal. GPT Image 2 → fal. Seedream 5.0 Pro → fal · ModelArk (ModelArk lights
  only when an ark key is saved; greyed with the reason otherwise).
- `shared/imageModels.ts` grows from one descriptor to a registry: per model — endpoints per VIA,
  max images, aspect / size list, variants cap, `seed: boolean`, price fn, `region: 'mask' | 'drawn'
  | 'none'`. `falImage.ts` reads the picked descriptor (its `input` builder becomes per-model:
  GPT takes `image_size` + `quality`, Seedream `image_size`, Nano `aspect_ratio` + `seed`).
- Stable board: controls a model ignores stay visible, greyed with the reason (seed on GPT /
  Seedream: `this model has no seed`).
- Every tree node records `model` + `via` (EditNode grows two optional fields; old nodes read as
  Nano Banana · fal). The node tooltip and the details box show them.
- The price line and the spend ledger follow the pick.
- HIGHEST QUALITY DEFAULT: GPT Image 2 runs `quality: high`; a visible `quality` dropdown
  (high · medium · low) is his dial, never the app's.

### 6.3 SELECT — one tool, every model
- A **select** toggle joins the canvas toolbar (compare · select · crop · draw grammar, amber when
  on, one overlay at a time like crop / draw). Two shapes: **box** (drag) and **lasso** (freehand,
  closes on release). One selection per view; Esc or a click outside clears it; it survives
  compare.
- What the model gets, per `region`:
  - `mask` (GPT Image 2): the FULL image + a mask PNG at the image's exact pixel size, feathered
    0 px (hard edge; the model blends its own seam).
  - `drawn` (Seedream 5.0 Pro, Nano Banana): the image with the selection's outline drawn on it
    (2 px, the pen's red) + one line appended to his prompt: `Edit only inside the red outline.
    Keep everything outside it exactly as it is.` — the line is SHOWN under the prompt box while a
    selection exists (WORKFLOW law 5: what the model sees is inspectable).
- PASTE-BACK GUARANTEE (every `drawn` model): when the result lands, main scales it to the
  source's exact size, keeps ONLY the selected area from it (12 px feather) and lays it over the
  ORIGINAL pixels. The outline never survives (it sits outside the kept area's core; the feather
  band is taken from the result side only). The raw model output is kept beside the node
  (`…_raw.png`) — nothing is thrown away.
  Needs the same aspect back: `drawn` requests pin the source's aspect (Nano `auto`, Seedream
  `{width,height}`); a result whose aspect still differs skips paste-back and says so on the node.
- The result is a normal tree node (child of the view it was made from). Compare = the check.
- No selection = today's behavior, every model.

### 6.4 Probes before any of it ships (announce first — they spend)
1. GPT Image 2 mask convention: one `quality: low` call with a half-white mask (≈ $0.01).
2. Seedream 5.0 Pro on fal: one call with a drawn red box, does it hold the outside (≈ $0.07).
3. ModelArk Seedream 5.0 Pro: does the ark key serve `seedream-5-0-pro`, and does its native API
   take structured boxes (≈ $0.05). If it does, VIA ModelArk sends the box natively.

### 6.5 Files
`shared/imageModels.ts` (registry) · `lib/imageModelOptions.ts` (MODEL · VIA, engineOptions'
twin) · `ImageEditor.tsx` (row + select overlay + the shown instruction line) · `lib/selection.ts`
(box / lasso → mask PNG + outline) · `shared/types.ts` (EditNode.model / via) · main `falImage.ts`
(per-model input, mask upload) · main `arkImage.ts` (new, ModelArk lane) · main `pasteBack.ts`
(ffmpeg or sharp-free canvas composite) · `index.ts` `image:generate` args.
Main + preload change: full restart.

### 6.6 His calls
1. Add **Nano Banana 2 / Pro** to MODEL while the list is being built? They are newer than the
   one Image Edit runs today ($0.08 / $0.15 vs $0.039). yes / no.
2. Paste-back feather: 12 px (mine) — his eye decides after the first result.
