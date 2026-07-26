# Timeline v2 — Premiere-track overhaul (build plan)

Restore point: git `d46f8e8`. User project backed up: `SNAKE QUEEN/project.json.pre-v14.bak`
(+ bare migration test copy in `..\_MIGRATION_TEST`). Work phase-by-phase; typecheck + build
gate after each phase. Mark phases done here as they land.

## Locked scope
Tracks model (gaps + multi video tracks + add/delete tracks), always-visible linked/unlinked
audio (tints), global-clock A/B playback, export compositing, wheel scroll + ctrl/alt zoom,
ripple delete + close gap, Ctrl+K razor, Alt+drag duplicate, frame nudges, per-track mute/solo,
Shift-disables-snap, marquee multi-select, cross-dissolves, audio fades + gain, markers,
in/out range (+ loop playback of it), autoscroll, snap flash, speed control, JKL shuttle,
track lock, rolling trim, zoom hotkeys, safe-area guides, takes-card redesign
(bigger cards + color highlight + disable), take snapshot restore stays.

## Model decisions (v14)
- `TimelineItem` gains: `startSec` (absolute), `track` (0-based video track), `speed?` (1 = normal),
  `transitionOutSec?` (cross-dissolve INTO the next overlapping/adjacent block),
  `audioDetachedId?` — when its audio was unlinked, the TimelineAudioItem id (drives tint + menu).
- Linked audio is DERIVED (no persistence): every video block renders a companion audio block that
  mirrors it; unlink converts to a real `TimelineAudioItem` (existing machinery, "free" tint).
- `TimelineAudioItem` gains: `gain?` (0..2, default 1), `fadeInSec?`, `fadeOutSec?`.
- `Take` gains: `color?`, `disabled?`.
- `Timeline` gains: `videoTracks` (default 1), `audioTracks` (default 3), `markers?: {id,at,name,color}[]`,
  `rangeInSec?`, `rangeOutSec?`, `lockedTracks?: string[]` ('v0','a1',…), `soloTracks?`, `mutedTracks?`.
- Playback becomes a GLOBAL CLOCK (`tlTime` seconds) in the store; tlIndex/tlProgress derived for
  legacy consumers during transition.
- Migration: `startSec` = old cumulative starts, `track` = 0; visually identical on open.
- No same-track overlap EXCEPT the dissolve overlap window; topmost occupied video track wins.

## Phases
- [x] 1. shared/types v14 + main migration + main-side geometry helpers rewritten (starts map,
        overlap rules) + all main mutations that assumed sequence order (slice, place-at-index,
        linked-audio sync) moved to absolute time. Gate: typecheck+build + migration test on copy.
- [x] 2. timelineUtils rewritten around absolute time (resolveAt(T), track stacking, gaps);
        store playback state → global clock; transport/copy-paste/nudge/razor keys remapped.
- [x] 3. Timeline panel UI: track rails (add/delete/mute/solo/lock), free drag + cross-track drag,
        snapping (+shift-off, snap flash), marquee, ripple delete/close gap, Alt-drag dup,
        rolling trim, markers, in/out range, wheel scroll + ctrl/alt cursor zoom, zoom hotkeys,
        autoscroll, dissolve handles, audio companion blocks (linked tint) + fades/gain handles.
- [x] 4. Monitor: global-clock A/B double-buffered player, track resolution at T, dissolve preview
        (crossfade opacity), speed playbackRate, JKL, loop range, safe-area guides; mirror relay kept.
- [x] 5. export.ts: absolute-time compositing (gaps=black, topmost track wins, xfade dissolves,
        speed via setpts/atempo, audio items + linked audio + music with fades/gain amix).
- [x] 6. Takes cards redesign in Clip Gen (+ Take.color/disabled through pickers/keeper fallback).
- [x] 7. Full pass: typecheck, build, migration test, update this file, hand over.

## Shipped 2026-07-26 — honest flags
- Export dissolves = fade-out DIP (not a true crossfade); the Monitor previews a true cross.
  True xfade in ffmpeg needs per-pair xfade graphs — noted as a future upgrade.
- J key = jump back 5s, not true reverse shuttle (HTML video can't reverse-play reliably).
- Migration verified structurally + on a copy; the real acceptance test is opening SNAKE QUEEN
  (backups: project.json.pre-v14.bak, git d46f8e8).
- First real EXPORT after this overhaul is the export-path acceptance test.
