# Sound effects, lip-sync, music refs (list 22, 23, 24): what exists, and the questions

Date: 2026-09-30 · Status: RESEARCH DONE, answered 09-30, nothing built. Every supplier fact
below was read on its own page that day. He asked on 09-30 for the obvious questions to be answered for him. An answer in quotes is his own.

---

## 22. Sound effects

His pick 09-29 (supplier review #8: "yes"). A new slot.

**What exists**

| who | what it takes | what it gives | runs on |
|---|---|---|---|
| Sonilo v1.1 (`sonilo/v1.1/video-to-sound-effects`) | a video, an optional prompt, optional timed segments | the sound only (wav / mp3 / aac / flac) | fal key |
| Mirelo SFX 1.6 (`mirelo-ai/sfx1.6/video-to-video`) | a video, an optional prompt, up to 60 s | the video with the sound mixed in, 2 variations | fal key |
| ElevenLabs sound effects (`POST /v1/sound-generation`) | words only, 0.5 to 30 s, can loop | the sound only | ElevenLabs key |
| Pika Soundtrack / SFX | a video, or words | a soundscape, or clips to 20 s | a Pika key (not in the app) |

**What fits the app as it is**
- Sonilo is the same family Score already uses for music from the footage: the score span is
  rendered as a small proxy, uploaded, and the sound comes back as a track. Its effects door
  works the same way and returns sound only, so it lands as an audio take like a score does.
- ElevenLabs makes a sound from words. That is a Library ♪ file, no footage needed.

**Questions**
1. Where does it live: a third kind inside Score (music, and now effects from the footage), its
   own card beside Score and Voice, or a right-click on a timeline clip ("make its sound")?
2. Both kinds, or one first: effects made from the footage (Sonilo), effects made from words
   (ElevenLabs)?

**Answers (09-30)**
1. Its own card beside Score and Voice, built the way Score is (a span on the timeline for the
   footage kind). His pick called it "a new slot".
2. Both kinds.

**Built (09-30), untested by him, unproven against fal and ElevenLabs**
- **The card.** "SFX Gen" in the Window menu (`panels/SfxCard.tsx`): name, model, the words,
  moments, the outgoing content, takes with keepers, Render now / Queue.
- **What a sound fx is.** A score clip of kind `sfx` (`ScoreClip.kind`). So the Bin (it sits with
  the scores, tagged "sound fx"), the S tracks, takes, keepers, export, duplicate and
  send-to-project already know it. Double-click, a click on its timeline block and "open score
  card" all land in the SFX card: one setter (`setEditorScore`) points the right card.
- **From the footage** (`sonilo-sfx`, `sonilo/v1.1/video-to-sound-effects`): the span under the
  sound is rendered as the small proxy Score already makes for Sonilo's music, uploaded, and the
  sound comes back as a take. The words are its `prompt`; each moment is a `segments` entry
  (the first starts at 0, each ends where the next begins). No span = the reason on the card.
- **From words** (`eleven-sfx`, `POST /v1/sound-generation`): `text`, and only when set:
  `duration_seconds` (0.5 to 30), `prompt_influence`, `loop`. No span needed.
- **Tests.** `scripts/test-score.cjs` (the two requests, the span upload, the clip kind),
  `scripts/test-sfx-browser.cjs` (`npm run test:sfx-ui`).
- **Not built.** Mirelo (it returns a video with the sound mixed in, not a sound), Pika (needs a
  Pika key), a right-click "make its sound" on a timeline clip.

---

## 23. Lip-sync

His pick 09-29 (supplier review #9: "yes"). A new slot.

**What exists** (all on the fal key)

| who | what it takes | what it gives |
|---|---|---|
| sync-3 (`fal-ai/sync-lipsync/v3`) | a video + an audio; a rule for a length mismatch (cut off, loop, bounce, silence, remap) | the video, mouths re-timed |
| VEED Lipsync v2 (`veed/lipsync/v2`) | a video + an audio | the video, mouths re-timed |
| H3 Max Lip Sync (`minimax/h3-max/lip-sync/image-to-video`) | an image + an audio (5 s to 15 min), 480p to 2K | a new talking video from the still |

**What fits the app as it is**
- Video + audio → video is an edit of a take, the Video Editor's shape: a take (or a timeline
  block) plus a voice take or a ♪ track, and the result lands in that take's tree.
- Image + audio → video is a generation, Clip Gen's shape: a Library image and a voice take.

**Questions**
1. Where does it live: the Video Editor (a take + a voice = the same take, lips matched), a
   right-click on a timeline block that has a voice under it, or both?
2. Which first: re-timing the mouths of a take he already has (sync-3 / VEED), or making a
   talking shot from a still and a voice (H3 Max)?

**Answers (09-30)**
1. Both: the Video Editor, and a right-click on a timeline block with a voice under it.
2. Both kinds. Re-timing a take comes first.

**Built (09-30), untested by him, unproven against fal**
- **Re-timing a take** = two engine rows in the Video Editor (`sync3`, `veedlipsync`; a `v2v`
  door with `lipsync`). The composer swaps the words for a voice pick (Bin voices that have a
  take, Library tracks; from/to seconds) and, on sync-3, the mismatch rule (`sync_mode`: cut off,
  loop, bounce, silence, remap). Sent: `{ video_url, audio_url[, sync_mode] }`, no prompt. The
  voice is resolved in main the way an @audio ref is (window cut, mp3). The result is a tree node.
- **From the timeline**: a block with a Library sound under it gets "lip-sync this take to ♫ …".
  It opens the Video Editor on sync-3 with that sound picked; the video window and the sound
  window are the stretch where the two overlap. (A Bin voice does not sit on the timeline, so the
  entry reads the Library sounds on the A tracks.)
- **A talking still** = a Clip Gen model (`h3maxlipsync`, family "H3 Max Lip Sync (a talking
  still)"): ref2v with exactly one picture and one audio ref. Sent: `{ image_url, audio_url,
  resolution }`. The form names what is missing; the cost line uses the voice's seconds and the
  1.2x over 15 s.
- **Tests.** `scripts/test-lipsync.cjs` (in `npm test`), `scripts/test-lipsync-browser.cjs`
  (`npm run test:lipsync-ui`).

---

## 24. Music refs in Score

His words (09-20): "it lets you put in monusc and alter it, so we'll want to make adjustments to
score so we can use music refs".

**What exists on engines the app already has**
- **ACE-Step 1.5 (local, free).** Its own API has the tasks for it: `cover` (the track is kept and
  re-made in a new style; `audio_cover_strength` 0 to 1, low = a loose style transfer), `repaint`
  (one stretch of the track is re-made, by start and end second), and a plain style reference
  (`reference_audio`). The app only uses its text-to-music task today.
- **ElevenLabs Music v2 / v2.5 (his key).** A track is uploaded once (`POST /v1/music/upload`
  answers with a `song_id`); each section of the plan can then lean on a stretch of it
  (`conditioning_ref: { song_id, range }`, strength low / medium / high / xhigh). ElevenLabs
  checks uploads for copyright.
- **Not possible:** MiniMax Music 3 (no audio input on fal), Lyria 3.5 (text and images only),
  Beatoven, Sonilo (its reference is the footage).
- **Outside the app:** Pika Music takes a track reference (needs a Pika key).

**What a build would be**
- Score gets a "music ref" box (the Voice card's clone-sample box: drop or pick a Library ♪
  track), greyed with the reason on engines that can't take one.
- ACE-Step: a strength dial (keep the tune ↔ only the style). ElevenLabs: the ref rides every
  section of the plan at one strength.

**Questions**
1. "Alter it": keep the tune and change how it sounds (a cover), or use the track only as a
   style guide for a new piece? Or both, by the strength dial?
2. Start with ACE-Step (free, local), ElevenLabs (his credits), or both?

**Answers (09-30)**
1. Both, by the strength dial: from "keep the tune" to "only the style".
2. Both engines.
