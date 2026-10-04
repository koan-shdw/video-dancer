# Co-Director runs a whole job on one GO

THE LIST item 6. Implementation and verification record, 2026-10-04.

## Purpose and behavior

Co-Director owns the plan. The app records job outcomes and pings Co-Director when the jobs it is waiting for have settled. Co-Director reads the results, inspects their content with its existing tools, decides the next action and carries it out within the approved plan.

This applies across the app's render models. Image Gen, clips, scores, voice, image/video edits, Enhance and other result-producing operations use one job record format. The image-to-video example illustrates a possible plan; the notification code contains no rules for inventing or launching later stages.

1. Co-Director saves its plan, required app tools, render models, fixed settings, call counts including any retry allowance, costs and maximum continuation exchanges.
2. The app displays the plan. The user's GO approves the displayed plan ID and revision using the selected Co-Director route.
3. Co-Director queues work through the existing render handlers. Each accepted job receives a distinct ID and a saved request. It saves the IDs it needs and its current progress, then ends the exchange.
4. The app saves each result before publishing its notification. When the awaited jobs settle, the app opens a fresh Co-Director exchange carrying the approved plan, saved progress and job results. The notification is an app event; it does not fabricate another user GO.
5. Co-Director inspects actual content before choosing images or writing dependent prompts. Existing read_object now also transports selected image bytes through the API/MCP tool result, up to four pictures per call. Existing watch tools handle video inspection. Co-Director saves decisions and continues with its existing Library, folder, clip, timeline and score tools.
6. Stop plan saves the stopped state first, cancels queued work and asks existing providers to cancel running work. Completed files remain available.

Job tracking and continuation run in the main process and do not require the Co-Director or render panel to be open. The status display presents the approved plan, progress, outcomes and Stop control.

## Implemented paths

The registry is `src/main/appJobs.ts`. The shared result contract is `koan-shared/vidancer-ui/src/shared/jobNotifications.ts`. Routing to each model remains in its existing handler.

| Operation | Observed entry points |
| --- | --- |
| Image Gen and clip rendering | imagegen:render, render:run |
| Image and video editing | image:generate, vedit:run, edit:run |
| Scores, sound effects and voice | score:render, score:compose, voice:render, voice:describe |
| Enhance, including its preview | enhance:run, enhance:preview |
| Timeline and media export | export:run, media:exportAs |
| Sheets and blocking images | sheet:build, block:build |
| Image results and derived media | image:cropSave, library:saveFrame, image:addDynamicStill, media:reverse |
| Timeline analysis and assembly | watch:timeline, assembly:concept, assembly:assemble |
| Streaming effects | fx:passStart and fx:bakeStart are recorded through completion at fx:encodeEnd |
| Direct Co-Director video inspection | watch_take and watch_timeline are observed where the tool calls run |

There are 22 registered result-producing IPC routes, plus the streaming effects and direct watch paths. Internal provider calls inherit the outer job. File imports, Library copies, metadata edits and model downloads retain their existing behavior; they are not submitted as render jobs. A completion record makes an operation observable. Co-Director can initiate operations exposed by its existing tools; the registry does not invent additional tools for it.

## Persistence and execution

`src/main/jobNotifications.ts` atomically saves `codir-jobs.json` in each project. Records contain job ID, attempt number, kind, model, target, timestamps, state, owning plan where applicable, saved request, output IDs/files and result/error. States are queued, waiting, running, done, failed, cancelled and lost. The disk snapshot retains 500 completed manual records and the plan records.

Image, clip, score, voice, image-edit and enhanced outputs carry their originating job ID and attempt. Restart reconciliation uses existing saved outputs with that provenance and verifies file existence. Work interrupted without a confirmed result becomes lost and is not automatically submitted again. Queued saved work remains queued. This preserves uncertainty rather than assuming an interrupted provider did nothing.

Saved plan dispatch reuses the registered handlers directly. Image Gen recipes, seeds and reference file paths are captured when queued. Clip requests use the compiled prompt, selected references and existing settings. Distinct requests receive distinct job IDs, so intentional repeated takes are accepted independently of the ordinary UI double-click guard.

The app enforces the selected Co-Director route, allowed tool names, render kind/model, configured request settings and call counts. Counts include reserved retries. Cost descriptions are shown for review; this is not a numeric dollar-budget enforcement system. The creative brief and source choices remain Co-Director's responsibility.

A confirmed failure can retry once with its saved request and seed if the allowance permits it. A second failure or an exhausted allowance blocks the plan. Accepted provider requests and timeout/network uncertainty are treated conservatively as lost, without automatic retries. A lost owned job cancels pending siblings so the batch can settle and report the uncertainty to Co-Director.

