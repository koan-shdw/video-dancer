# Score Gen audit — 10 September 2026

Included in version 0.19.0.

## How it works

Choose a music model, write the style and optional lyrics, and enter timed musical beats. Render now starts a job; Queue saves the current recipe for later. Finished audio becomes a take. Its keeper is the take played by score blocks on the timeline.

The new **VIA** field shows the actual supplier, with its key/credit explanation. It is fixed to the implemented route for each model, matching the Voice card. MiniMax Music 3, Beatoven and Sonilo use fal. ElevenLabs Music v2 uses a separate ElevenLabs key. ACE and MiniMax Local use the installed runtime on this computer. Missing cloud keys block the render controls with a reason. No unsupported bridge routes were added.

For **Compose**, stretch the score over a timeline span and select that block. Compose reads a draft video of that span, then uses the Co-Director connection to suggest beats. Watching uses Google AI when configured, with the existing Claude still-frame fallback. These connections are separate from the music model's VIA. Empty beats fill in place; existing beats produce a duplicate. The resulting recipe uses the span's length.

Sonilo uses the selected span video directly; its style prompt can steer the music, but manual beats remain notes. If the same score has multiple spans and none is selected, the app asks you to select one instead of guessing.

## Corrections

- Queue jobs now carry frozen beats and settings. Editing the card afterwards cannot change an already queued job's style, lyrics or duration. Saved takes and fal recovery records retain that snapshot.
- Invalid/voice model IDs fail before paid submission, instead of silently falling back to MiniMax. Local engines cannot enter the fal renderer.
- The selected timeline and score block are carried through to Sonilo and Compose. A span from a different score is rejected. Spans above the model's duration limit fail before analysis/upload.
- Score proxies render independently of normal exports, preserve trims/order and pad the requested span's black tail. Scratch files are cleaned up.
- Compose watches the assembled span once, without also watching every whole source take. It no longer analyzes trimmed-out action or makes those duplicate watch calls. Recipe digests are used only when watching fails, clearly identified as recipe context in the synthesis prompt.
- Compose saves pending card edits first, works from a project snapshot, updates the render length, and refuses to apply stale results after a project switch or intervening score edits.
- ElevenLabs output format is now a query parameter, as required by its API. Music chunks preserve the requested total through short lead-ins and long-section splits; excessive section counts fail instead of silently truncating the song. Out-of-range beats cannot extend the plan beyond its duration. Nested plans display correctly in the outgoing-content preview.
- ElevenLabs lyrics are enabled and sent in vocal mode, including when no beats have been entered. Stop aborts the direct HTTP wait and releases its tracked job. This does not promise remote cancellation or a credit refund.
- Returned audio without duration metadata is probed locally for playback timing.
- Selecting an installed local model keeps Score Gen in front. Only an active download raises Models; a missing model still offers setup. The shared setup helper checks readiness before querying disk space.
- Fixed disappearing take-color stripes in Score and Voice: changing keeper updated a CSS border shorthand that reset the unchanged colored left edge. Separate border sides preserve the stripe. Saved metadata was intact. A browser regression reproduces the old failure and checks keeper changes, selection, disable, recolor and clear; persistence checks cover Score, Voice, Clip Gen and Image Gen through reopening.

## Verification and limits

`npm test` includes the Score regression checks: real handler code, persistence, frozen queued recipes/recovery metadata, provider routing and request bodies, direct-request stop, section timing, span selection, actual ffmpeg proxy pixels/duration, Compose save/duplicate behavior, and project/edit race protection. Provider replies are simulated; no paid generation or local model downloads are run.

`npm run test:score-ui` mounts the actual card in hidden Electron and checks VIA, key gating, immediate edits followed by Queue, span identity, Compose save order, lyrics and local controls. Existing monitor, export, watch, voice and project-safety checks also pass. Typecheck and production build are checked separately.

Musical beat timestamps guide generation; they do not guarantee sample-accurate musical events. MiniMax's duration is an upper bound and it can finish early. Score preparation remains a 480p draft without baking the renderer's effects; the separate full timeline Watch feature includes effects. Local workers retain their existing cancellation behavior. Live musical quality and account entitlement require an actual render by the user.

API references checked: [ElevenLabs compose](https://elevenlabs.io/docs/api-reference/music/compose/), [ElevenLabs composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans), [fal MiniMax Music 3](https://fal.ai/models/minimax/music-3/api), [fal Sonilo](https://fal.ai/models/sonilo/v1.1/video-to-music/api).
