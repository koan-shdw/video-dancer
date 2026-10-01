# ENHANCE (list 52): interpolate and upscale

Date: 2026-10-01. Mapped with him that day. This replaces
`INTERPOLATE-ENLARGE-SPEC-2026-09-30.md` (its small-dialog design and its "file the block plays"
answer are gone; its engine research stays true and is carried below).

## His words

09-29: "in the effects i want to be able to add a new feature which will let us interpolate clips
using online and local models including topaz headless" · "may as well put enlaring in there too,
online, local and topaz" · "make sure its right lick option like premier too".

10-01: "the interpolation and enlarging are two different processes really and they need to be
mapped out properly" · "It also allows for slowmotion and slowmo ramping." · "we make a new window
called ENHANCE it has two sections in it withthier own pills and design model choices and settings
Interpolate and Enlarge" · "word upscale tgats ht ewor di was lookign for" · "A take appears in its
monitor same layout as clip gen, etc. With a slide bar which lets you see before and after as well
as a replay speed setting so you can see the before and after of its playback with interpolacing."
· "Once a clip is enhanves a copy of it appears in its clip gen window with an outline around it to
indicate that its an enhances version. blue for interpolated, green for enhances and purple for
both, If the clip that was being enhances is from the library then it appears in the libaray next
to the original, if it was a take tat was also dragged into the library same goes." · "the setting
sin the window let us have all the options for topaz locally before we open the headless and
enhave giving us ful ability to do it withotu opening the app, also also for the other models
online, local etc those setting will change depending on the mode / service."

## The two processes

| | INTERPOLATE | UPSCALE |
|---|---|---|
| Makes | new frames between the frames | more pixels in every frame |
| Changes | how many frames a second, or how long the copy runs | the picture's size |
| Used for | smooth motion, slow motion, the frames a slowed block or a ramp needs | a small take made 1080p or 4K |
| Outline on the copy | blue | green |

Both on one copy: purple.

## The window

A new card named ENHANCE, laid out like Clip Gen: the monitor with the take in it, then the
settings.

**The monitor**
- The take plays in it.
- A slide bar across the picture: before on its left, after on its right, both playing together.
- A replay speed (100, 50, 25, 12.5 %). Slowed down, the before side repeats frames and the after
  side does not, so the made frames show.
- A zoom (fit, 100 %, 200 %). My add, he agreed 10-01: at monitor size a 720p and a 4K look alike.

**The two sections**, INTERPOLATE and UPSCALE. Each has:
- its own on / off,
- its own engine pills,
- its own model choice,
- its own settings, redrawn for the engine picked.

**What goes in.** A take of a clip, or a Library video. Reached by right-click ("enhance…") on a
take in Clip Gen, on a timeline block and on a Library video, and from the panel menu.

**Running it.** The button queues the job. Online engines show their price first.

**Preview.** My add, he agreed 10-01: the engines on his PC can run a few seconds at the playhead
first, free. Online engines cost money, so there the slide bar compares after the run.

## What comes out

- A copy. The original is never changed.
- From a clip's take: a new take on that clip, shown in Clip Gen with the outline.
- From a Library video: a new Library video next to the original, with the outline.
- From a take that is also in the Library: the copy shows in both.
- Both sections on in one run: interpolate first, then upscale, one purple copy. Topaz on his PC
  does both in one pass.
- A copy can be enhanced again: a blue copy upscaled becomes purple, a green one interpolated
  becomes purple.

## INTERPOLATE

- **Frames:** ×2, ×4, ×8, or a target frame rate.
- **Slow motion:** off, ×2, ×4, ×8. On = the copy runs longer instead of smoother.
- **On the timeline:** an interpolated copy holds more frames, so a slowed block (51) plays a real
  frame for every step.
- **51's Optical Flow turns on.** Picked on a slowed block, it sends the block's take to
  INTERPOLATE at the multiple its speed needs, and the block plays the copy.
