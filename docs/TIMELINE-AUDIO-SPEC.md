# TIMELINE AUDIO — the complete system (2026-08-19)

> **STATUS: BUILT same day** (P1-P6 green; live shakedown = the user's next session). Build
> deltas from the approved text: (1) migration parks the converted music on its OWN NEW lane
> (guaranteed collision-free) instead of "first clear" — simpler, honest. (2) The legacy music
> strip + ♪ rail row stay RENDERED-BUT-GATED on un-migrated `tl.music` so a live session keeps
> playing until the restart converts; post-migration they can never appear, and the dead code
> path (AudioLane + Monitor music player + export music chain) is DELETE-ON-SIGHT in a cleanup
> pass once a migrated project is verified. (3) Score blocks got the keeper-take waveform over
> the covered stretch only — the hatched unrendered tail stays bare on purpose.

The one design for ALL audio on the timeline. Written after a day of reactive patches proved
the pieces were never designed as a whole (score lane → merge → collision → mutes → music
still special — each caught by the user, each a fragment). THIS document is the machine;
nothing audio ships that contradicts it. Canon check: WORKFLOW.md laws + Premiere mechanics.

## The model: ONE lane system, TWO item kinds, ZERO special rows

Audio lanes A1..An hold every sound in the movie. No music strip, no score lane, no special
rows. The rail manages tracks at the top; each lane mixes with M/S; blocks obey one grammar.

**Item kinds on the lanes:**

| block | tint | data | source of sound |
|---|---|---|---|
| linked companion | blue 🔗 | projection of its VIDEO block (not an item) | the take's embedded audio |
| clip audio | green | `TimelineAudioItem` w/ `source: {clipId, takeId}` | a take's audio window |
| library audio (NEW — absorbs music) | teal ♫ | `TimelineAudioItem` w/ `source: {audioId}` | a Library file (ProjAudio) |
| score span | purple ♪ | `TimelineScoreItem` | the score's keeper take (live-resolved) |

### Type changes (shared/types.ts, v20)

```ts
// TimelineAudioItem.source becomes a union — ONE item type carries both clip audio and
// Library files. Everything else (lane/startSec/in/out/gain/fades/volume/link) is shared.
source: { clipId: string; takeId: string } | { audioId: string }
beatGrid?: boolean // ♫ this file item drives the beat-snap grid (at most one per timeline)
```

`TimelineMusic` DIES. Migration v20 (main/project.ts, on load): `tl.music` → one
`TimelineAudioItem { source: {audioId}, lane: first clear (collision), startSec/inSec/outSec/
gain/volume carried, muted: tl.musicMuted, beatGrid: true }`, then `music` + `musicMuted`
cleared. One-way, stamped, idempotent.

**New power (was impossible):** multiple Library tracks at once — layered, cut, cross-faded.

## Grammar — one table, every audio block, no exceptions

| gesture | behavior |
|---|---|
| click | select (amber outline; Del removes; Esc clears). Score click also points the Score card. Blue companion click selects its VIDEO block (linked selection, Premiere). |
| double-click | toggle ITS lane's tall volume view (64px; band edits there) |
| drag | move — snap to playhead/cut edges (Shift off), vertical = change lane, landing on occupied ground hops to the first clear lane (grows the rail when all full) |
| left edge | head trim (in-point + position together; stops at the previous neighbor) |
| right edge | tail trim (stops at the next neighbor). Score: SPAN stretch (also sets the render target length) |
| right-click | actions: mute · fades · gain · remove + kind verbs (score: card/compose · file: ♫ beat grid · companion: unlink/insert-audio lives on the video block) |
| volume band | always drawn; Ctrl+click adds point, points drag (Shift = level only), point right-click: curve/delete/reset; line drag = whole-block gain while pointless |

Selection state: one `selectedLaneItemId` (kind-tagged) replaces `selectedScoreItemId`;
mutually exclusive with `selectedTlItemId`. Del: score/green/file = remove item; companion =
selects video block so Del removes the BLOCK (linked, honest).

**Waveforms everywhere** (LAW: sound is visible): green has one; blue companions, file items,
and score blocks (keeper take, window in..in+span) gain the same canvas wave, drawn at every
lane height. Dashed border stays = score with no take; hatched tail stays = span past
rendered audio.

## Collision (built 2026-08-19, extended to file items)

One lane, one occupant. The registry (companions + green + file + scores) checks every drop,
move-landing, and trim. Hop → first clear lane → grow `audioTracks` when none. Muted video
blocks hide their companion (silent audio holds no ground).

## Rail (top → bottom)

1. **Header cluster** (moves to TOP of sidebar): `+V · +A · −A` track management + `C` master
   clip-audio mute (the one true global — mutes every clip's embedded sound, playback+export).
2. V-tracks (unchanged).
3. Divider (unchanged).
4. A-lanes: `A1 [M][S]` … per-lane, heights follow per-lane expansion.
5. NOTHING ELSE. The ♪ music row, its M/C chips, the music strip, and the drag-music hint DIE.

Library music drag → drops directly onto any lane (hint lives in the Library panel + cheat
sheet, not as a dead strip).

## Beat-snap grid

Was: derived from `tl.music`. Now: from the file item flagged `beatGrid` (♫ badge on the
block; right-click toggles; flagging one unflags others). Default: the migrated music item /
the first file item placed. No file items → beat snapping disabled (magnet-♪ button dims).

## Playback (Monitor)

The special music `<audio>` + its tick loop DIE. File items play through the SAME
AudioItemPlayer as green items (file resolved from `project.audio` instead of a take). Every
player: `vol = gain × envGainAt(volume, t) × fades × mute × laneMute/solo`. Video blocks keep
their per-tick element volume (built).

## Export (main/export.ts)

The dedicated music chain DIES. One loop over `audioItems` handles both source kinds (file
path from `project.audio` for `{audioId}`), plus the score loop — all with lane mute/solo,
fades, gain, and the band expression (`envToFfmpegExpr`, byte-identical parity proven).
`audioEndSec` already covers items+scores; the `musicEndSec` input merges into it. Elastic
loop-tail "fill to the music end" semantics become "fill to the audio end" (same code path).

## What DIES (the full list)

`TimelineMusic` + `tl.musicMuted` (migrated) · `AudioLane` component + wave-view cycling (its
waveform/beat display is superseded by waves-on-blocks + the band; beat TICKS on the ruler
stay, fed by the beatGrid item) · `musicEndOf` (folds into `audioEndOf`) · the ♪ rail row ·
the drag-music hint · MIME_AUDIO's special lane handling (re-targeted to the lanes).

## Build order (each phase typechecks + builds green; core edits = app restarts, batch them)

- **P1** types v20 + migration + store/selection plumbing.
- **P2** lanes: file items render + Library drop + collision inclusion + waveforms on
  blue/file/score blocks.
- **P3** playback: file players via AudioItemPlayer, music player deleted; beat grid re-source.
- **P4** export rewire + end-math cleanup.
- **P5** rail: header cluster to top (+V +A −A + C), ♪ row/strip/hint deleted.
- **P6** selection unification + linked companion selection + cheat sheet + WORKFLOW.md
  audio section + live shakedown (drop two music files, layer, band, export, listen).

## Defaults chosen (veto any)

1. Multiple Library tracks allowed (the merge makes it real) — YES by default.
2. Beat grid = flagged file item, default the migrated/first one.
3. Companion click = linked selection (selects the video block), like Premiere.
4. The music block's old wave/beats expanded view is NOT rebuilt — waves live on blocks, beat
   ticks stay on the ruler.
