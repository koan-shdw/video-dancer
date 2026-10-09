# Video Dancer 0.27.0

Release notes prepared 2026-10-10.

All 99 bugs of the 9 October re-audit are fixed, in 11 batches. The full list, with what each
batch changed, is Part 1 of the [audit](AUDIT-2026-10-08.md) (and its PDF).

- Image Gen renders show in the Queue with their progress, and ✕ there stops one, like every other render.
- A render the supplier already took is never sent a second time, and ✕ while a job still uploads stops it before anything is spent.
- Spend is counted once, in the project that ran the job: Co-Director plan jobs, recovered renders and Sheet Gen included.
- Video Editor jobs and clip edits come back after a quit or a crash, like renders do.
- Ctrl+Z never takes a finished render away, switching timelines is not an undo step, and deleted results keep their files until Cleanup, so undo brings them back.
- Forms keep what you type: a quick switch saves it, a render landing never wipes it, and ↩ load recipe brings back the seed and links too.
- Timeline: quick nudges all land, a cut gives each half its own volume line and fades, and trimming a block's start keeps its linked sound in sync.
- Timeline keys and Ctrl+V act only while the timeline is the panel you are in.
- Local engines: ✕ on a job waiting for the GPU stops it, adding a LoRA folder or deleting a model never kills a running render, and a second launch just brings the app to the front.
- Refs named @image1, @image2 in any order keep each name on its own picture.
- Each Bridge login keeps its own uploads, and a Bridge result is never your own ref coming back.
- Watched "send both" puts both LoRAs into Image Gen at their weights, and Get + Use picks the right LoRA version.
- A MOOD is never written over without asking you first.
- If saves start failing (a renamed folder, a full disk), closing asks whether to reopen the window or quit, and Video Dancer always opens again.
- Settings, spend, rules and guides are never replaced by an empty file when one can't be read.
- A duplicated project starts without the original's queue, plan or recovery entries.
- Exports use one frame rate for the effects and the cut, and no longer flash console windows.

The installer no longer carries the app's TypeScript source or the four draft MOODS; every
installer build now checks that before it is made.

Verified: TypeScript, the full regression suite (with new tests for each batch), 51 of 52 window
tests (export-many fails at its build step, as it has since 8 October) and the production build.
Not yet tried by hand: the 70 tests on the test card, including every supplier lane, which no
test sends to a live service.
