# Video Dancer 0.25.0

Release notes prepared 2026-10-04.

- One GO can cover a saved Co-Director plan. Review the work, models, settings, counts and costs, switch renders on and send GO.
- Completed jobs ping Co-Director across Image Gen, clips, image and video edits, scores, voice, Enhance and other result-producing operations. Each notification carries the results and saved progress.
- Co-Director uses its existing tools to inspect results before choosing what to do next or writing dependent prompts, then continues within the approved plan.
- The plan display shows progress, results and failures. Stop plan cancels queued work, requests cancellation of running jobs and keeps completed files. Switching renders off holds further dispatch and continuation.
- Job records and plan progress survive a restart. Unknown or interrupted submissions are reported without automatically repeating them. A confirmed failure can retry once within the approved allowance; a second failure blocks the plan.
- Civitai thumbnails stay cached on disk and are reused across views and app restarts.

Automated protocol, UI and regression tests, TypeScript and the production build pass. A real
Co-Director exchange continuing after real renders remains unverified. See the
[implementation and verification record](CODIR-JOB-SPEC-2026-10-04.md).
