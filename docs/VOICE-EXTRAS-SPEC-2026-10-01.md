# VOICE EXTRAS (list 44), spec of 2026-10-01

His words, list 44: "Clip Gen fills an @audio slot when a sheet links a voice, dialogue vs timbre
slot modes with a duration lock, a render-dialogue flow." They are the three parked blocks of
`VOICES-SPEC-2026-08-20.md` ("PARKED (blocks 4-5)"). His pick 10-01: "finish the remaining todo".

The types were laid down on 08-20 and never used by Clip Gen: `AudioRef.voiceId` (a Bin voice; its
playing take sends), `AudioRef.role` ('dialogue' | 'timbre', absent = timbre on a voice) and
`AudioRef.fromSheetId`. Main already sends a voice slot (`resolveRefMedia`), the Co-Director already
sets voice slots and roles (`set_clip_refs`), and deleting a voice already clears its slots.

## 1. The slot a sheet brings

- Linking a char sheet in Clip Gen (CHARACTERS → link) whose VOICE box holds a voice adds one
  @audio slot: that voice, tagged with the sheet (`fromSheetId`). One per sheet. A row already
  holding 3 slots (Seedance's cap) adds none and says so.
- Unlinking the sheet takes its slot away. ✕ on the slot removes it by hand; the link stays.
- The slot chip: 🎤 · @audioN · the voice's name · ⛉ the sheet · the role pill · 🎤 render
  dialogue · ✂ · ✕. Its length is the voice's playing take. Double-click opens the voice in the
  Voice card.
- The ＋ box lists the Bin's voices under the Library tracks, and a 🎤 voice dragged from the Bin
  onto the audio refs adds a slot (both without a sheet tag).
- The voice's description becomes the linked character's voice line
  (`character_modeling.<char>.voice`, or the same line in the other prompt styles) when the
  sheet's own "voice description" is empty. Typed text on the sheet wins.

## 2. Timbre or dialogue

- A voice slot wears a role pill: timbre (the default) ↔ dialogue. A Library track slot cycles
  ref → timbre → dialogue (ref = a plain reference, music or sound, nothing added).
- The prompt says what each voice slot is, one line per slot, in the reference handling (every
  prompt style carries it):
  - timbre: "@audio1 is Kai's voice: Kai speaks in it (its sound, accent and pace); the words are
    the dialogue lines."
  - dialogue: "@audio1 is Kai's dialogue, word for word: Kai says exactly this audio, lips in sync
    with it."
  - The speaker is the sheet's character (the tag, or a linked sheet bound to that voice);
    unknown = "the speaking character".
  - Only slots that are sent get a line (ref2v on an engine that takes audio refs).
- Timbre: the pill's tooltip carries the drift hint (the words come from the text, so the delivery
  can drift from the voice).
- Dialogue: the clip's length locks to the slot's audio, rounded up to the engine's next length
  (Seedance 2: 6.2 s → 7 s; 8.3 s → 10 s). Two dialogue slots: the longest decides. The
  duration box wears 🔒 with the reason. Another length is still allowed and raises a preflight
  flag (the amber ⚑ above the render button, also in the Co-Director's read): the words run past
  the end, or the clip runs on past them, or the length is auto. Audio longer than the engine's
  longest clip is flagged too.

## 3. Render dialogue

- A voice slot has "🎤 render dialogue": the beats' dialogue lines spoken by the slot's
  character (a beat whose text names that character; with one voice slot in the clip, every
  dialogue line) are joined in beat order and rendered through the voice: its engine, recipe,
  sample and kept supplier voice, exactly as a Voice card take, with these words in place of the
  test line. It rides the queue (a voice row); the price shows on the button where the engine
  has a character rate.
- The result lands in the Library as "<voice> · dialogue · <clip>", not as a voice take. The slot
  flips to that track in dialogue mode (the sheet tag stays), and the clip's length locks to it.
  An open Clip Gen reloads the clip.
- Greyed with the reason: the clip isn't in the Bin yet, or no beat has a dialogue line for that
  character.
- A crash mid-render: the paid audio is collected on the next open the way every voice render
  is (as a take of the voice).

## Not in this build

- Seed Audio ambience or foley mixed into the dialogue track (the 08-20 note's aside).

The Co-Director keeps UI parity the way its sheet links already pull the sheet's image: its
`character_links` write adds the sheet's voice slot and drops the slot of a sheet it unlinks.

## Wire facts

No supplier field carries the role: it is said in the prompt line and kept in the length. A
dialogue slot is sent like any audio ref (MP3/WAV, ≤15 s combined, needs an image or video ref).
