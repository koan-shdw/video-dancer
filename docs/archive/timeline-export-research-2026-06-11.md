# vi-dancer — Timeline Entity & Export: Discussion Document

*Product-architecture discussion doc. A menu of choices with recommendations — not an implementation plan. Synthesized from 4 research passes (pro-NLE sequence settings; export presets; ffmpeg/fal stitching verification; AI-editor survey). Anything unverified is marked [VERIFY].*

---

## (A) Timeline entity — proposed settings

Pro NLEs expose ~15 sequence-setting categories. For AI-generated mp4s (always square-pixel, progressive, H.264) only ~6 matter. Tiering below.

### Tier 1 — essential (ship with Timeline Editor v1)

| Setting | What it does | Recommended default |
|---|---|---|
| **Name** | Identifies timeline in Bin | "Timeline 1", auto-increment |
| **Aspect ratio** | Canvas shape; presets matching the gen models (16:9, 9:16, 1:1, 4:3, 3:4, 21:9) | **Auto** — conform to first clip dropped (FCP pattern), with toast: "Timeline set to 16:9 from clip X — change?" |
| **Resolution tier** | Output pixel size, derived from aspect (480p / 720p / 1080p — matches what Seedance/Sora emit) | 1080p |
| **Frame rate** | Timebase all clips conform to (24 / 25 / 30 / 60) | **Auto** = first clip's fps; warn (don't hard-lock) on change after clips exist. Resolve locks it outright — warning is friendlier |
| **Mismatch policy** | What happens to clips that don't match canvas: Fit (bars) / Fill (crop) / Blur-pad | **Fit** (see §B) |
| **Background fill** | What fills the bars when fitting: black / blur / color | Black (Blur is the CapCut social-video move — cheap to offer, see §F) |

Adjacent Tier 1, but lives on the **clip instance** (Clip Editor), not the timeline: **per-instance mute + gain**. Not optional — Sora 2 clips always carry audio, Seedance audio is toggleable, so the first 2-clip timeline a user builds will need "shut this clip up."

### Tier 2 — nice-to-have (later)

- **Per-instance transform** (scale/position nudge) — manual reframe inside Fit/Fill.
- **Master timeline volume** — after per-instance gain ships.
- **Letterbox bar color picker** — black covers 95%.
- **fps-conform quality** (frame blend / optical flow vs plain dup-drop) — quality upgrade, slow, artifacts on AI footage; plain `fps` filter first.
- **Output blanking** (2.39:1 cinematic mattes inside 16:9) — Resolve feature, nice for "film look."
- **Custom W×H aspect** — CapCut has it; presets cover the gen models for now.
- **AI smart-reframe** (FCP Smart Conform-style auto-crop for 9:16) — strong later differentiator, real work.
- **OTIO/EDL export to Premiere/Resolve** — the "graduate to a real NLE" escape hatch Hailuo markets; strategically smarter than growing into a full NLE.

### Tier 3 — skip (pros have them; vi-dancer never should)

| Setting | Why pros have it | Why skip |
|---|---|---|
| Pixel aspect ratio | Legacy anamorphic/DV camera formats | Every AI mp4 is square-pixel |
| Fields / interlacing | Broadcast tape heritage | All gen output is progressive |
| Preview/render codec, proxy media | 8K camera originals choke playback | Sources are small H.264 mp4s; WebGPU/WebCodecs playback already works |
| Working color space / HDR | Log/RAW camera pipelines | Sources are SDR 8-bit Rec.709; revisit only if models ship HDR |
| Audio sample rate / channel pickers | Mixed pro recorders | Normalize silently to 48kHz stereo AAC at export |
| Drop-frame timecode, VR properties | Broadcast / 360 video | Not this product |
| Style/character-consistency settings | — | Every AI cousin (LTX Elements, Flow Jump-to, Kling multi-prompt) keeps consistency at the **generation/asset** layer. Belongs in Clip Editor / the Claude prompt brain, never the timeline |

---

## (B) Mismatch policy

**The industry-standard answer is unanimous across Premiere, FCP, Resolve, CapCut:**

