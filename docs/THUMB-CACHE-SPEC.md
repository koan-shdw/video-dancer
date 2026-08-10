# THUMB CACHE — spec

2026-08-10 · status: BUILT (same day) · MAIN-PROCESS change — built with the app closed

## Problem

Tiles put the ORIGINAL file into a 72px box ([Thumbnail.tsx:74](../src/renderer/src/Thumbnail.tsx)).
`media://` streams the full file; Chromium decodes a many-megapixel PNG per tile. Image-heavy
projects (Bode) hit a decode storm; video-heavy projects never feel it.

## Fix

`media://x/<path>?t=1` = "serve a small thumb of this image". Main generates it once, caches
it on disk keyed by content, streams the tiny file forever after.

### Main (index.ts)

- Handler branch after `mediaAllowed`, before `stat`: if query `t=1` AND ext is
  png/jpg/jpeg/webp → `p = await ensureThumb(p) ?? p`. gif excluded (tiles keep animation).
  Videos/audio ignore `t`.
- `ensureThumb(p)`:
  - cache file: `<userData>/thumbs/<sha1(path|mtimeMs|size)>.png` — mtime in the key means a
    re-extracted still auto-invalidates; NOT in the project dir, so `project:cleanup` and
    duplicate/copy flows never see thumbs.
  - hit → return cached path. miss → `nativeImage.createFromPath(p)`; empty → return null
    (serve original, tiles never break). `.resize({ width: 320 })` (aspect kept, covers 2×
    DPI of the largest tile), `.toPNG()` (alpha survives), write tmp + rename (no torn files),
    in-flight `Map<path, Promise>` de-dupes concurrent tile requests (Windows EBUSY guard).
  - decode cost paid ONCE per image content, in main, off the render path.
- Boot sweep: piggyback the existing vd-* temp prune — delete `<userData>/thumbs/*` with
  mtime > 60 days (stale-key versions never accumulate unbounded).

### Renderer

- `media.ts`: new `thumbUrl(file, rev?)` → `media://x/<enc>?t=1[&r=rev]`.
- `Thumbnail.tsx`: `useThumbUrl` returns `thumbUrl(...)` — every tile, ref slot, storyboard
  face and first-frame still switches at once; the handler's ext whitelist means any video
  path through it is untouched.
- BUILD-TIME CHECK: grep `useThumbUrl` call sites; any full-size display caller (big monitor
  panes) moves to `useMediaUrl` instead. ImageEditor already uses full-size paths — untouched.

## Files

1. `src/main/index.ts` — ensureThumb + handler branch + sweep (~40 lines) — **app closed**
2. `src/renderer/src/media.ts` — thumbUrl
3. `src/renderer/src/Thumbnail.tsx` — one-line switch

## Edge cases

- Missing/corrupt image → null → original streamed, exactly today's behavior.
- Same image in many tiles → one generation (in-flight map), one cache file.
- Content re-extracted in place → new mtime → new key → fresh thumb; old file swept later.
- Thumbs are PNG: alpha-true over the tile's field background.
- First run on Bode: one-time generation burst (main process), then cold-start fast forever.

## Test plan

1. Open Bode project — tiles appear; scroll Library: smooth after first pass.
2. `<userData>/thumbs/` fills with small PNGs; re-open: no regeneration (mtimes unchanged).
3. Re-extract a first-frame still → tile updates (new key).
4. Delete an image from disk → tile falls back gracefully.
5. Video tiles + hover-scrub unchanged.
6. Watch-folder staging tiles also thumb (mediaAllowed covers them).
