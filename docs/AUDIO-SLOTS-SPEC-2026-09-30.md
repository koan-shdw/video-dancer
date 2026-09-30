# Sound effects, lip-sync, music refs (list 22, 23, 24): what exists, and the questions

Date: 2026-09-30 · Status: RESEARCH DONE, nothing built. Each part needs one answer from him
before a build: where it lives. Every supplier fact below was read on its own page that day.

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