Dispatched jobs have a two-hour deadline, including an initial GPU wait; engine start resets the running timestamp. Expiry records lost and attempts cancellation. The existing GPU lock is reused, with stop/project checks when waiting and when entering the engine. Cancellation remains dependent on each provider's existing capabilities. Late results stay marked late and cannot turn a stopped/lost job into successful completion.

Only the current project dispatches work. Project guards prevent the covered result mutators and Co-Director log writes from writing into a different open project. The selected AI route is checked again before dispatch and before a continuation. User exchanges are serialized ahead of queued job exchanges. Continuations have a saved exchange limit and stop after two exchanges without recorded progress.

Turning renders off holds dispatch and automatic continuation. Local Topaz uses its existing engine with model downloading disabled for approved plans. No alternative paid provider is selected by the notification code.

## Verification

PROVEN here means observed in code or an executable test, with the scope stated. It does not mean a live model rendered the workload.

| Check | Evidence and scope |
| --- | --- |
| Shared protocol and saved plan | `scripts/test-job-notifications.cjs`: 21 jobs, durable save before notification, atomic batch refusal, exact approval revision, model/settings/count checks and progress persistence |
| Failure handling | Same test: one frozen retry, second failure blocks, uncertain submission never retries, never-returning provider expires and releases a report, duplicate/late results remain controlled |
| Restart, Stop and project changes | Same test: provenance reconciliation, unknown interruption becomes lost, stopped GPU wait cannot start and changed project cannot dispatch |
| Fresh continuation | Same test exercises createJobPump: completion waits for the active user exchange and simultaneous polls produce one fresh callback |
| Inspection before later requests | Real Co-Director tools create 21 tiny test image files/takes, deliver all 21 through read_object, copy a selected take to the Library, create a clip and queue two distinct 5s/480p requests. Render handlers and the Co-Director continuation callback are fake; this proves plumbing, not AI judgment or GPU rendering |
| Route inventory | Every registered route is exercised with a fake handler and checked against actual registration; streaming effects finish at encodeEnd and startup failure is reported |
| API image transport | Tests cover image-bearing tool results on Anthropic/MCP and Venice conversion, and image removal with explicit disclosure for the configured non-vision DeepSeek model |
| No implicit Topaz download | Test checks download=0; installed Topaz filter help was inspected to verify the option exists |
| Actual UI control | `scripts/test-job-notifications-browser.cjs` runs the real Co-Director panel in an isolated Electron window with koan.css. Mouse/keyboard input verifies displayed revision approval, GO, Stop and the lost-job report without renderer errors |
| TypeScript | `npm run typecheck` passes for the application and imported shared UI |
| Production bundle | `npm run build -- --outDir <workspace>/work/build` passes for main, preload and renderer, without replacing the running app's output directory |
| Existing regressions | Full `npm test` passes, including existing render, Co-Director, image, score, voice, Enhance, project safety and recovery checks |

`npm run test:jobs` runs both new executable checks. Existing score/voice extraction tests were adjusted to recognize registered job handlers, and the bridge image-permission assertion was updated for explicit gen-take paths. Existing ordinary single-GO render behavior remains covered by its original tests.

## App error and current limits

During editing, CoDirector.tsx briefly imported CodirPlanStatus before that component file existed. Vite hot reload showed the missing-import overlay supplied by the user. The component and its correct API import are now present. TypeScript and the renderer build pass, and the running Video Dancer window was inspected after the repair: the Bin and Co-Director displayed normally with the overlay gone.

At the initial implementation checkpoint, the new main/preload behavior still needed to be loaded in the running app. The later GO repair corrected the missing project scope on saved-plan notifications. A real Co-Director exchange responding to real renders was OPEN at that checkpoint. No live AI calls, paid renders, local GPU generation or model downloads were triggered for verification. Creative quality, provider cancellation, live model duration/dimensions and full-workload throughput remain OPEN until exercised with the user's intended settings.

## Plan continuation repair — development, 2026-10-04

The supplied transcripts show long exchanges repeating reads, writes and settings repairs,
then timing out. The later transcript also shows many rewrites saved before the timeout.
The repair therefore preserves successful actions and the current task, alongside the
existing plan checkpoint. It does not infer that completed edits were lost.

`plan_progress` accepts Co-Director's chosen `next` task. Saving that handoff ends the tool
exchange and makes one fresh turn eligible, even when there are no render jobs. The existing
job pump handles this handoff and new result versions. It keeps dispatching queued renders
while an independent Co-Director turn is running. It does not wake for a saved edit alone,
replay already delivered results or interpret the plan as a workflow graph.

