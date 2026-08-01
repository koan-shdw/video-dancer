# Video Dancer — Feature Manual Addendum · v0.6 (2026-08-01)

> Companion to `feature-manual-2026-06-13.md` — everything user-facing that landed in the v0.6
> "Seedance everywhere" round. Same conventions: STATUS **[SHIPPED]** unless flagged, File:line
> citations into `src/`. Verified against live APIs where noted.

---

## A. Engines & suppliers

### A.1 Engine registry additions
| Feature | What it does | Notes | File:line |
|---|---|---|---|
| **Seedance 2.5 (fal)** | Full engine: 4K, every integer duration 4-15s+auto, image/video/audio refs | fal EARLY ACCESS — request on their model page; 403 until approved. No seed input (2.5 dropped it). Prices provisional until fal publishes rates (flagged in notes) | shared/models.ts `seedance25` |
| **Seedance 2 (ModelArk)** | Official ByteDance route: image+audio refs, first/last frame, 10-bit 4K | Video refs parked at 0 (their API wants public URLs — slots say so). Their policy: NO real human faces in refs. Token-billed → no $ estimate (law 8) | shared/models.ts `seedance2ark` |
| **Seedance 2 (Higgsfield)** | Adapter built + verified, engine HIDDEN | Live probe 2026-07-31: their platform API serves no Seedance model. `hidden: true` until they ship; old clips still resolve | shared/models.ts `seedance2hf` |
| **Provider dispatch** | Every engine carries `provider` ('fal' default / 'higgsfield' / 'modelark'); render, v2v tree gens, cancel and crash-recovery all route by it | PendingRender records the provider; resume asks the right platform | main/index.ts render:run · main/providers/* |
| **Hidden-engine rule** | Hidden engines leave the pickers but a clip already using one keeps it selectable | store-everything | RenderPanel.tsx engine select · VideoEditor.tsx VEDIT_ENGINES |
| **Seedance 2.0 seed verified** | seed:42 accepted AND echoed back by fal (live probe) | registry `seed: true` is correct | scripts/probe-seedance-refs.cjs |

### A.2 Supplier keys & onboarding
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Welcome walkthrough** | Plain-words "what is an API key" + one card per supplier: what it unlocks, billing, caveat, numbered get-a-key links, inline paste + save&test, ●/○ chips, skippable | first launch / About | WelcomeModal.tsx |
| **Settings → API suppliers card** | Collapsible card, `n/3 connected` summary, three bordered supplier rows with chips + free **test key** + **get a key ↗** | ⚙ Settings | SettingsModal.tsx |
| **Key validations (free)** | Authenticated no-ops — Higgsfield: status probe on a nil request; ModelArk: list-tasks page. Never spend credits/tokens | test key buttons | providers/higgsfield.ts validateHfKey · providers/modelark.ts validateArkKey |
| **Per-supplier header chips** | fal keeps the live $ chip; connected ModelArk/Higgsfield get `ARK ↗`/`HF ↗` console links (no balance APIs exist — no fake numbers) | auto when connected | App.tsx header |
| **No-key banner** | Now fires only when NO supplier is connected (any one supplier unlocks rendering) | auto | App.tsx |
| **Key storage** | `hfKey`, `arkKey` join the safeStorage-encrypted secret set | Save | main/index.ts SECRET_KEYS |

## B. Multimodal references (Clip Gen)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **@video ref slots** | Up to 3 video references per Seedance render — Library videos or ANY take. Positional wire tags `@video1…` worn as badges; prompt binds them ("Continue from @video1") | ref2v · + add, drag a Library video or T-chip in | RenderPanel.tsx video refs strip |
| **✂ ref windows** | Per-slot in/out window; render cuts the range (frame-accurate, deterministic temp = upload-cache-friendly) before upload. Caps clamp to the model max (15s combined) | ✂ on a slot | RenderPanel.tsx · main/index.ts resolveRefMedia |
| **@audio ref slots** | Up to 3 music windows as `@audio1…` — windows essential (songs are minutes, cap is 15s); non-mp3/wav converts automatically | + add, drag Library music in | RenderPanel.tsx audio refs |
| **Guard rails** | Pre-render errors: >15s combined, <2s videos, >12 ref files, audio-without-visual, dangling (deleted) sources named by slot; not-@mentioned slots warn yellow (case-insensitive) | auto | lib/validation.ts · RenderPanel check |
| **Parked-not-sent** | Engines without video/audio refs show the slots greyed with the reason — data kept, never silently sent | switch engine | RenderPanel.tsx (law 4/5) |
| **Snapshots carry refs** | Take snapshots freeze videoRefs/audioRefs; drag-restore brings them back; crash-recovery re-lands them | auto | shared/types.ts PromptData |

## C. Library videos & footage-first clips

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Video import** | `import video` button / drag mp4·mov·webm·m4v·mkv·avi into the Library. Probe → straight copy if already friendly, else ONE normalize to H.264 mp4 (short side ≤720) | Library | Library.tsx · main/project.ts importVideoFiles · main/export.ts probeVideo/normalizeVideo |
| **Video tiles** | First-frame thumb + film badge + duration chip, hover-scrub. PLAIN titles by design — `@video1` names belong to slot positions, so no collision | auto | Library.tsx VideoRow |
| **Right-click suite** | edit with AI (tree) · make clip (footage = take 1) · add as take to clip ▸ · rename · delete (use-count confirm) | right-click / double-click = edit | Library.tsx |
| **Make clip** | New footage-first clip: video copied into renders/ as take 1 + keeper; empty storyboard ready to write | menu / timeline drop | main/project.ts makeClipFromVideo |
| **Timeline drop** | Dragging a Library video onto a track auto-makes the clip and places it at the drop time (mirrors images) | drag onto timeline | Timeline.tsx dropOnTrack |

## D. Video Editor (non-destructive v2v tree)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Results tree** | One session per source (Library video OR take). Every Generate = a child node of the selection; branch anywhere; hover-scrub nodes; nothing reaches Bin/Library until baked | right-click video/take → edit with AI | VideoEditor.tsx · shared/types.ts VideoEditSession |
| **Two-mode composer** | EDIT (Omni Flash: frame-true, prompt+window ≤10s) vs RE-GEN (Seedance: source = `@video1` + image refs + extra videos + audio windows + duration/res/aspect out). Registry-driven; refs park greyed under Omni | engine select | VideoEditor.tsx |
| **Canon jogger** | The Clip Monitor's bar verbatim: 22px `--raised2`, seek wins everywhere (window region is click-transparent), invisible edge hot-zones trim, the **↔ pill** alone slides, imperative playhead+timecode (no per-frame re-render), centered mono timecode, in/out readout row | preview transport | VideoEditor.tsx (matches SourceMonitor.tsx:614-663) |
| **Window ≤ model max** | Drag clamps to the active engine's cap; switching engines snaps an oversized window down; ✂ popovers + audio fields clamp to 15s | auto | VideoEditor.tsx · RenderPanel.tsx |
| **Bakes** | Any node → NEW clip (take 1) · take on existing clip ▸ · Library videos (usable as @video ref — ingest→plan→stylize→re-reference loop closes). Lineage frozen in the take snapshot | right-click node (shared ContextMenu) | main/project.ts bakeVideoNode* |
| **◉ primary** | Library-video sources only: the Library entry wears a node's render (every @video ref follows), original remembered, revert any time. Takes are immutable → they bake instead | node menu | main/project.ts setVideoPrimaryNode |
| **Delete branch** | Node + descendants + files (baked copies survive); the ◉ branch refuses with the reason | node menu | main/project.ts deleteVideoEditBranch |
| **Queue kind `vedit`** | Tree generations queue like renders/edits — ETA, cancel, spend ledger, crash recovery | ▶ Generate | store.ts pumpQueue · main/index.ts vedit:run |

## E. Chrome & housekeeping

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Open-picker right-click** | open · rename (open project via live state+undo; closed via atomic project.json rewrite; folders never move) · duplicate (full copy → "name copy", joins recents) · reveal · remove from list · delete → **Recycle Bin only** (open project refuses with reason) | right-click a card | App.tsx picker menu · main/index.ts project:*At |
| **Settings 4-card layout** | api suppliers / co-director (key+model+guides+bridge) / theme / maintenance — collapsible bordered cards; API card auto-opens only when nothing is connected; Save bar states it saves keys only | ⚙ Settings | SettingsModal.tsx |
| **ui/Section** | THE shared legend/section recipe (collapsible as a prop) — closes half the "one legend recipe" gap (Clip Gen migration tracked separately) | — | ui/Section.tsx |
| **One input recipe** | SettingsModal's private `ctl` copy deleted — imports ui/controls | — | SettingsModal.tsx (gap-09) |
| **Co-Director model refresh** | Opus 5 replaces 4.8 in both engines' lists; Sonnet 5 intro pricing labeled; saved-but-retired model ids fall back to the default instead of a blank dropdown | — | main/codir.ts · main/codirBridge.ts · CoDirector.tsx |

## F. Live-verification ledger (honesty section)

| Path | Status |
|---|---|
| Seedance 2.0 + video refs via fal | **VERIFIED LIVE** (paid probe: video_urls bound, seed echoed) |
| Seedance 2.5 renders | Blocked on fal early-access approval (schemas verified) |
| Higgsfield auth + catalog | **VERIFIED LIVE** (key works; no Seedance served → engine hidden) |
| ModelArk render (content[] shape, dated model id) | Awaits a BytePlus account + first probe render |
| Video Editor generation (vedit) | Code-complete; first paid gen is the live proof |
