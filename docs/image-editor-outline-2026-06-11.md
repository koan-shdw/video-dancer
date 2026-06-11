# Nano Banana Image Editor — Review Outline (2026-06-11)

Spec for review BEFORE build. Research: fal model pages + Google docs fetched directly this session
([DOCS] = verified today, [PRIOR] = verified in the June 9 research pass, [VERIFY] = confirm during build).

---

## 1. Overview & user flow

A new **Image Editor** panel (dockview tab, sibling of the Clip Editor / Timeline Editor). Double-click
any Library image → the editor opens with that image on a canvas. You type what to change, optionally
add other Library images as references, optionally draw on the image to show where things go, hit
**Generate** → fal runs Nano Banana → the result lands in the Library as a NEW `@image` (original
untouched) and shows in the editor for compare/iterate.

Happy path:
1. Double-click `@image3` in the Library → Image Editor opens, image on canvas.
2. Type: "replace the sky with a stormy sunset".
3. (Optional) drag `@image7` into the refs strip: "use this sky".
4. (Optional) draw a red circle top-left + the prompt mentions "where the red circle is".
5. Generate (~$0.04, est shown) → result appears side-by-side with the original.
6. Keep → saved as `@image8` (lineage: edited-from `@image3`) → usable everywhere (clip refs, start/end frames).
7. Iterate → the result becomes the new base, go again. Or discard.

## 2. fal API facts

**Edit endpoint** — `fal-ai/gemini-25-flash-image/edit` [DOCS]
- `prompt` (required) + `image_urls[]` (required — the base image AND every reference go in this one array; no documented max, but quality drops past ~3 images — practical cap 6)
- `aspect_ratio`: auto | 21:9 | 16:9 | 3:2 | 4:3 | 5:4 | 1:1 | 4:5 | 3:4 | 2:3 | 9:16 (default auto)
- `num_images` (default 1), `seed`, `output_format` png/jpeg/webp (default png), `sync_mode`
- Output: `images[]` (url, width, height, …) + a text `description`
- **NO mask parameter. No native inpainting.** [DOCS]
- Price: **$0.039/image flat** [PRIOR]

**Text-to-image** — `fal-ai/gemini-25-flash-image` [PRIOR] — same family, for generate-from-scratch (Phase 1 freebie: same panel with no base image).

**True masked inpaint (companion model)** — `fal-ai/flux-pro/v1/fill` [DOCS]
- `image_url` + `mask_url` (white = edit, black = keep) + `prompt`
- Price: **$0.05/megapixel** (≈$0.05 at 1024², ≈$0.10 at 1080p). Cheaper option: flux-dev inpaint at $0.035/MP. [VERIFY exact slugs/schemas at build]

**Nano Banana Pro** (Gemini 3 Pro Image) — higher fidelity + text rendering, ~$0.15/img [PRIOR]. Slot into the registry later as a second engine; not in v1.

## 3. Image-engine capability registry (`shared/imageModels.ts`)

Mirrors the video `models.ts` — the editor renders capability-aware fields:

| field | nano-banana | flux-fill (inpaint) |
|---|---|---|
| label | Nano Banana | Flux Fill (mask) |
| modes | edit, generate | inpaint |
| maxImages | 6 (base+refs) | 1 (+ mask) |
| mask | **no** | **required** |
| aspects | auto, 21:9 … 9:16 | n/a (output = input size) |
| seed | yes | yes [VERIFY] |
| price | $0.039 flat | $0.05/MP |

Mask mode in the UI = automatic engine switch: paint a mask → the job routes to flux-fill; no mask → nano-banana. One mental model ("edit this image"), two engines under the hood.

## 4. The editor panel

```
┌─ IMAGE EDITOR — @image3 ───────────────────────────────┐
│ ┌─────┐ ┌────────────────────────────────┐ ┌─────────┐ │
│ │TOOLS│ │                                │ │ RESULT  │ │
│ │ 🖐 │ │         CANVAS                  │ │ (after  │ │
│ │ ✏️ │ │   base image + draw layer       │ │  gen:   │ │
│ │ ▒▒ │ │   + mask layer (red overlay)    │ │ compare │ │
│ │ ◌  │ │   zoom/pan · checkerboard bg    │ │ A | B)  │ │
│ │ ↶↷ │ │                                │ │         │ │
│ └─────┘ └────────────────────────────────┘ └─────────┘ │
│ refs: [＋add] [@image7 ×] [@image9 ×]   (≤5, drag from  │
│        Library or type @ in prompt)                     │
│ prompt: [____________________________________] @-aware  │
│ aspect [auto ▾]  seed [—]  mode: ✎edit ▒mask ✏guide     │
│ [✕ discard]      est ~$0.04        [⚡ GENERATE]        │
│ result bar: [↻ iterate on result] [💾 keep → @image8]   │
└─────────────────────────────────────────────────────────┘
```

