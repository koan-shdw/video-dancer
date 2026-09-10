# Watch repair and timeline watching

Implemented on 10 September 2026 and included in v0.18.0. See the public release for installer availability.

## What changed

- Watch uses `gemini-3.6-flash` by default. The model can be changed in Settings → API → Watch model. Takes, timeline reviews, and Score compose all use this setting.
- When Google fails, Watch tries the existing Claude still-frame reader if configured. The result includes the Google error and clearly states that motion and sound were not reviewed. If both readers fail, both errors are shown.
- The Timeline toolbar has a **Watch cut** button. Choose the whole timeline or its marked in/out range and enter a question. The Co-Director also has `watch_timeline`, so it can review the story so far and the actual ending of the cut.
- Timeline watching freezes the selected edit and prepares a temporary 480p video using the existing export and effects renderer. It includes trims, speed, track visibility, transitions, effects, and mixed audio. Marked ranges report the original timeline timestamp offset.
- Preparation failures stop the review rather than silently dropping effects. Cancellation, closing the dialog, or switching projects stops the job. Cancel in the Co-Director also cancels its Watch request. Temporary local files and uploaded Google files are cleaned up; requests have time limits.
- The default model's estimated cost uses input and output/thinking token counts at its published rates. Custom models return token counts without an assumed price.

This feature watches a prepared video. It does not record the live preview, so it cannot reveal the previously reported playback-only frame glitch. No new playback fix is included here.

## Verification

- 10 provider-contract checks: default/custom model routing, usage accounting, API-error and empty-response fallback, missing-key behavior, combined errors, cancellation, upload cleanup, and invalid model rejection.
- 6 timeline checks with real ffmpeg output: actual cut order, audio, full cut versus range, timestamp offset, project isolation, cancellation/concurrency, error handling, and scratch-file cleanup.
- Hidden Electron 44.3 UI checks: scope, question, progress, fallback warning, cancellation, closing, unavailable range, model persistence without overwriting keys, and renderer handoff.
- A live request through the saved Google connection watched a one-second synthetic red video with a tone. Gemini 3.6 Flash correctly returned: “The dominant color is red, and there is sound.” 229 tokens; estimated cost $0.00054075. No user project footage was sent.
- The existing automated suite, TypeScript check and production build are checked alongside this change.

The live test confirms the configured Google connection and replacement model work. Long uploads, GPU-heavy timelines, and the user's creative footage were not sent to a live provider during testing; those paths are covered by contract and assembly checks instead.

## Sources

- [Google model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing)

## Using it after restarting the updated app

Open a project, go to Timeline, and click **Watch cut**. The normal result is labelled **Video and audio review**. A degraded result is labelled **Still-frame review — no motion or sound**. For chat, ask: “Watch this timeline and describe the last action on screen.”
