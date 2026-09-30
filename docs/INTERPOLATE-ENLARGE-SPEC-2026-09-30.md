# Interpolate and enlarge (list 52) — spec, answered 09-30, nothing built

His words (09-29): "in the effects i want to be able to add a new feature which will let us
interpolate clips using online and local models including topaz headless" · "may as well put
enlaring in there too, online, local and topaz" · "make sure its right lick option like premier
too". List 51's Clip Speed / Duration keeps Optical Flow greyed until this lands.

## What exists to build on

- **Online, on his fal key** (checked 09-30):
  - `fal-ai/rife/video`: RIFE frame interpolation (frames between frames, or a target fps).
  - `fal-ai/topaz/upscale/video`: Topaz on fal. Upscale ×1 to ×4 (Proteus, Artemis, Nyx, Gaia,
    Starlight) plus frame interpolation through `target_fps` (16 to 60). Also listed:
    `topaz/upscale/video/precision` and `topaz/upscale/video/generative`.
  - `fal-ai/seedvr/upscale/video`: SeedVR2 upscale, $0.001 per megapixel of output (1080p × 121
    frames = $0.25).
- **Local** (his GPU, no key): RIFE and Real-ESRGAN as portable ncnn-Vulkan programs (no Python),
  downloaded on first use through the Models card like the matte and depth models; or the RIFE
  nodes in his ComfyUI.
- **Topaz headless**: Topaz Video on his PC ships an ffmpeg with `tvai_fi` (interpolation) and
  `tvai_up` (upscale) filters; the app would run it directly when it finds the install (his
  licence, his models).
- **The pattern already in the app**: list 51's reversed copy. One file made per take, kept next
  to it, and the block plays that file instead. Effects' subject and depth data work the same way.

## Proposed design (my recommendation)

1. Right-click a block → **interpolate…** and **enlarge…**, the same as a new **enhance** section
   in the Effects panel.
2. Each opens one small dialog:
   - **interpolate:** ×2, ×4, or a target fps.
   - **enlarge:** ×2 or ×4 (or a target height).
   - **VIA row:** fal RIFE, fal Topaz, fal SeedVR2 (enlarge only), local RIFE / Real-ESRGAN,
     Topaz on this PC (greyed with the reason when it isn't installed).
   - Price shown for online rows, as the Clip Gen VIA does.
3. The result is a file made from that take and kept next to it, like the reversed copy. The block
   plays it from then on, and it's shared by every block using that take with the same settings.
4. List 51's Optical Flow turns on: a slowed block with Optical Flow plays its interpolated file.

## Questions for him

1. The result: a file the block plays, kept next to the take (my pick, the reversed-copy way), or
   a **new take** on the clip (shows in the take picker, usable anywhere)?
2. Local: the small portable RIFE / Real-ESRGAN programs the app downloads itself (my pick), or
   through his ComfyUI?
3. Topaz headless: run the Topaz Video install on this PC directly (my pick)? Which Topaz models
   first: Apollo / Chronos for interpolation, Proteus / Starlight for enlarging?
4. Order: interpolate first (it also turns on 51's Optical Flow), then enlarge?

## Answers (09-30)

He asked on 09-30 for the obvious questions to be answered for him. An answer in quotes is his own.

1. A file the block plays, kept next to the take (the reversed-copy way).
2. The small portable RIFE / Real-ESRGAN programs, downloaded through the Models card.
3. Yes, the Topaz Video install on this PC, run directly. Every model the install has is listed.
4. Interpolate first, then enlarge.
