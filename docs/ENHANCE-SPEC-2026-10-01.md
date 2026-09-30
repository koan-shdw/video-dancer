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

## How it sits in the code

Filled in when the build starts.
