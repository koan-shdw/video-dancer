# Sound fx on the A tracks (2026-10-02)

His words: "why is it appearing in the scroe layer and not in the audio layer?" · "of course theyre clip
effect not score". A sound fx is a clip effect: it lives on the A tracks like any sound. The S tracks keep
only music (list 2 stands for scores).

## His seat

1. Drag a sound fx onto an A track (its Bin tile, or a take straight out of the SFX card). It lands on that
   A track, where it was dropped. Dropped on a V track or an S track, it goes to the first A track free at
   that spot, a new A track below the last when none is (eight at most), the way Premiere puts audio on
   audio tracks.
2. On the A track it is a sound fx block (pink) and does everything the other A blocks do: move, trim,
   razor, fades, the volume line, link to a clip, mute, disable, speed.
3. Not rendered yet: a hatched block. Its stretch is the footage Sonilo watches. Rendered: its waveform; a
   take shorter than the block plays and then silence (the hatched tail, like a score's).
4. The SFX card says to drag the sound onto an A track over the footage, and counts the blocks there.
5. A project that already has sound fx on S tracks: on open they move to A tracks, each to the first A
   track free at its spot, with the same start, length, take, gain, fades, volume line, mute and disable.

## Engine

- `shared/types.ts`: `TimelineAudioItem.source` gets a fourth kind, `{ sfxId: string; takeId?: string }`
  (no take = the sound fx's keeper). `SCHEMA_VERSION` 24.
- `shared/audioSource.ts`: `resolveAudioSource` takes the score clips; kind `sfx` = the take's file. Its five
  callers pass `project.scoreClips`: Monitor (playback), Timeline (block, waveform, length), main export.
- `panels/Timeline.tsx`: `dropScore` sends a sound fx to the A tracks (a score still to the S tracks). The A
  block draws a sound fx pink (`--sfx`), hatched where nothing is rendered.
- `shared/scoreRequest.ts`: a sound fx's span (Sonilo's footage) = its A block, the selected one when it has
  several.
- `panels/SfxCard.tsx`: the hint and the span count read the A blocks.
- `src/main/project.ts`: the v24 move (S block → A block). Deleting a sound fx takes its A blocks with it;
  deleting one of its takes puts those blocks back on the keeper; sending a timeline to another project
  copies the sound fx with it.
- `src/main/deleteSelection.ts`: a deleted sound fx takes its A blocks.
- `src/main/codirReach.ts`: the Co-Director places sound fx on A tracks, lists them there, and finds a
  footage render's span on the A block.
- `src/main/export.ts`: sound fx blocks mix like every A block (through the resolver).

## Proof

Window tests with the house styles: drops on A, V and S tracks; the pink hatched block; a sound fx's take
playing in the Monitor. Main checks: the v24 move on a copy of a project with sound fx on S tracks, the export
mix, Sonilo's span from an A block, the delete cascade. Then his test.
