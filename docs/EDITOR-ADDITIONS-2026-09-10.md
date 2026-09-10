# Editor additions — 10 September 2026

Included in the v0.18.0 release. See the public release for installer availability.

## Using the additions

- **Bin and Library:** Ctrl-click to select several items, or Shift-click a range. Right-click a selected item and choose **delete N selected**. Selections across sections are included. One confirmation and one Undo cover the whole deletion. Source media stays on disk. Right-clicking an unselected item selects just that item. Single-item commands such as Rename are excluded from bulk menus; existing image/clip bulk tools and folder moves remain available where applicable. Duplicate is available when every selected asset supports it.
- **Timeline:** drag the small cut marker to create a centered dissolve. Drag either edge of the labeled transition block to adjust its length, or double-click for exact duration and alignment. Alternatively, select one or several video clips and click **Cross-dissolve** in the toolbar, or right-click a selected clip and choose **cross-dissolve…**. The dialog explains clips it cannot apply to: the final clip, gaps, missing takes, hidden/covered clips, and locked tracks. **Remove dissolves** removes selected transitions. Short clips cap the duration; clip positions stay in place.
- **Image Gen:** drag a take card directly onto reference A or B. Its image is saved to the Library using the existing keep-to-Library path and reused if already kept. The current prompt and other recipe settings remain intact. Library-image drops still work. A take from another Image Gen card also works.
- **Monitor:** fixed the black flashes while moving the playhead. Same-clip seeks retain the decoded picture while seeking. Different clips decode on the spare video player before replacing the presented picture. The spare is not overwritten by preloading during that handover. The user confirmed the flicker was fixed.

The dissolve implementation was revised after feedback: new transitions default to **Center at cut**. The timeline shows a labeled transition block with two draggable edges, a cut marker and diagonal warning bars when source handles run out. Drag the small marker at an eligible cut to create a centered transition, or use the toolbar. Double-click opens exact duration and alignment (Center / Start / End at cut). Delete removes the focused transition; Escape cancels a drag. Existing transitions retain their saved end-at-cut alignment until adjusted.

Both sides now use moving source footage outside the trims where available; only genuinely missing handles repeat edge frames. The preview and export share transition timing and source mapping. Effects remain active during the overlap, and frame grabs capture the composited picture. Audio and clip positions remain unchanged. These are Premiere-style timeline controls, not a complete implementation of every Premiere transition feature.

Additional checks: ten ffmpeg export cases including centered moving source handles, a marked range through the center, start-at-cut alignment and repeated edge frames; actual GPU preview and baker pixel comparisons; the actual Monitor canvas; effects retained during overlap; draggable edges, one save on release, Escape cancellation and Delete. The previous monitor scrubbing checks still pass.