1. **Spatial:** scale proportionally to **Fit** with letterbox/pillarbox bars (FCP Spatial Conform default, Resolve "Scale entire image to fit" default). Offer **Fill** (crop). **Never stretch** — Resolve has it and every guide says don't.
2. **Temporal:** keep real-time duration, conform fps by **duplicating/dropping frames** (FCP "Fast (Floor)" default). Never silently retime.
3. **Override granularity:** timeline-level default + **per-clip override** on top (FCP Spatial/Rate Conform in the inspector, Resolve Input Sizing, Premiere "Set to Frame Size"). This two-level pattern is universal.

**Recommended vi-dancer behavior:**
- Timeline setting "When clips don't match": **Fit (default) / Fill / Blur-pad**. Blur-pad = scale-to-fit over a blurred fill of the same clip — the CapCut/social convention, and a differentiator pros don't have natively.
- **Per-instance override** in the existing Clip Editor: Inherit (default) / Fit / Fill / Blur.
- fps: conform every instance to timeline fps at export via dup/drop; show a small badge on instances whose native fps differs (see §C). Never upconvert as a default — YouTube explicitly says upload at recorded rate; padding 24→30 inflates files ~25% for zero quality (https://support.google.com/youtube/answer/1722171).
- No stretch option, ever.

---

## (C) Timeline Editor panel sketch

Sibling of the Clip Editor; same design language (header + grouped sections + primary action at the bottom).

```
┌─ TIMELINE EDITOR ──────────────────────────────┐
│  Name: [ Beach Cut v2          ]               │
│                                                │
│  ▾ FORMAT                                      │
│    Aspect   [16:9 ▾]   Resolution [1080p ▾]    │
│    Frame rate [Auto (24) ▾]                    │
│    Mismatch  (•) Fit  ( ) Fill  ( ) Blur       │
│    Background [Black ▾]            (Fit only)  │
│                                                │
│  ▾ CLIPS  (6 instances · 0:48 total)           │
│    1 ▣ beach_wide      4.0s  [♪] [30→24]       │
│    2 ▣ dancer_close    6.2s  [muted] [9:16]    │
│    3 ▣ sora_intro      8.0s  [♪]               │
│    …  (click row → opens that instance in      │
│        Clip Editor; drag to reorder)           │
│                                                │
│  ▾ AUDIO                                       │
│    Master volume ────────●──   (Tier 2)        │
│                                                │
│  Duration 0:48 · est. export ~48 MB @ 8 Mbps   │
│  [ ▶ Preview ]   [ Draft Export ]  [ EXPORT ]  │
└────────────────────────────────────────────────┘
```

Notes:
- **FORMAT group** = the Tier 1 settings. Collapsible, mirroring Clip Editor's setup section.
- **CLIPS list** = the timeline's instances in order, with thumbnails and tiny badges: `[♪]` has audio / `[muted]`, `[30→24]` fps differs from timeline, `[9:16]` aspect differs (will be fitted/filled). Surface "this clip has no audio" from a probe — users must see why one clip is silent.
- **Preview never stitches.** vi-dancer already plays via WebCodecs — do gapless sequential playback across instances in the existing player (pre-open the next decoder at boundaries). Preview is instant; ffmpeg is export-only.
- **Draft Export** = one-click, 720p, low bitrate, last-used destination (Premiere Quick Export pattern). AI-iteration users export constantly to check results.
- **EXPORT** opens the preset sheet (§E).

---

## (D) Bin representation

Precedent is strong: in Resolve, every timeline/compound clip **is** a Media Pool item with its own icon and right-click "Open in Timeline"; Premiere sequences sit in the Project panel with a distinct sequence icon; FCP compound clips get a dedicated browser badge. The Timeline-in-Bin concept is validated — just make timelines visually unmistakable.

- **Badge/marker:** distinct timeline icon (stacked-clips / filmstrip glyph) on the Bin card, plus aspect + duration + clip count in the card metadata (e.g. `16:9 · 0:48 · 6 clips`). A colored corner badge keeps it scannable next to clips.
- **Open behavior:** double-click → Timeline Editor panel (Resolve's "Open in Timeline").
- **Drag clip → timeline:** yes, core interaction.
- **Drag timeline → timeline (nesting): DEFER.** Explicitly block with a toast ("Timelines can't be placed inside timelines yet"). Even Resolve users find compound/nested semantics confusing enough that a long-running BMD forum thread asks for an overhaul (https://forum.blackmagicdesign.com/viewtopic.php?f=33&t=115706); no AI-editor cousin supports it; export semantics (nested trims, cache invalidation) multiply. Offer **Duplicate Timeline** instead — that covers most of the actual user need (variants/versions). Revisit only on user demand.
- **Drag timeline → bin folder, rename, delete:** same as clips, no special casing.

---

## (E) Export design

### Export sheet (preset-first — the Premiere/CapCut/Descript convergence)

```
Preset  [ Match timeline (best quality) ▾ ]
   · Match timeline — timeline res/fps, CRF-quality
   · YouTube 1080p   — 16:9, 8 Mbps (12 @ 60fps)
   · TikTok / Reels / Shorts — 1080×1920, 30fps, 10 Mbps
   · X / Twitter 1080p — warns >140s / >512MB

Filename  [ {timeline}_{date}        ]
Save to   [ C:\…\exports        📁 ]
Range     (•) Entire timeline  ( ) In–Out

▸ Advanced (collapsed)
   Resolution override · fps Auto/24/30 ·
   Quality Draft ~4Mbps / Standard / High (1.5×) ·
   Codec: H.264 + AAC (fixed in v1; HEVC toggle later)

Est. file size: ~48 MB        [ Export ]
```

- **Codec:** H.264 High + AAC-LC 48kHz in MP4 with `+faststart` — the universal upload spec for YouTube/TikTok/IG/X. No ProRes (sources are already-compressed AI mp4s), HEVC later as advanced toggle only.
- **Platform limits as warnings, not blocks** (Shorts ≤180s, X ≤140s free tier; Reels length [VERIFY at ship — Meta changes it]).
- **Draft vs final:** Draft = 720p/~4Mbps/fastest preset, one click, skips the sheet. Final = the sheet. Remember last-used preset.
- **No watermark, ever** — BYO-key local-first tools don't watermark; watermarks are the hosted rivals' upsell lever.

### Stitch architecture — the decision

**Verdict: the earlier audit call (fal-ai/ffmpeg-api for v1) does not survive verification. Reverse it. Bundle ffmpeg.**

Three independent research passes converged on the same disqualifiers for fal:

1. **No trims.** `merge-videos` takes only `video_urls` + `target_fps` + `resolution` (https://fal.ai/models/fal-ai/ffmpeg-api/merge-videos/api); `compose` keyframes are `{timestamp, duration, url}` with **no source in-point** (verified against the OpenAPI schema). In/out trims are already in vi-dancer's timeline model — fal-only export is dead on arrival, or forces local pre-trim + re-upload (double generation loss + upload latency).
2. **2048px width cap** blocks 21:9 1080p output (~2560 wide) — an aspect Seedance 2 natively offers.
3. **Undocumented audio semantics** with mixed Sora-has-audio / Seedance-silent inputs — the classic concat failure mode.
4. **Footguns & friction:** `target_fps` defaults to the *lowest* input fps (silently downconverts mixed timelines); fal result URLs persist only ~7 days by default (https://fal.ai/docs/documentation/model-apis/media-expiration), so older bin clips need re-upload; and it puts a network dependency in the middle of a local-first app.

The cost fal was avoiding turned out small and verified: **win64 ffmpeg ≈ 83MB on disk / ~28–32MB compressed in the installer** (ffmpeg-static b6.1.1 verified at 82.8MB / 29.6MB gz; gyan.dev essentials ~27–32MB 7z). The audit's 50–100MB estimate was right for the sane per-platform case.

**v1 recommendation: bundled per-platform ffmpeg, spawned as a child process from Electron main** (binaries in extraResources/asarUnpack; parse `-progress` for the export bar).

- **Pipeline (single re-encode, frame-accurate):** per instance `-ss IN -to OUT -i clip.mp4` (input-seek + re-encode = frame-accurate per ffmpeg docs); video chain `fps=TL_FPS, scale=W:H:force_original_aspect_ratio=decrease, pad=…` (or `increase`+`crop` for Fill, boxblur background for Blur), `setsar=1, format=yuv420p, setpts=PTS-STARTPTS`; audio `aresample=48000` + stereo, substituting `anullsrc` silence for clips with no audio stream (probe first); then `concat=n=N:v=1:a=1` → libx264 CRF 18 (try NVENC/QSV/AMF first) + AAC + faststart.
- **Speed path:** cache normalized per-instance intermediates keyed by `hash(sourceHash, in, out, fps, W×H, fitMode, bg, audioPolicy)`; final assembly via **concat demuxer + `-c copy`** (legal because we control codec/timebase). Reorders re-export near-instantly; a trim edit re-renders one segment. [VERIFY: audible AAC ticks at copy-joins — if so, hybrid video-copy + fresh audio pass.]
- **Licensing:** invoking ffmpeg.exe as a separate process keeps the app proprietary (mere aggregation), but distributing the GPL binary still requires FFmpeg attribution + license text + a source link in About (https://www.ffmpeg.org/legal.html). Strict-LGPL alternative if ever needed: BtbN lgpl build + hardware H.264 encoders instead of libx264.
- **ffmpeg.wasm: rejected** — 2GB memory cap, 8–20× slower, no GPU.

**Credible alternative worth a 1-day spike, not the v1 bet:** **Mediabunny** (https://mediabunny.dev, MPL-2.0, pure-TS WebCodecs mp4 read/write with trim/resize/fps-resample conversion API). Zero binary weight, fully local, reuses vi-dancer's existing WebCodecs stack. Downsides: you hand-roll the multi-clip compositing loop and the silent-vs-audio concat handling that ffmpeg gives for free, and throughput on low-end GPUs is unbenchmarked [VERIFY]. If installer size ever becomes a hard constraint, this is the escape hatch.

**Migration path:** put exports behind an `ExportEngine` interface (input: timeline JSON + preset → output: mp4 + progress events). ffmpeg implements it in v1; Mediabunny or a "quick cloud stitch" via fal merge-videos (trim-free, ≤2048-wide, explicit fps+resolution always passed) can slot in later without touching the UI. Don't build the fal path for v1 at all — one engine, fewer test matrices.

---

## (F) Open questions for the owner

1. **Bundle ffmpeg in the installer (~30MB) or download-on-first-run?** Download keeps the installer slim and avoids distributing the GPL binary yourself, but adds a first-export failure mode and breaks offline-first-run. **Grug: bundle it. 30MB is nothing in 2026; do the attribution.**
2. **GPL build vs strict-LGPL build?** **Grug: ship the standard GPL build as a child process with attribution + source link in About; revisit LGPL+NVENC only if a lawyer ever cares.**
3. **fps after clips exist: hard lock (Resolve) or warn + re-conform?** **Grug: warn + re-conform. Locks feel broken in a tool aimed at iteration.**
4. **Auto-conform timeline format from first clip, or force explicit setup?** **Grug: Auto with the one-time toast. It's the FCP default and the dominant UX pattern; explicit setup is friction for zero gain.**
5. **Blur-pad in v1 or v1.1?** It's one ffmpeg filter variant and the thing social-video users actually want. **Grug: v1.**
6. **Per-instance audio: mute only, or mute + gain slider?** **Grug: both now (one slider is cheap); master volume later. Sora-audio vs Seedance-silent collisions happen on the user's first mixed timeline.**
7. **Keep any fal stitch path at all in v1?** Its pricing currently renders as "$0/compute-second" [VERIFY — may be a logged-out placeholder] and fresh clips need zero upload. **Grug: skip for v1. One export engine. Resurrect behind the ExportEngine interface only if a "stitch in the cloud from a weak laptop" use case shows up.**
8. **Pre-ship probe (action item, not opinion):** ffprobe real Seedance 2 and Sora 2 mp4s from your own bin — native fps (likely 24 vs 30), codec params, audio layout are all undocumented [VERIFY] and they set the Auto-fps default. Also check whether Sora 2 via fal API outputs carry the consumer-app watermark [VERIFY].
9. **Timeline nesting: blocked with a toast, or hidden entirely?** **Grug: blocked with a toast — the toast teaches the model ("timelines are exportable things, not clips") and gives you a signal if users keep trying.**
10. **OTIO/EDL "open in Premiere/Resolve" export — on the roadmap or not?** Strategic positioning: Runway abandoned its NLE; the gap is a real local timeline + clean export, not becoming Premiere. **Grug: roadmap yes (Tier 2), build nothing now.**