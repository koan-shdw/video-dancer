# Gemini Omni Flash integration + vid2vid workflow plan

Settled 2026-07-02 in discussion. This is the agreed design, written before implementation.

## The model (research verified against fal's OpenAPI, 2026-07-02)

Correct name: **Gemini Omni Flash** (user shorthand "omni"). fal namespace `google/`, launched ~June 30 2026, preview upstream (`gemini-omni-flash-preview`). Four endpoints, all standard `fal.subscribe` queue:

| Endpoint | Mode | Required input |
|---|---|---|
| `google/gemini-omni-flash` | txt2vid | `prompt` (max 20k chars) |
| `google/gemini-omni-flash/image-to-video` | img2vid | `prompt` + `image_url` |
| `google/gemini-omni-flash/reference-to-video` | ref2vid | `prompt` + `image_urls` (1-10), refs bound via `<IMAGE_REF_0>` tags in the prompt |
| `google/gemini-omni-flash/edit` | vid2vid | `prompt` + `video_url` (complete schema, no other fields) |

Generation constraints: duration integer 3-10s (default 8), aspect 16:9 or 9:16 only, 720p only, **no seed**, **no audio toggle** (audio always generated, steered by prompt text). `/edit` exposes zero knobs: it works off the source video plus the instruction. fal's own prompt guidance for edits: short instructions, append "Keep everything else the same."

Hard limits: no voice editing, no audio-reference upload, editing non-Gemini-generated footage is blocked for EEA/Switzerland/UK accounts (our re-uploaded Seedance/Sora takes count as uploads there). Outputs likely SynthID-watermarked.

Pricing: token-based. Input $1.875/1M, output $21.875/1M. Approx **$0.125-0.13 per second of 720p output**; an edit ALSO bills the input video's tokens (a 10s edit is roughly $1.40 total). Cost estimates in the UI must include the input-video side for edits.

## Workflow design (option B: fork-on-edit derived clips)

- Non-destructive vid2vid via **derived clips**, not same-clip takes and not a separate node-tree store. Every edit turn is a first-class Bin clip; its takes are re-rolls of that edit; chains of edits are chains of clips with source pointers. A lineage tree view can be derived later from the pointers.
- `PromptData` gains `mode: 'v2v'` and `sourceVideo: { clipId, takeId, file, inSec?, outSec? }`. `file` is stored (relative) so the GC live set and re-renders survive source-clip deletion. Take snapshots freeze it like everything else.
- **Panels**: rename the current Clip Editor panel to **Clip Gen**. New separate dockable panel **Clip Edit** for v2v (dockview handles tab/tile/float natively). Double-click routing by clip kind: gen clip opens Clip Gen, edit clip opens Clip Edit. Clip Edit opens on demand (existing layouts untouched).
- **Entry points**: right-click a timeline block ("Edit clip (v2v)" on the slot's resolved take), and a per-take button in Clip Gen's take strip.
- **Draft until gen**: hitting "Edit clip" opens Clip Edit in a draft state (source + window + prompt). No Bin clip exists until the first successful generation, which creates the edit clip and take 1 together. Draft is panel-local and not persisted.
- **Segment window**: Clip Edit shows the source with an in/out trim bar (Clip Monitor source-bar pattern) and preview. Sources over the model max require a window; sources at or under it default to full range. On render, ffmpeg pre-cuts the window to a temp file (deleted after upload), uploads only the segment. Launched from a timeline block, in/out prefill from the block's trims.
- **The take is the edited segment only.** No auto-stitch, no auto-replace on the timeline. The timeline is never touched by Clip Edit; the user splices manually with existing tools (slice + per-slot take picker). Stitch or one-click splice can be revisited after real outputs are seen.
- **References**: `/edit` accepts none (schema-verified). Words only. The panel stays skinny: source, window, prompt, takes, cost, render.
- **Multi-turn**: editing an edit forks again (new derived clip whose source is a take of the previous edit clip). This mirrors the model's conversational-turn design.
- **Upload caching**: cache the fal.storage URL per uploaded take file so re-rolls skip re-upload.
- **Generation modes** (t2v/i2v/ref2v) slot into the existing model registry like Sora did. Ref count routes the endpoint internally (0 refs = base t2v endpoint, 1+ = reference-to-video). `@title` mentions translate to `<IMAGE_REF_n>` tags at emit time. Registry gains a per-model prompt-emission style so Gemini gets natural language instead of Seedance-tuned YAML.
- **Registry-driven v2v**: v2v capabilities (max/min input length, params, pricing) live in the model registry so a second v2v model (Kling is a candidate) is a registry entry, not a panel rewrite. Omni ships first; Kling evaluated after.

## Probe list (run before building, ~$5-8 on the user's fal key)

1. 1080p source into /edit: output resolution (720p downscale expected)
2. Output vs source: length, fps, audio preservation
3. Output container/codec (ffmpeg concat compatibility with Seedance/Sora takes)
4. Odd-aspect source (1:1, 21:9) behavior
5. Minimum input length (does a 1.5s clip edit?)
6. Over-max input (15s: rejected or truncated?)
7. Real billed cost per edit vs token math
8. fal-hosted output URL fed straight back as the next edit's `video_url` (chain without re-upload)

## Build order

1. Probe session, record results in this doc — **BLOCKED: no fal key on this machine yet** (probe list below still owed; registry constants marked provisional)
2. Registry + shared types (engine entry, v2v capability block, prompt transform) — DONE 2026-07-02
3. Main process: omni gen routing in fal.ts, edit pipeline (segment cut, upload cache, edit:run IPC), GC live-set addition for `sourceVideo.file` — DONE 2026-07-02
4. Renderer: Clip Gen rename, Clip Edit panel, fork entry points, draft flow, cost estimate with input tokens — DONE 2026-07-02
5. Docs/cheat-sheet/tour text pass — user-visible strings done; feature manual not yet updated

Known v1 limits (accepted): a deleted source clip blocks further re-rolls of its edit clips (the file is pinned for playback/GC, but re-render needs the take entry); draft state is panel-local and lost on app close; no lineage tree view yet (parent pointers exist in the data).

## Probe results (run 2026-07-02, all 6 passed — scripts/probe-out/results.json)

- P1 t2v 3s baseline: 1280x720 h264 (High) 24fps 3.01s, AAC 48kHz stereo
- P2 /edit chained off P1's fal URL (no re-upload): works; 3.01s in → 3.01s out
- P3 /edit on uploaded 1080p 6s: **downscaled to 1280x720**; 6.02s out (length preserved)
- P4 /edit on 1:1 source: **output is 16:9 1280x720 — aspect is NOT preserved**
- P5 /edit on 1.5s source: works (1.51s out)
- P6 /edit on 15s source: **silently TRUNCATED to 10.01s** (not rejected)

Conclusions applied to the registry: every mode outputs exactly 1280x720 16:9 h264 @24fps + AAC 48kHz stereo, regardless of source resolution or aspect; length preserved up to the 10s cap; maxInSec 10 confirmed (truncation, so the explicit window UI matters); minInSec left at 1 (1.5 verified, lower untested); outputs are concat-compatible with the ffmpeg export pipeline (same codec family as Seedance/Sora takes, export re-encodes anyway). Cost per probe not measured (no admin key set) — token math (~$0.13/s out + ~$0.011/s in) stands.

Practical caveats for users: editing a 1080p Seedance take returns 720p; editing a 9:16 or 1:1 clip returns 16:9 (reframed) — mention both in docs/README when the beta ships this.
