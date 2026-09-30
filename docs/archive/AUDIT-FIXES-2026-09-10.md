# Audit fixes — 10 September 2026

Implementation follows the [original audit](AUDIT-2026-09-10.md), against application base `28c8bf1` (v0.17.2). Included in v0.18.1; see the public release for installer availability.

## Timeline playback

Recycled monitor players remain hidden until their new source and requested seek position are ready. Cancelled bindings cannot release or seek a replacement clip. The readiness check now accommodates low frame rates without holding playback indefinitely, and media errors release the playback clock. Dissolves validate the next visible block and place the outgoing translucent player above the incoming player regardless of which A/B slot is active.

**The reported playback flash remains unresolved.** The user confirmed it still occurs in OPPULENT, timeline opulentest1, between Demonette take 2 and take 1 near 16.4066 seconds. The unexpected picture appears to come from the later take-2 section starting at 20.1842 seconds. Export is unaffected according to the user's report. Passing synthetic decoding tests did not establish a fix for this incident.

At the user's request, the subsequent experimental change that delayed recycling the outgoing player was reverted, along with its new test harness and test-command changes. The earlier audit implementation described here is retained. No further playback repair is being pursued in this task, and no user project or source media was changed.

## Audit findings addressed

| Finding | Implemented behavior | Verification |
|---|---|---|
| Failed saves reported as successful | Save errors reject the operation; the queue can retry. Pending requests are retired after successful persistence. Request IDs make repeated take landing idempotent. Project switching waits for saves; repeated quit requests cannot bypass an unfinished save. | Simulated disk failure, error notification, retry and exactly one persisted take. |
| Project ownership lost across async work | Session identity is checked around image, audio, video and external-take imports, live take landing, and recovery. Closing and reopening the same directory creates a different session. | Delayed image copy A→B; audio/take imports A→B→A; delayed recovered result across a project switch. Video probing/transcoding ownership checks reviewed in source. |
| Unsupported Electron | Manifest and lockfile pin Electron 44.3.0. File import uses the preload's `webUtils.getPathForFile` bridge. | Typecheck against both existing local types and isolated 44.3.0 types; actual 44.3.0 media, dialog and sandboxed preload tests. |
| Export fade-dip differs from preview | Export blends both moving video sources using shared transition timing and source handles, with per-block effects retained. Missing source handles repeat edge frames. Video transitions do not add audio fades. | Pixel, duration and audio checks across consecutive dissolves, range trims, speed, FX bakes, gaps and underlying tracks. |
| Unreadable recovery ledger overwritten | Only a missing ledger initializes empty. Malformed or inaccessible records remain untouched; read/write errors surface in the Queue. | Malformed JSON and simulated access-denied reads preserve the original bytes, including when adding a new request. |
| Recovery checks running jobs only once | Serialized recovery repeats with backoff up to 30 seconds while a project is open; it yields to live media jobs. Queue shows recovery count/errors. | Running→done without reopen, no duplicate landing, concurrent-pass exclusion and project-switch cancellation with provider doubles. |
| Release uses floating shared source | Both platform jobs check out `koan-shared.ref`; pull requests run checks. Builds contain source revisions and dirty flags in `out/main/build-info.json`. | Shared revision pinned to the local commit below; build metadata inspected. Hosted CI has not run. |
| Dialogs leak keyboard focus/shortcuts | Dialog roles, accessible titles, semantic buttons, focus containment/restoration, topmost-only Escape and background shortcut guards. | Chromium checks with real React portals, nested confirmation, Tab wrapping and focus restoration. Background shortcut gate exercised; full timeline editing interaction remains a manual smoke check. |
| Obsolete onboarding/status | Storyboard, Bridge login, API-key and local-model setup routes follow the current registry. Saved credentials remain unverified until a successful test. | Mocked browser checks of route callbacks, stored-key labels and rejected ModelArk validation; no provider submission. |

## Checks

- `npm run typecheck` passed; a second check against isolated Electron 44.3.0 declarations passed.
- `npm test` passed: 11 monitor binding scenarios, project persistence/import safety, recovery scheduling and six export fixtures.
- `npm run test:playback` passed on isolated Electron 44.3.0 at 6, 12, 24, 30 and 60 fps: 320 decoded-color checks, covering source replacement and differently colored sections of one file. Earlier 160 source-replacement checks also passed on the existing Electron 31 runtime.
- `npm run test:dialogs` passed on Electron 44.3.0. The hidden test window uses Chromium focus emulation so it receives focus events without opening a visible window.
- `npm run build` and `npm run test:preload` passed. The latter verifies a real filesystem-backed `File`, a synthetic `File`, context isolation and recovery IPC against the built preload.

Tests use temporary synthetic projects/media and mocked supplier responses. They do not alter user projects or submit billable jobs.

## Release state and remaining validation

Shared UI changes are committed locally as `0e38ac4d853f2e41ccfadb4e18d4382014adedfb`, matching `koan-shared.ref`. Application and public documentation changes remain uncommitted. Nothing has been pushed or released. Push the shared commit before publishing an application tag that references it; a missing remote revision makes CI fail rather than build different code.

The currently open development app kept its existing Electron 31 files locked, so runtime compatibility was tested with a separate ignored `.audit-runtime` installation. Close that development app and reinstall dependencies before using the updated normal development runtime. The manifest/lockfile and new installers select 44.3.0.

Before release, verify the actual edited timeline in the updated app and run installed Windows/macOS smoke checks for launch, media drops, OAuth, GPU workers and updating. These platform/provider checks are still outstanding. No claim is made that all original acceptance criteria are complete.

The later dissolve revision retains per-block FX throughout the transition in both preview and export. Recovery counts may take one polling interval to clear after a result lands.