- **Ramps** are list 56 (drawn on the timeline, Premiere's place). This gives them their frames.

Engines (09-30 research):
- RIFE on his PC: the small portable program, downloaded through the Models card at his click.
- RIFE on fal: `fal-ai/rife/video`.
- Topaz on fal: `fal-ai/topaz/upscale/video` (its `target_fps`, 16 to 60).
- Topaz Video on his PC: its own `tvai_fi` filter.

## UPSCALE

- **Size:** ×2, ×4, or a target height (1080, 2160).

Engines (09-30 research):
- Real-ESRGAN on his PC: the small portable program, downloaded through the Models card at his
  click.
- SeedVR2 on fal: `fal-ai/seedvr/upscale/video`, $0.001 per megapixel of output.
- Topaz on fal: `fal-ai/topaz/upscale/video` (×1 to ×4; Proteus, Artemis, Nyx, Gaia, Starlight).
- Topaz Video on his PC: its own `tvai_up` filter.

## Topaz Video on his PC

Run directly, never opened. The window shows every option its command line takes: each model the
install has, and that model's own settings.

## Open until build day

- Whether Topaz's command line takes every option its app shows. Read from his install and their
  docs that day.
- Every engine's request is re-read from its supplier's docs that day.
- Topaz has to be signed in on his PC once. That is his.

## Proven on his PC 10-01 (free, local, nothing downloaded)

- Topaz Video 1.7.0 is installed (`C:\Program Files\Topaz Labs LLC\Topaz Video`). Its own ffmpeg
  carries `tvai_up` and `tvai_fi`, and both ran headless on his license on a test pattern with
  downloads switched off: a 0.5 s pattern came back at 48 fps from `apo-8`, a 352x256 one at
  704x512 from `prob-4`. Without `TVAI_MODEL_DATA_DIR` and `TVAI_MODEL_DIR` (both = its models
  folder, `C:\ProgramData\Topaz Labs LLC\Topaz Video\models`) it fails.
- Its models folder holds one JSON per model: short name, name, kind (1 = enhance / upscale,
  2 = frame interpolation), version, and each model's own sliders with their ranges. The window
  reads that list, so every model his install has is offered, newest version of each.
- Topaz's community says the command line was taken from personal subscriptions in Topaz Video
  1.1.0 and kept for some licenses. His works (it ran). Its stderr prints his license token: the
  app never logs or shows those lines.
- Its ffmpeg has no software H.264 decoder, so the app decodes and encodes with its own ffmpeg and
  hands Topaz raw frames through a pipe.

## Read 10-01

- fal RIFE (`fal-ai/rife/video`): `num_frames` 1 to 4 between frames, `use_calculated_fps`, `fps`,
  `use_scene_detection`, `loop`; $0.0013 per compute second.
- Topaz on fal (`fal-ai/topaz/upscale/video`): `model` (19 names), `upscale_factor` 1 to 4,
  `target_fps` 16 to 60, `compression`, `noise`, `halo`, `grain`, `recover_detail`, `H264_output`;
  $0.01 a second up to 720p, $0.02 to 1080p, $0.08 above; twice for 60 fps; Gaia 2 half.
- SeedVR2 (`fal-ai/seedvr/upscale/video`): `upscale_mode` factor or target, `upscale_factor` 1 to
  10, `target_resolution` 720p to 2160p, `noise_scale`, `seed`, `output_quality`; $0.001 per
  megapixel of video.
- RIFE on this PC: `rife-ncnn-vulkan` (nihui, release 20221029, windows zip 431,540,241 bytes,
  models up to rife-v4.6): `-i` frames folder, `-o` folder, `-n` frame count, `-m` model, `-x`
  `-z` `-u`, `-g`.
- Real-ESRGAN on this PC: `realesrgan-ncnn-vulkan` (xinntao, v0.2.5.0, windows zip 45,474,481
  bytes): `-n` realesr-animevideov3 | realesrgan-x4plus | realesrgan-x4plus-anime |
  realesrnet-x4plus, `-s` 2/3/4 (the video model), `-t` tile, `-x` tta.

## How it sits in the code

- `shared/enhance.ts`: the eight engines (four per section), their settings as data, prices,
  the outline colour, the multiple a slowed block needs.
- `src/main/enhance.ts`: runs a job. Interpolate first, then upscale. Topaz on fal or on his PC
  with both sections picked runs once. Lands the copy: a new take on the source clip with
  `Take.enhanced`, a Library video next to the source video (and next to a Library copy of the
  source take), blocks that asked for Optical Flow switch to it. fal jobs are recorded for
  crash recovery beside renders.
- Local programs: two Models card rows whose file is a zip unpacked where it lands.
- `panels/EnhancePanel.tsx`: the window. Store: the source it shows, a queue kind `enhance`.
- Right-click "enhance…": a take in Clip Gen, a timeline block, a Library video.
- Speed dialog (51): Optical Flow opens ENHANCE with Interpolate on at the multiple the block's
  speed needs; the copy the blocks then play has the same length and more frames.
- Theme: `--enh-interp`, `--enh-up`, `--enh-both` (blue, green, purple), in every theme's editor.

## Built 10-01, test later

- The window: Window → Enhance, or right-click → enhance… on a Clip Gen take, a timeline block, a
  Library video; a take or Library video dropped on the empty window opens there.
- The monitor: the take on the left of the slide bar, its newest copy on the right, both on the
  take's clock (a slow-motion copy runs faster to stay level); click another copy under it to
  compare that one. Replay 100 / 50 / 25 / 12.5 %, zoom fit / 100 % / 200 % of the copy's pixels.
  His cleanup after the first look (10-01): the slide bar sits on the monitor, not on the
  zoomed picture, so it never leaves the screen; the mouse wheel zooms at the pointer (from fit,
  or 100 % for a picture smaller than the monitor, up to 800 %); the zoomed picture drags with
  the hand and keeps its scroll bars. "dbl click
  gores back to 100%" (10-01): a double-click goes to 100 % with that spot in the middle, and at
  100 % back to fit (my pick, Lightroom's toggle). "disable click play", "only for the enhance
  module" (10-01): a click on the picture does nothing here; the play button plays and pauses.
- INTERPOLATE: "smoother" (×2, ×4, ×8 or a frame rate, same length, sound kept) or "slow motion"
  (×2, ×4, ×8 longer, no sound). UPSCALE: ×2, ×4, 1080p, 2160p. Each engine's own settings under
  it; Topaz on his PC lists the models his install has and each model's own sliders.
- Every blocker is said on the card before the click: a program not downloaded (with its
  download button and size), no fal key, Topaz not installed, an engine without slow motion,
  more frames or fps than an engine makes.
- The button: ▶ Enhance now or ＋ Queue, with the engines and the price (free on his PC; RIFE on
  fal has no number ahead, its price line shows).
- The preview: 2 s at the playhead, engines on his PC only, shown on the right of the slide bar.
- The copy: a new take the clip plays (flagged last when the clip has flags), with his outline
  and a tooltip saying what was done; next to the Library video it came from, or next to the
  Library copy of the take. The window remembers its picks.
- The timeline (his asks 10-01): a block playing an enhanced copy wears the same outline, inside
  the selection ring. Right-click a block → enhanced ▸ the original and every enhanced copy of its
  take; the block plays the one picked.
- Optical Flow (51): a slowed block switches to a copy of its take with enough frames; when none
  exists, OK opens ENHANCE on the take with the frames asked for, and the block switches when the
  copy lands. Frame Sampling or Blending on such a block goes back to its take.
- The two programs: Models card → enhance. Each zip unpacks into the row's own folder.
- Tests: `scripts/test-enhance.cjs` (the engine for real with stand-in programs: frame counts,
  sizes, sound, the pipes, the kill switch, the license token, fal inputs, the copy landing),
  `test-enhance-models.cjs` (the zip landing), `test-enhance-browser.cjs` (the window and its
  doors).
- My calls: a fal job that crashes between its two requests lands both results after restart (the
  first is paid for); Topaz on fal asked for more than 60 fps is refused on the card, not
  quietly lowered.
- Not proven: no engine has made a copy of a real take. RIFE and Real-ESRGAN were never
  downloaded; fal was never called; Topaz ran only on a test pattern.
