# DEPTH LANE (list 42), spec of 2026-10-01

His words (09-08, parked): depth maps of a dance as a motion reference, from the tutorial filed in
The research notes §7. His pick 10-01: "finish the remaining todo".

The tutorial's road, word for word in the corpus: the dance video goes to fal's Depth Anything
Video ("keep it on the VDA large model", $0.04 a second), the clean depth map goes into Seedance's
video reference slot, and the prompt says it drives the motion. A depth map carries the movement
and none of the faces, clothes or background that would bleed into the render.

## Supplier facts (fal's own page, read 10-01)

`fal-ai/depth-anything-video`: `video_url` (required) · `model` VDA-Small / VDA-Base / VDA-Large
(default Large) · `colormap` grayscale (default), turbo, inferno, magma, viridis · `resolution` auto
(up to 1080p), 360p to 1080p · `max_frames` up to 2400 · `output_fps` (default = the input's) ·
`side_by_side` · `include_raw_depths`. Out: `video` (an H.264 MP4). $0.04 a second of video.

Which engines take it: every engine with @video slots in Clip Gen (Seedance 2 and 2.5, the
tutorial's engine; Omni Flash 1.1): the depth video is a Library video like any other.

## From his seat

- Right-click a Library video, a take in Clip Gen, or a timeline block → **make depth video ·
  $0.48** (the price is the source's seconds × $0.04; no price when its length is unknown yet).
  One click queues it (a queue row "<name> · depth", Depth Anything VDA large on fal). No fal key:
  the missing-key steps open, as for every fal job.
- The result is a COPY in the Library: "<name> · depth map", next to its source video (a take's
  depth map sits next to the take's Library video when the take was dragged there, else at the
  end). It wears the copies' outline in grey (blue, green and purple are ENHANCE's), and its
  tooltip says what it is for: drop it in a clip's video refs, the motion without the look.
- Never a take: a depth map is a reference, not a shot of the clip.
- Grayscale, VDA large, the source's own frame rate and size (up to 1080p): the tutorial's pick.
- A crash mid-job: the request is recorded the moment fal takes it and lands on the next open,
  like an ENHANCE job.

## Built on ENHANCE's road

It rides the ENHANCE plumbing: the same queue kind, the same upload, the same fal call and
recovery records, the same copy landing (a third mark, `depth`, beside interp and upscale). The
ENHANCE window itself is untouched (its two sections stay his design).
