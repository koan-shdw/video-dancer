# Video Dancer — unreleased

Co-Director plan continuation repair, 2026-10-04.

- Ordinary conversations keep their existing history and single-exchange behavior. Detailed plan instructions, continuation controls and combined clip-edit schemas load only for approved plan turns. Plan creation, status and cancellation remain discoverable in normal use.

- Co-Director can finish one task, save its progress and choose the next task for a fresh turn. This works before renders exist as well as after results arrive.
- Each plan turn receives the approved scope, later user corrections, saved progress and successful actions since the last checkpoint. Old conversation and a superseded standing brief are no longer replayed into these turns.
- Completed edits survive an interrupted reply. GO resumes a blocked approved plan within its remaining allowances. Cancelling a reply pauses the plan; Stop plan ends it and cancels pending work.
- Job results wake Co-Director once per result version. Already handled results do not repeatedly wake it or create empty continuation loops. Renders keep dispatching while Co-Director works on an independent task.
- Provider quota, sign-in and request failures pause the plan. A quota notice is treated as a failure, including when the provider returns it as ordinary reply text. It is not accepted as a finished task, video inspection or digest.
- One clip read can include the saved fields, compiled prompt, model capabilities and reference pictures. One write can save fields, beats and settings together and return the saved compiled prompt and preflight result. Invalid settings refuse the whole combined edit; beat graphics and existing references remain preserved.
- Unsupported clip modes, resolutions and aspects are rejected before a plan queues the request, using the shared model registry.

The full regression suite, focused continuation/provider checks, real preload/UI checks,
TypeScript and an isolated production build pass. Tests use fake providers and isolated
projects. No live AI exchange or render was started to test these changes; creative quality,
provider throughput and a complete real workload remain unverified.

These changes are in development and are not included in the published 0.25.0 installer.