Adobe references used for the interaction: [transition clip handles](https://helpx.adobe.com/premiere/desktop/add-video-effects/apply-video-transitions/video-transitions-using-clip-handles.html) and [insufficient-media indicators](https://helpx.adobe.com/uk/premiere/desktop/add-video-effects/apply-video-transitions/clip-handles-settings.html).

The new bulk-delete bridge requires a full app restart if the running process predates these changes; a renderer-only refresh cannot add a preload or main-process method.

## Verification

- Real project persistence: mixed deletion across all ten asset types, linked timeline/reference cleanup, a single Undo restoring the entire selection, Redo, media retained, and a final empty timeline retained when all timelines are deleted.
- Actual React controls in isolated hidden Electron: Ctrl-selection, mixed Bin/Library selections, right-click outside selection, batch delete payload, dissolve eligibility/duration/locked tracks/gaps/removal, actual Image Gen take drag payload, A/B reference drops, and protection against assigning a reference after the project changes.
- Actual Monitor with synthetic red/green/blue clips: the original code showed black frames for both same-clip and cross-clip seeks; the corrected code shows none in the sampled seeks and resolves the requested clip's pixels. Rapid scrubbing also settles.
- Existing export tests check decoded blend pixels, duration and audio, including a marked range through a dissolve and effects-baked transitions. Existing project, recovery, Watch and Voice checks remain in the test suite.
- No paid generation requests were made for these additions.

The hidden runtime did not complete a continuous six-second playback check: its media clock
stopped around half a second with both the previous and corrected Monitor. That check is not
claimed as passing. Seek/presentation checks use the actual decoder; live app confirmation
from the user covers the reported scrubbing flicker.

## Models worth adding next

I checked the app's existing model registry, the saved tool descriptions from the connected bridges on 10 September, and provider documentation. A bridge advertising a tool confirms an integration route; it does not prove account entitlement or a successful paid generation. None of the candidates below has been added to the selectors in this change.

| Use | Candidate and route | Why it fits / what is still needed |
| --- | --- | --- |
| Invent a character voice from a description | **ElevenLabs Voice Design via the Pika bridge** | The captured `clone_voice` tool has a `design` action that takes a prose voice description and returns a voice ID with an optional preview. This fits the Demonette voice workflow more directly than a preset voice picker. Voice IDs and previews need to be saved on Voice cards and connected to subsequent speech generation. |
| Alternative route for Seed Audio | **Seed Audio 1.0 via Higgsfield** | The connected bridge exposes audio generation and voice-cloning tools. Higgsfield lists Seed Audio, Eleven v3, MiniMax Speech 2.8 HD, VibeVoice and Seed Speech. Add a real VIA adapter and check its model capabilities rather than treating every model as supporting image-guided voice creation. Higgsfield distinguishes its Claude/MCP audio access from ChatGPT access. [Higgsfield's model and access list](https://higgsfield.ai/blog/unlimited-mcp). |
| Dialogue and narration | **Eleven v3 / Eleven Multilingual v2 via Runway** | The captured `generate_speech` tool offers these models with preset voices. It is a speech option; that particular tool does not expose new voice design. Runway's separate developer API supports custom voice creation, which would require a separate API integration and billing setup. [Runway custom voices](https://docs.dev.runwayml.com/characters/custom-voice/). |
| Another prompt-designed voice | **Qwen3-TTS Voice Design 1.7B via fal** | A dedicated voice-design endpoint is available. Worth comparing for described fictional voices, although this route still uses fal credits. [fal endpoint and input schema](https://fal.ai/models/fal-ai/qwen-3-tts/voice-design/1.7b/api). |
| Music | **Lyria 3 Pro / Lyria 3 Clip via Runway** | The captured `generate_music` tool offers full tracks and short music clips respectively. Its output lengths are fixed per model, so an integration should import the result and allow timeline trimming rather than promise an exact requested duration. A paid Runway workspace is required. |
| Targeted video-to-video editing | **Aleph 2.0 via Runway** | The captured `edit_video` tool supports targeted changes with an optional edited keyframe. This is the strongest additional editing route to evaluate beside the app's current Omni option. Captured limits: 2–30 seconds, up to 1080p/30 fps, at most ten shot changes; paid workspace required. [Runway model documentation](https://docs.dev.runwayml.com/guides/models/). |
| Sound effects or video-cued audio | **ElevenLabs SFX / Kling audio via Pika** | The captured music tool exposes sound-effect generation and Kling video-to-audio, useful for creature sounds, impacts and ambience. These deserve an explicit SFX workflow rather than being presented as character voice-design models. |

The app already lists MiniMax Music 3, Eleven Music, Sonilo, Beatoven and local music options. Lyria adds a different music family; adding another route to an existing music model is a billing/access improvement rather than a new creative capability.

Suggested order: character voice design and Higgsfield audio routing first, then Lyria music, then Aleph editing. Keep **VIA** visible throughout, with the relevant provider's credit source. Do not silently retry a failed paid request with another provider.

Local capability evidence: `%APPDATA%/vi-dancer/bridge-tools/pika.json`, `higgsfield.json`, and `runway.json` (tool descriptions captured 10 September 2026). No credentials are included in this report.