Plan turns on the API, Claude Code, Codex and Gemini CLI receive the approved scope, later
director updates, checkpoint, current task and successful action receipts. They omit old
conversation and the standing brief. `read_jobs` returns compact current state by default
inside such a turn; the full saved plan remains available on request. Successful action
receipts retain the latest 100 actions since the checkpoint; the full tool log remains in
the project. A provider failure or cancelled reply blocks continuation. GO can resume the
same approved plan on the same route within its remaining allowances; an explicit Stop
remains final. An exchange ending without a next task or pending jobs reports a blocked
plan instead of leaving it apparently active.

`read_object include_context` combines a clip read, compiled prompt, capabilities and
reference-image records and pixels. `set_clip_fields` can save beats and settings with the
fields in one validated write and return the compiled prompt and preflight. It reuses the
existing beat and settings functions and checks their separate plan permissions. Shared
model capabilities reject incompatible modes, resolutions and aspects before submission.
Duration picker entries are not treated as exhaustive renderer limits.

Additional executable evidence:

- `test-job-notifications.cjs`: fresh tasks without renders, saved actions across reload,
  approval-preserving resume, stopped-plan behavior, consumed-result rejection, a result
  arriving during notification claim, and continued render dispatch during a held Co-Di turn.
- The same integration test inspects actual reference pixels through the combined clip read
  and verifies that combined writes cannot bypass approved tool permissions.
- `test-codir-cli.cjs`: current context on all four provider paths, no old transcript/brief,
  quota text treated as failure without retry, and explicit provider failures preserved.
- `test-codir-reach.cjs`: invalid combined edits leave fields unchanged; valid combined edits
  return the saved compiled prompt and preserve beat graphics and reference images.
- The full existing suite, real preload/UI check, TypeScript and isolated production build
  pass. No live model workload was run for this repair.

Ordinary requests retain their existing conversation history and single-exchange behavior.
Only approved plan turns load the execution guide, `plan_progress`, `wait_for_jobs` and the
combined clip schemas. Normal requests retain plan creation, status, cancellation and render
operation discovery. API payload and real MCP list tests cover this separation.

Compared with application baseline `adfe4a5`, the serialized ordinary tool definitions, tool
menu and default loaded guides total 136,373 characters instead of 139,563: 3,190 fewer,
or 2.29%. This is a prompt-character measurement, excluding project context, conversation,
images and provider framing. Token counts and live billing savings were not measured.

The development app was reopened after confirming it was closed and the saved job record had
no unfinished jobs. Its build record identifies application `2588278` and shared `f56e037`,
both clean. Native window inspection confirmed the same IDEA DEV project, saved draft plan,
existing clips and empty queue, without an error overlay. GO was not pressed. Startup logged
one settings-file rename failure; a later settings save completed and left no temporary file.
One Higgsfield account's background refresh also reported a network failure. Neither a live
Co-Director exchange nor a render was started as part of this verification.

## Retained baseline findings

These findings came from the initial read-only inspection and are separate from the implemented completion protocol. Main baseline commit: aeb4bb4afc3a02330165f3e37c0d9b31d83af886. Shared UI baseline: b17a562ccce209bbf6b837332e3f67ec3b355ecb.

- h3local is MiniMax H3 local video. The renderer accepts 4 to 15 seconds, including a supplied 5s request; the current picker lists 4, 6, 8, 10, 12 and 15. Its 480p setting means approximately 0.5 MP rounded to multiples of 32, not a literal 480-pixel height. At 16:9 the base is 928 by 544. Internal latent upscale defaults to 1.25. Ten seconds requests 243 frames at 24 fps. Actual file duration and output dimensions remain unmeasured in this work.
- The initial disk inspection found H3 base/encoder/essential files, the shared engine environment and required node packs. Topaz's executable and model directory exist. This establishes file presence; complete usable model caches and licence acceptance remain OPEN.
- The historical claim that four images vanished remains OPEN. The prior recorded test states eight fired and eight landed as T9 to T16 with wrong prompts. At the initial inspection the saved project had 41 Fractal Fantasy takes and all 41 files existed. Current files cannot reconstruct an earlier deletion.
- The app already exposed take paths and had Library-copy, folder, clip-reference and watch tools. This change connects job completion to a fresh Co-Director exchange and supplies explicit image-bearing read_object results where the API previously only returned text.
- At the initial inspection, Pastel Heaven contained 78 characters of complaint text and zero takes. It was not an empty prompt field.
- The earlier example of 12 gens times 20 pictures, two clips per picture and one upscale per clip totals 1,200 operations before retries. It is an illustration, not a fixed product requirement or a measured workload.
