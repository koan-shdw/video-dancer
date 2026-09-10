# Video Dancer audit: plain-English report

The audit changes below are included in v0.18.0. Automated checks pass. Installer availability is recorded on the public release; the hands-on checks listed below remain outstanding.

## What changed

1. **Safer saving.** A failed save now reports failure to the operation that requested it. A finished render keeps its recovery record if saving fails, and retrying its registration avoids creating a duplicate take. Project switching waits for outstanding saves; repeated quit requests cannot skip an unfinished save.

2. **Safer project switching.** Imports and render recovery check that they still belong to the project session that started them. This prevents the reviewed paths from inserting files or results into a different project after a switch, including closing and reopening the same project.

3. **Continuing render recovery.** When a project reopens, recovery keeps checking unfinished supplier jobs instead of checking only once. The Queue shows recovery status and errors. Recovery avoids overlapping its own checks or competing with live media jobs.

4. **Protection for damaged recovery records.** An unreadable recovery file is preserved and reported. It is no longer treated as an empty file that can be overwritten by a new job.

5. **Better exported dissolves.** Exports blend both moving shots using the monitor's transition timing, instead of fading to black. The later dissolve revision retains effects through the blend and adds draggable timeline handles. Only missing source footage repeats edge frames. Visual transitions do not add an extra audio fade.

6. **Better keyboard behavior in dialogs.** Dialogs receive focus, keep Tab navigation inside them, and restore focus when closed. Escape closes the top dialog. Background editing shortcuts are guarded while a dialog is open, and close/confirmation controls are proper buttons.

7. **Clearer first-time setup.** The welcome screen offers storyboarding, cloud supplier connections and local rendering setup. A saved API key is labelled as saved, rather than claiming it has been verified. Failed validation stays visible as a failure.

8. **Updated desktop runtime.** The dependency files now select Electron 44.3.0, and file import uses its supported file-path interface. Compatibility was checked in a separate installation so the running app did not need to be interrupted.

9. **More repeatable releases and useful checks.** Releases now select an exact shared-code revision, rather than whichever revision happens to be newest. Builds record their source revisions. Automated checks cover saving, imports, recovery, exports, video decoding, dialogs and the connection between the interface and desktop app.

## Playback issue: still unresolved

The wrong-frame flash in **OPPULENT / opulentest1** is not counted as fixed. The user confirmed it persists between Demonette take 2 and take 1, around 16.4 seconds, and does not appear in the export.

The latest experimental playback change, its extra tests and its test-command additions have been undone. The earlier audit changes are retained. Further playback repair is left to the user's other agent. The project and its media were not edited during this investigation.

## What was checked

The regression suite and type checks passed again after the undo. Previous build, export, browser-dialog, video-decoding and desktop-interface checks also passed. Export fixtures covered consecutive dissolves, trims, speed changes, effects bakes, gaps, underlying tracks, duration and audio. Failure tests used synthetic projects and mocked supplier responses; no billable jobs were submitted.

These tests do not establish that the intermittent playback flash is fixed.

## What remains

- Installed Windows and macOS release checks: launch, file drops, provider login, local GPU workers and updating.
- Final hands-on checks of keyboard editing behind dialogs and the complete first-use flow.
- The separate playback repair described above.
- Release preparation is recorded in [the v0.18.0 notes](RELEASE-0.18.0.md).

The source changes and automated verification are complete for this audit pass. Full release acceptance is not complete.