**Tool rail:** pan/zoom (default) · brush · eraser · brush size (1–200, `[`/`]` keys) · clear layer · undo/redo (per-layer stroke stack).

**Three edit modes** (radio, drives what's drawn + which engine runs):
- **✎ Edit (default):** no drawing. Prompt + refs → nano-banana edit. The 90% case.
- **▒ Mask:** brush paints a translucent red mask overlay. Generate → mask exported as B/W PNG → **flux-fill** (true inpaint: only the painted region changes). Invert-mask button. Feather slider (2px default) [v2].
- **✏ Guide:** brush draws actual colored marks ON a copy of the image (color picker: red/green/blue/yellow). Generate → the *composited* image (base + your marks) is sent to nano-banana with the marks auto-described in a prompt prefix: *"The image contains colored annotation marks. Treat them as placement instructions, do not render them: …user prompt…"*. This is the honest mechanics — Nano Banana has no sketch-conditioning input (no ControlNet), but it reads annotations well; it's the documented community pattern for "put it HERE". Results are good but not pixel-exact — that's the model's nature, and why Mask mode exists for precision.

**Refs strip:** Library images as chips (reuse Thumbnail), drag-from-Library or `@mention` in the prompt (same MentionArea machinery as the Clip Editor). Cap 5 + base = 6 sent. Warning past 3: "identity fidelity drops with many refs".

**Result area:** after generate — side-by-side or A/B slider, **Keep** (→ new `@imageN`, editor stays open on it), **Iterate** (result becomes the canvas base, lineage chains), **Discard**. `num_images 2` variant option [v2].

**Generate-from-scratch:** open the editor with no image (Library button "✨ new image") → same panel, text-to-image endpoint. Free side effect of the same plumbing.

## 5. Canvas tech decision

**Raw HTML5 Canvas 2D, three stacked canvases (base / guide / mask) + `perfect-freehand` (~3KB) for stroke smoothing. No konva/fabric.**
- Our needs are narrow: display an image, paint strokes on two overlay layers, export PNGs. Konva/fabric add 150KB+ and an object model we don't need; the codebase style is lean.
- Base image loads via existing `media://` URL — `crossOrigin='anonymous'` keeps the canvas untainted (the protocol already sends CORS headers + is project-scoped; the filmstrip extractor already proves this path).
- Mask export: offscreen canvas at the source resolution, strokes drawn white on black → PNG. Guide export: base redrawn + guide layer composited → PNG.
- Zoom/pan: CSS transform on a wrapper; strokes stored in image-space coordinates so zoom never distorts them. devicePixelRatio handled at draw time.
- Undo/redo: array of strokes per layer, replay on undo (images are ≤ a few MP — replay is instant). Stroke = {layer, color, size, points[], erase?}.

## 6. Main-process + state integration

- **`src/main/falImage.ts`** — `runImageEdit(opts)`: uploads base/refs/mask/guide PNGs to fal.storage (reuse `uploadLocal`), routes by the image-engine descriptor, downloads the result, saves into `<project>/images/<uuid>.png`, creates the ProjImage (`nextImageTitle()` gap-scan), returns `{delta: {images:[img]}, imageId}`. Credentials cleared in finally; errors log field names only — same hygiene as video.
- **IPC:** `image:edit` (+ progress events reusing the `render:progress` channel or a sibling `image:progress`).
- **ProjImage lineage (schema v4):** optional `editedFrom?: string` (source image id) + `genPrompt?: string`. Migration = stamp only (fields optional). Shown in the Library context menu ("edited from @image3") and lets a future "history" view chain versions.
- **Panel opening:** `panelBus` opener (same pattern as Timeline Editor): Library double-click → `openImageEditor(imageId)`; panel id `imageeditor`, tabs next to the Clip Editor. Library single-click stays selection; double-click currently does nothing on images → free gesture.
- **Store:** `editingImageId` + `editImage(opts)` action applying the returned delta. Cost estimate from the descriptor (flat vs $/MP computed from the base image dimensions).
- Temp files (mask/guide PNGs) written under `<project>/images/.tmp/` and deleted after upload [or kept while panel open for retry — builder's choice].

## 7. Non-destructive guarantees

- The source image file is NEVER modified. Every kept result = a new Library image + file.
- Discarded results: the downloaded file is deleted (or never saved — save only on Keep; result previews from the fal URL until kept [VERIFY sync_mode data-URI vs hosted URL behavior]).
- Drawings/masks are editor-session state, not persisted into the project (v1). Persisting reusable masks = later if wanted.

## 8. Phase plan

**Phase 1 — prompt + refs editor (the value core):**
panel + opener + canvas (view/zoom only) + prompt + refs strip + aspect/seed + nano-banana edit call +
result compare + Keep/Iterate/Discard + lineage fields + cost estimate + generate-from-scratch.
*No drawing tools yet.* Accept: double-click image → edit with prompt+refs → result in Library, original intact.

**Phase 2 — mask mode:** brush/eraser/undo machinery + mask layer + flux-fill routing + invert.
Accept: paint region → only that region changes.

**Phase 3 — guide mode:** color marks + composite-and-describe prompt prefix (reuses Phase 2's brush).
Accept: circle an area, say "dog goes here" → dog appears thereabouts.

**Phase 4 (optional later):** Nano Banana Pro engine entry · multi-variant (num_images 2-4 grid) · mask feather · persisted masks · image history view.

## 9. Open decisions (grug's recommendation marked ★)

1. **Mask approach:** ★ flux-fill companion model (true inpaint, +$0.05-0.10/edit) vs prompt-only faking on nano-banana (free but imprecise). Both behind one UI.
2. **Canvas stack:** ★ raw Canvas2D + perfect-freehand vs react-konva. (Konva only if we expect movable/selectable shape objects later.)
3. **Keep default:** ★ result → NEW image always (never overwrite). Overwrite-in-place not even offered.
4. **Nano Banana Pro:** ★ defer to Phase 4 — same registry slot, zero rework, 4× the price.
5. **Where results land:** ★ Library root (not a folder) with `editedFrom` lineage; auto-folder "edits" possible later.
6. **Phase 1 scope:** ★ ship without drawing tools first (fastest value), or hold release until Phase 2/3 land together.

---
Sources: [fal gemini-25-flash-image/edit API](https://fal.ai/models/fal-ai/gemini-25-flash-image/edit/api) · [fal flux-pro/v1/fill](https://fal.ai/models/fal-ai/flux-pro/v1/fill) · [Google: Gemini 2.5 Flash Image](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/) · [Gemini API image generation docs](https://ai.google.dev/gemini-api/docs/image-generation) · prior verified research 2026-06-09 (pricing parity, Pro model).

---

# AMENDMENTS (owner review, 2026-06-11)

**Ruling 1 — NO masking, Nano Banana only.** Flux Fill dropped entirely. Modes: ✎ Edit + ✏ Guide. One engine, one flat price ($0.039/gen). No engine routing. Registry keeps a single nano-banana entry (+Pro slot later).

**Ruling 2 — results loop with TREE-structured results management.** Replaces the simple Keep/Iterate/Discard:

- Every Generate runs from a SELECTED NODE and produces 1–4 outputs (variant count selector is now core, not P4).
- Results appear as CHILD NODES of the node they were generated from → the session forms a TREE rooted at the source image.
- NOTHING goes to the Library automatically. The user picks: ★ tag a node → saved to Library as new @imageN (lineage editedFrom + genPrompt); or select any node → it becomes the canvas base to continue editing from; or 🗑 delete a branch.
- The user can ALWAYS navigate back to any earlier node/branch and fork from there.
- PERSISTED: the tree survives closing the editor/app. New entity: EditSession {id, rootImageId, nodes[{id, parentId|null, file, prompt, seed, refIds, createdAt, keptImageId?}]} stored in project.json (schema v4, with the node PNGs under <project>/images/edits/). Reopening the editor on an image restores its tree. Untagged node files stay on disk until their branch is deleted (manual prune).
- UI: tree strip in the editor (thumbnail nodes, parent→child layout, ★ badge on tagged, highlight on the active node).

**Phases (amended):**
- P1: editor panel + ✎ Edit (prompt+refs) + multi-output + persisted results TREE + tag-to-Library + lineage. (No drawing tools.)
- P2: ✏ Guide mode (brush/eraser/undo + composite-and-describe).
- P3: Nano Banana Pro entry, mask-free extras (feather etc. dropped with masking).
