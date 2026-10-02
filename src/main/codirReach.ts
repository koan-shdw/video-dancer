// list 27 (2026-09-30) — the Co-Director's REACH beyond clips and Image Gen: Clip Gen's dials,
// takes, Score and sound fx, Voice, the audio and score tracks of a timeline, Image Edit and the
// Video Editor (both through fire_render), Library housekeeping. The same contract as codir.ts:
// every write goes through the project.ts mutators the UI uses (so it is undoable and
// delta-merged), and anything that SPENDS stays behind fire_render's two gates there.
// What stays with the director by his own answers (docs/CODIRECTOR-REACH-2026-09-30.md §4): keys,
// logins, model downloads, switching a MOOD on, deleting anything whose file goes with it, and
// undo (his key, never the model's).
import {
  setClipPromptData,
  setTakeMeta,
  setScoreTakeMeta,
  setVoiceTakeMeta,
  setImageGenTakeMeta,
  deleteTake,
  cloneClipFromTake,
  newClipsFromImages,
  newScoreClip,
  setScoreClipData,
  setScoreKeeper,
  duplicateScoreClip,
  deleteScoreClip,
  newVoiceClip,
  setVoiceClipData,
  setVoiceKeeper,
  deleteVoiceClip,
  setTimelineAudioItems,
  setTimelineScoreItems,
  setTimelineMeta,
  setTimelineExportPrefs,
  setTimelineMutes,
  setPrimaryNode,
  duplicateImage,
  renameAudio,
  renameVideo,
  setAudioDuration,
  setAssembly
} from './project'
import { probeVideo } from './export'
import { randomUUID } from 'crypto'
import { MODELS, modelFor } from '@koan/vidancer-ui/shared/models'
import { AUDIO_MODELS, audioModelFor } from '@koan/vidancer-ui/shared/audioModels'
import { PICKABLE_IMAGE_MODELS, imageModelFor, imageViaFor } from '@koan/vidancer-ui/shared/imageModels'
import { scoreRenderRequest } from '@koan/vidancer-ui/shared/scoreRequest'
import { keepersOf } from '@koan/vidancer-ui/shared/keepers'
import type { Project, ProjectDelta, PromptData, VideoRef, AudioRef, ScoreClip, VoiceClip, ScoreRecipe, VoiceRecipe, TimelineAudioItem, TimelineScoreItem, CoDirLiveWrite, VeditArgs, EngineId } from '@koan/vidancer-ui/shared/types'

const snip = (s: unknown, n = 220): string => {
  const v = String(s ?? '').trim()
  return v.length > n ? v.slice(0, n) + '…' : v
}
const low = (s: unknown): string => String(s ?? '').trim().toLowerCase()
const bare = (s: unknown): string => low(s).replace(/^@/, '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// ---- finding things the way the director names them: an id, else the exact name / @title ----
const clipBy = (p: Project, v: unknown) => p.clips.find((x) => x.id === v) ?? p.clips.find((x) => low(x.name) === low(v))
const imageBy = (p: Project, v: unknown) => p.images.find((x) => x.id === v) ?? p.images.find((x) => bare(x.title) === bare(v))
const audioBy = (p: Project, v: unknown) => (p.audio ?? []).find((x) => x.id === v) ?? (p.audio ?? []).find((x) => bare(x.title) === bare(v))
const videoBy = (p: Project, v: unknown) => (p.videos ?? []).find((x) => x.id === v) ?? (p.videos ?? []).find((x) => bare(x.title) === bare(v))
const scoreBy = (p: Project, v: unknown) => (p.scoreClips ?? []).find((x) => x.id === v) ?? (p.scoreClips ?? []).find((x) => low(x.name) === low(v))
const voiceBy = (p: Project, v: unknown) => (p.voiceClips ?? []).find((x) => x.id === v) ?? (p.voiceClips ?? []).find((x) => low(x.name) === low(v))
const timelineBy = (p: Project, v: unknown) => p.timelines.find((x) => x.id === v) ?? p.timelines.find((x) => low(x.name) === low(v))
const takeN = <T extends { id: string }>(takes: T[], n: unknown): T | undefined => takes[Math.round(Number(n)) - 1]
const playing = <T extends { id: string; disabled?: boolean }>(c: { takes: T[]; keeperTakeId?: string }): T | undefined =>
  c.takes.find((t) => t.id === c.keeperTakeId && !t.disabled) ?? [...c.takes].reverse().find((t) => !t.disabled)

const SCORE_ENGINES = Object.values(AUDIO_MODELS).filter((m) => (m.kind === 'music' || m.kind === 'sfx') && !m.hidden)
const VOICE_ENGINES = Object.values(AUDIO_MODELS).filter((m) => m.kind === 'voice' && !m.hidden)
const EDIT_ENGINES = Object.values(MODELS).filter((m) => !m.hidden && (m.v2v || m.maxRefVideos > 0))

const refProps = { in_sec: { type: 'number', description: 'start of the part to send, seconds into it' }, out_sec: { type: 'number' } }

export const REACH_TOOLS = [
  {
    name: 'set_clip_settings',
    description:
      "Set a clip's Clip Gen DIALS — everything in the panel but the prompt fields, the beats and the image refs, which have their own tools. Send ONLY what should change. mode (ref2v = references · i2v = a start frame · t2v = words only) · resolution and aspect_ratio (must be ones the clip's engine makes; the engine itself is set_clip_fields) · sound (the engine renders audio) · negative (what must never appear; real on the local LTX full model only) · draft (Seedance 2.5: a cheap 480p draft the director can finish at 1080p) · start_frame / end_frame (Library @titles, i2v; null clears) · video_refs and audio_refs (each REPLACES its list; @video1…/@audio1… are by position, and you must role-bind them in the prompt) · loras / loras_on and ltx_size (the local video engines) · prompt_link (splice another clip's freeform before or after this one's; null unlinks) · beat_pictures (the placeholder picture on a beat's storyboard frame: display only, never sent). This never renders.",
    input_schema: {
      type: 'object',
      properties: {
        clip_id: { type: 'string', description: 'clip id (an exact name also resolves)' },
        mode: { type: 'string', enum: ['ref2v', 'i2v', 't2v'] },
        resolution: { type: 'string' },
        aspect_ratio: { type: 'string' },
        sound: { type: 'boolean' },
        negative: { type: 'string' },
        draft: { type: 'boolean' },
        start_frame: { type: ['string', 'null'], description: 'a Library @title — the first frame (i2v)' },
        end_frame: { type: ['string', 'null'], description: 'a Library @title — the last frame (i2v, engines that take one)' },
        video_refs: {
          type: 'array',
          items: { type: 'object', properties: { video: { type: 'string', description: 'a Library video title' }, clip: { type: 'string', description: 'or a clip (name or id) …' }, take: { type: 'number', description: '… and its take, 1-based (omit = the take that plays)' }, ...refProps }, additionalProperties: false }
        },
        audio_refs: {
          type: 'array',
          items: { type: 'object', properties: { audio: { type: 'string', description: 'a Library audio title' }, voice: { type: 'string', description: 'or a Bin voice (name or id): its playing take is what sends' }, role: { type: 'string', enum: ['dialogue', 'timbre'], description: 'a voice: dialogue = the exact track, lip-synced · timbre = the voice character only' }, ...refProps }, additionalProperties: false }
        },
        loras_on: { type: 'boolean' },
        loras: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, weight: { type: 'number' } }, required: ['name'], additionalProperties: false } },
        ltx_size: { type: 'string', description: 'the installed local size id to pin; empty = the best installed' },
        prompt_link: { type: ['object', 'null'], properties: { clip: { type: 'string' }, pos: { type: 'string', enum: ['before', 'after'] } }, additionalProperties: false },
        beat_pictures: { type: 'array', items: { type: 'object', properties: { beat: { type: 'number', description: '1-based beat number' }, image: { type: ['string', 'null'], description: 'a Library @title; null clears it' } }, required: ['beat'], additionalProperties: false } }
      },
      required: ['clip_id'],
      additionalProperties: false
    }
  },
  {
    name: 'set_take_flags',
    description: "Mark a take: a colour and/or disabled (a dud: dimmed, skipped when no keeper is flagged). kind says whose take — a clip's, a score's (or sound fx's), a voice's or an image gen's. take is 1-based. The take's file and recipe never change. Keepers are set_keeper_take.",
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['clip', 'score', 'voice', 'image_gen'] },
        id: { type: 'string', description: 'its id (an exact name also resolves)' },
        take: { type: 'number' },
        color: { type: ['string', 'null'], description: 'a CSS colour like #e05656, or null to clear' },
        disabled: { type: 'boolean' }
      },
      required: ['kind', 'id', 'take'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_take',
    description: "Remove one take from a CLIP — only when the director asks. Its video file stays on disk and the director can undo. Timeline blocks pinned to it go; the rest fall back to the keeper.",
    input_schema: { type: 'object', properties: { clip_id: { type: 'string' }, take: { type: 'number', description: '1-based' } }, required: ['clip_id', 'take'], additionalProperties: false }
  },
  {
    name: 'clip_from_take',
    description: "Make a NEW clip out of one take: the take's frozen recipe becomes the new clip's live recipe and the take rides along as its first take. Returns the new clip_id. The way to branch from a take that worked.",
    input_schema: { type: 'object', properties: { clip_id: { type: 'string' }, take: { type: 'number', description: '1-based; omit = the take that plays' } }, required: ['clip_id'], additionalProperties: false }
  },
  {
    name: 'clips_from_images',
    description: 'Make one storyboard clip per Library image (each image becomes that clip’s reference). Returns the new clip ids, in order.',
    input_schema: { type: 'object', properties: { image_titles: { type: 'array', items: { type: 'string' } } }, required: ['image_titles'], additionalProperties: false }
  },
  {
    name: 'create_score',
    description: "Create a SCORE (music, the Score card) or a SOUND FX (kind=sound_fx, the SFX card) in the Bin. Returns its score_id. Fill it with set_score, put it on a timeline with set_timeline_scores, render it through fire_render (kind=score).",
    input_schema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['music', 'sound_fx'] } }, additionalProperties: false }
  },
  {
    name: 'set_score',
    description:
      `Write a score or a sound fx (read it first with read_object). Send ONLY what should change. model — music: ${SCORE_ENGINES.filter((m) => m.kind === 'music').map((m) => `${m.id} (${m.label})`).join(', ')} · sound fx: ${SCORE_ENGINES.filter((m) => m.kind === 'sfx').map((m) => `${m.id} (${m.label})`).join(', ')}. style = the style prompt every music engine reads (for a sound fx: the words that describe the sound). beats REPLACE the list: "at second X, the music does Y" (for a sound fx made from footage: a moment gives its stretch its own sound). lyrics are SUNG word for word (instrumental=false). length_sec = the piece's length. To score from the cut, watch_timeline the span first and write the beats yourself. music_ref = a Library audio title the music is made from (ACE-Step, ElevenLabs Music; null clears), with music_ref_from (seconds) and music_ref_strength (0 = only its style, 1 = keep the tune). pictures = Library @titles the music follows (Lyria; REPLACES the list). Sound fx from words: sound_length_sec (0.5 to 30, 0 = the model picks), loop, follow_words (0 to 1). This never renders.`,
    input_schema: {
      type: 'object',
      properties: {
        score_id: { type: 'string', description: 'score id (an exact name also resolves)' },
        name: { type: 'string' },
        model: { type: 'string', enum: SCORE_ENGINES.map((m) => m.id) },
        style: { type: 'string' },
        lyrics: { type: 'string' },
        instrumental: { type: 'boolean' },
        length_sec: { type: 'number' },
        beats: { type: 'array', items: { type: 'object', properties: { at: { type: 'number', description: 'seconds from the start' }, text: { type: 'string' } }, required: ['at', 'text'], additionalProperties: false } },
        music_ref: { type: ['string', 'null'] },
        music_ref_from: { type: 'number' },
        music_ref_strength: { type: 'number' },
        pictures: { type: 'array', items: { type: 'string' } },
        sound_length_sec: { type: 'number' },
        loop: { type: 'boolean' },
        follow_words: { type: 'number' }
      },
      required: ['score_id'],
      additionalProperties: false
    }
  },
  {
    name: 'create_voice',
    description: "Create a VOICE in the Bin (a character's voice: takes stack under it, the playing take IS the voice). Returns its voice_id. Fill it with set_voice, render a take through fire_render (kind=voice), bind it to a char sheet in the UI.",
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'set_voice',
    description:
      `Write a voice (read it first with read_object). Send ONLY what should change. model: ${VOICE_ENGINES.map((m) => `${m.id} (${m.label})`).join(', ')}. description = what the voice IS (it also rides into the prompt of every clip whose char sheet binds this voice). test_line = the words every take reads; tags like <sigh> go in it on the Gemini engines. image = the character's Library @title (Seed Audio hears it). sample = a Library audio title to copy the voice from; consent = the Library audio of the same speaker reading Google's consent statement (Gemini copies a sample only with it). ready_voice = one of the engine's own voices ('' = a new voice from the description or sample). style = how the line is delivered (Gemini; steered, never read). second_speaker = another voice of this project by name, or a ready voice (Gemini: the test line is then a dialogue, each line starting "Name:"); null = one speaker. null on image / sample / consent clears it. This never renders.`,
    input_schema: {
      type: 'object',
      properties: {
        voice_id: { type: 'string', description: 'voice id (an exact name also resolves)' },
        name: { type: 'string' },
        model: { type: 'string', enum: VOICE_ENGINES.map((m) => m.id) },
        description: { type: 'string' },
        test_line: { type: 'string' },
        image: { type: ['string', 'null'] },
        sample: { type: ['string', 'null'] },
        consent: { type: ['string', 'null'] },
        ready_voice: { type: 'string' },
        style: { type: 'string' },
        second_speaker: { type: ['string', 'null'] },
        language: { type: 'string' }
      },
      required: ['voice_id'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_item',
    description: 'Delete a score (or sound fx) or a voice from the Bin — only when the director asks. Its timeline blocks go with it; the audio files stay on disk and the director can undo. (Clips, styles, char sheets and timelines have their own delete tools. Library files and image gens stay the director’s to delete.)',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['score', 'voice'] }, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false }
  },
  {
    name: 'set_timeline_audio',
    description:
      "Lay LIBRARY AUDIO and SOUND FX on a timeline's audio tracks (A1, A2…): a recorded line, a sound, a music file, a sound fx. REPLACES every Library-audio and sound-fx block on the timeline with the list you send (send the full list; [] clears them). Sound that belongs to the video clips themselves is never touched. Each entry: audio (a Library audio title) OR sound_fx (a sound fx name or id), start_sec (where it starts on the timeline), track (1 = A1). Library audio: optional in_sec/out_sec (the part of the file that plays). A sound fx: span_sec (how long its block runs; one made from the footage makes the sound of exactly this stretch), optional take (1-based; omit = the take that plays). Both: gain (1 = as recorded, 0 to 2), fade_in_sec / fade_out_sec, muted. Sound fx live on the audio tracks, never the score tracks.",
    input_schema: {
      type: 'object',
      properties: {
        timeline_id: { type: 'string', description: 'timeline id or exact name' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { audio: { type: 'string' }, sound_fx: { type: 'string' }, start_sec: { type: 'number' }, track: { type: 'integer' }, in_sec: { type: 'number' }, out_sec: { type: 'number' }, span_sec: { type: 'number' }, take: { type: 'number' }, gain: { type: 'number' }, fade_in_sec: { type: 'number' }, fade_out_sec: { type: 'number' }, muted: { type: 'boolean' } },
            required: ['start_sec'],
            additionalProperties: false
          }
        }
      },
      required: ['timeline_id', 'items'],
      additionalProperties: false
    }
  },
  {
    name: 'set_timeline_scores',
    description:
      "Lay SCORES (music) on a timeline's score tracks (S1, S2…); sound fx go on the audio tracks (set_timeline_audio, sound_fx). REPLACES every score block on the timeline (send the full list; [] clears them). Each entry: score (name or id), start_sec, span_sec (how long the block is — a score made from the footage scores exactly this stretch), track (1 = S1; blocks on one track must not overlap), optional take (1-based; omit = the take that plays), gain, fade_in_sec / fade_out_sec, muted. Audio never stretches: a take shorter than its span ends early.",
    input_schema: {
      type: 'object',
      properties: {
        timeline_id: { type: 'string', description: 'timeline id or exact name' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { score: { type: 'string' }, start_sec: { type: 'number' }, span_sec: { type: 'number' }, track: { type: 'integer' }, take: { type: 'number' }, gain: { type: 'number' }, fade_in_sec: { type: 'number' }, fade_out_sec: { type: 'number' }, muted: { type: 'boolean' } },
            required: ['score', 'start_sec', 'span_sec'],
            additionalProperties: false
          }
        }
      },
      required: ['timeline_id', 'items'],
      additionalProperties: false
    }
  },
  {
    name: 'set_timeline_output',
    description: "A timeline's export settings and its two whole-track mutes. Send only what should change: export_res (480 / 720 / 1080), export_fps (auto / 24 / 30), export_quality (draft / standard / high), video_muted (the clips' own sound), music_muted. Exporting the file itself stays the director's.",
    input_schema: {
      type: 'object',
      properties: {
        timeline_id: { type: 'string' },
        export_res: { type: 'string', enum: ['480', '720', '1080'] },
        export_fps: { type: 'string', enum: ['auto', '24', '30'] },
        export_quality: { type: 'string', enum: ['draft', 'standard', 'high'] },
        video_muted: { type: 'boolean' },
        music_muted: { type: 'boolean' }
      },
      required: ['timeline_id'],
      additionalProperties: false
    }
  },
  {
    name: 'set_image_primary',
    description: "Choose which EDIT of a Library image is its face: the image's tree of Image Edit results is listed by read_object (edits 1, 2, 3…). edit = that number makes it the primary (every clip, sheet and ref using the image follows); 0 = back to the original. Nothing is deleted.",
    input_schema: { type: 'object', properties: { image: { type: 'string', description: 'a Library @title or image id' }, edit: { type: 'number' } }, required: ['image', 'edit'], additionalProperties: false }
  },
  {
    name: 'set_assembly_outline',
    description: 'Write the ASSEMBLY outline (the Assembly panel: numbered shots in story order, then the holes) and/or lock it. The director corrects and locks it, then presses assemble himself.',
    input_schema: { type: 'object', properties: { outline: { type: 'string' }, locked: { type: 'boolean' } }, additionalProperties: false }
  }
]

// ---- what each new kind of thing looks like in the index (one line) and in full (read_object) ----
const scoreLine = (s: ScoreClip): string => {
  const k = keepersOf(s).length
  return `- ${s.kind === 'sfx' ? 'sound fx' : 'score'} "${s.name}" id=${s.id} model=${s.recipe.engine} beats=${s.beats.length} takes=${s.takes.length}${k ? ` keepers=${k}` : ''}`
}
const voiceLine = (v: VoiceClip): string => `- voice "${v.name}" id=${v.id} model=${v.recipe.engine} takes=${v.takes.length}${v.recipe.desc ? ` · ${snip(v.recipe.desc, 80)}` : ''}`

// the index sections the context gains (both the full and the RLM index: these are one line each)
export function reachIndex(p: Project): string {
  const on = <T extends { disabled?: boolean }>(l: T[] | undefined): T[] => (l ?? []).filter((x) => !x.disabled)
  const parts: string[] = []
  const scores = on(p.scoreClips)
  parts.push(`\n## Scores and sound fx (create_score · set_score · set_timeline_scores; read_object for the whole recipe; renders through fire_render kind=score)\n${scores.length ? scores.map(scoreLine).join('\n') : '(none yet)'}`)
  const voices = on(p.voiceClips)
  parts.push(`\n## Voices (create_voice · set_voice; renders through fire_render kind=voice)\n${voices.length ? voices.map(voiceLine).join('\n') : '(none yet)'}`)
  const audio = on(p.audio)
  if (audio.length) parts.push(`\n## Library audio (titles for set_timeline_audio, audio refs, a voice's sample, a score's music ref)\n${audio.map((a) => `- "${a.title}"${a.durationSec ? ` ${a.durationSec.toFixed(1)}s` : ''} id=${a.id}`).join('\n')}`)
  const videos = on(p.videos)
  if (videos.length) parts.push(`\n## Library videos (titles for video refs and video edits)\n${videos.map((v) => `- "${v.title}"${v.durationSec ? ` ${v.durationSec.toFixed(1)}s` : ''} id=${v.id}`).join('\n')}`)
  const lanes = p.timelines.filter((tl) => (tl.audioItems ?? []).some((a) => 'audioId' in a.source || 'sfxId' in a.source) || (tl.scoreItems ?? []).length)
  if (lanes.length)
    parts.push(
      `\n## Timeline sound (Library audio and sound fx on the A tracks, scores on the S tracks)\n${lanes
        .map((tl) => {
          const a = (tl.audioItems ?? []).filter((x) => 'audioId' in x.source).map((x) => `A${x.lane + 1} "${p.audio.find((y) => 'audioId' in x.source && y.id === x.source.audioId)?.title ?? '?'}" @${x.startSec.toFixed(1)}s`)
          const fx = (tl.audioItems ?? []).flatMap((x) => ('sfxId' in x.source ? [{ x, sid: x.source.sfxId }] : [])).map(({ x, sid }) => `A${x.lane + 1} sound fx "${p.scoreClips.find((y) => y.id === sid)?.name ?? '?'}" ${x.startSec.toFixed(1)}–${(x.startSec + (x.outSec - x.inSec)).toFixed(1)}s`)
          const s = (tl.scoreItems ?? []).map((x) => `S${(x.lane ?? 0) + 1} "${p.scoreClips.find((y) => y.id === x.scoreClipId)?.name ?? '?'}" ${x.startSec.toFixed(1)}–${(x.startSec + x.spanSec).toFixed(1)}s`)
          return `- timeline "${tl.name}": ${[...a, ...fx, ...s].join(' · ')}`
        })
        .join('\n')}`
    )
  return parts.join('\n')
}

export function reachDump(p: Project, id: string): string | null {
  const s = scoreBy(p, id)
  if (s) {
    const o = s.recipe.options ?? {}
    const m = audioModelFor(s.recipe.engine)
    const spans = p.timelines.flatMap((tl) =>
      s.kind === 'sfx'
        ? (tl.audioItems ?? []).filter((x) => 'sfxId' in x.source && x.source.sfxId === s.id).map((x, i) => `timeline "${tl.name}" span ${i + 1}: ${x.startSec.toFixed(1)}–${(x.startSec + (x.outSec - x.inSec)).toFixed(1)}s on A${x.lane + 1}`)
        : (tl.scoreItems ?? []).filter((x) => x.scoreClipId === s.id).map((x, i) => `timeline "${tl.name}" span ${i + 1}: ${x.startSec.toFixed(1)}–${(x.startSec + x.spanSec).toFixed(1)}s on S${(x.lane ?? 0) + 1}`)
    )
    const keep = keepersOf(s).map((k) => s.takes.findIndex((t) => t.id === k) + 1).filter((n) => n > 0)
    return [
      `${s.kind === 'sfx' ? 'SOUND FX' : 'SCORE'} "${s.name}" (score_id=${s.id})`,
      `model: ${s.recipe.engine} (${m.label})`,
      `style: ${String(o.styleText ?? '') || '(empty)'}`,
      ...(s.kind === 'sfx' ? [`sound length: ${Number(o.sfxSec) > 0 ? `${o.sfxSec}s` : 'the model picks'} · loop ${o.loop === true ? 'on' : 'off'} · follow the words ${o.promptInfluence ?? 0.3}`] : [`length: ${Number(o.durationSec ?? 60)}s · ${o.isInstrumental === false ? 'SINGS' : 'instrumental'}`, `lyrics: ${String(o.lyricsText ?? '') || '(none)'}`]),
      `beats (${s.beats.length}):${s.beats.length ? '\n' + s.beats.map((b) => `  at ${b.at}s: ${b.text}`).join('\n') : ' (none)'}`,
      ...(s.recipe.musicRefId ? [`music ref: "${p.audio.find((a) => a.id === s.recipe.musicRefId)?.title ?? '(gone)'}" from ${Number(o.musicRefFrom ?? 0)}s · strength ${o.musicRefStrength ?? 0.8}`] : []),
      ...(s.recipe.imageIds?.length ? [`pictures: ${s.recipe.imageIds.map((i) => p.images.find((x) => x.id === i)?.title ?? '(gone)').join(' ')}`] : []),
      `takes: ${s.takes.length}${s.takes.length ? ` · plays take ${s.takes.findIndex((t) => t.id === playing(s)?.id) + 1}${keep.length ? ` · keepers ${keep.join(', ')}` : ''}` : ''}`,
      `on timelines: ${spans.length ? spans.join(' · ') : '(not placed — set_timeline_scores)'}`
    ].join('\n')
  }
  const v = voiceBy(p, id)
  if (v) {
    const r = v.recipe
    const o = r.options ?? {}
    const t = (i?: string): string => (i ? (p.audio.find((a) => a.id === i)?.title ?? '(gone)') : '—')
    return [
      `VOICE "${v.name}" (voice_id=${v.id})`,
      `model: ${r.engine} (${audioModelFor(r.engine).label})`,
      `description: ${r.desc || '(empty)'}`,
      `test line: ${r.testLine || '(empty)'}`,
      `image: ${r.imageId ? (p.images.find((i) => i.id === r.imageId)?.title ?? '(gone)') : '—'} · sample: ${t(r.refAudioId)} · consent clip: ${t(r.consentAudioId)}`,
      `ready voice: ${String(o.voice ?? '') || '(new — from the description or sample)'} · style: ${String(o.style ?? '') || '—'} · second speaker: ${String(o.voice2 ?? '').startsWith('clip:') ? (p.voiceClips.find((x) => x.id === String(o.voice2).slice(5))?.name ?? '(gone)') : String(o.voice2 ?? '') || '—'}`,
      `takes: ${v.takes.length}${v.takes.length ? ` · plays take ${v.takes.findIndex((x) => x.id === playing(v)?.id) + 1}` : ''}`,
      `bound to: ${(p.charSheets ?? []).filter((s2) => s2.voiceId === v.id).map((s2) => `"${s2.name}"`).join(', ') || '(no char sheet)'}`
    ].join('\n')
  }
  const a = audioBy(p, id)
  if (a) return `LIBRARY AUDIO "${a.title}" (audio_id=${a.id})${a.durationSec ? ` · ${a.durationSec.toFixed(1)}s` : ''}\nfile: ${a.file}`
  const vid = videoBy(p, id)
  if (vid) return `LIBRARY VIDEO "${vid.title}" (video_id=${vid.id})${vid.durationSec ? ` · ${vid.durationSec.toFixed(1)}s` : ''}\nfile: ${vid.file}`
  return null
}
// a Library image's Image Edit tree, for read_object (set_image_primary names an edit by this number)
export function reachImageEdits(p: Project, imageId: string): string {
  const sess = p.editSessions.find((s) => s.rootImageId === imageId)
  if (!sess?.nodes.length) return ''
  return `edits (${sess.nodes.length} — set_image_primary picks the face; 0 = the original${sess.primaryNodeId ? '' : ', which is the face now'}):\n${sess.nodes
    .map((n, i) => `  ${i + 1}. ${n.id === sess.primaryNodeId ? '◉ PRIMARY · ' : ''}${imageModelFor(n.model).label} · "${snip(n.prompt, 100)}"${n.keptImageId ? ` · also in the Library as ${p.images.find((x) => x.id === n.keptImageId)?.title ?? '(gone)'}` : ''}`)
    .join('\n')}`
}

// ---- the live-write card (what the Room shows landing) ----
export function reachLive(name: string, input: Record<string, unknown>, p: Project | null): CoDirLiveWrite | null {
  const fields = Object.entries(input)
    .filter(([k, v]) => !/(_id|^id|^kind|^image)$/.test(k) && v !== undefined)
    .map(([k, v]) => ({ path: k.replace(/_/g, ' '), snippet: snip(Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : v === null ? '(cleared)' : typeof v === 'object' ? JSON.stringify(v) : String(v)) }))
  const named = (what: string, n?: string): string | undefined => (n ? `${what} "${n}"` : undefined)
  switch (name) {
    case 'set_clip_settings':
    case 'delete_take':
    case 'clip_from_take':
      return { tool: name, target: named('clip', p ? clipBy(p, input.clip_id)?.name : undefined), fields }
    case 'set_take_flags':
      return { tool: name, target: `${String(input.kind ?? '')} take ${String(input.take ?? '')}`, fields }
    case 'clips_from_images':
      return { tool: name, target: 'new clips', fields: [{ path: 'images', snippet: snip((input.image_titles as string[] | undefined)?.join(' ')) }] }
    case 'create_score':
      return { tool: name, target: `new ${input.kind === 'sound_fx' ? 'sound fx' : 'score'} "${snip(input.name ?? '', 60)}"`, fields: [] }
    case 'set_score':
      return { tool: name, target: named('score', p ? scoreBy(p, input.score_id)?.name : undefined), fields }
    case 'create_voice':
      return { tool: name, target: `new voice "${snip(input.name ?? '', 60)}"`, fields: [] }
    case 'set_voice':
      return { tool: name, target: named('voice', p ? voiceBy(p, input.voice_id)?.name : undefined), fields }
    case 'delete_item':
      return { tool: name, target: `delete ${String(input.kind ?? '')}`, fields: [] }
    case 'set_timeline_audio':
    case 'set_timeline_scores':
    case 'set_timeline_output':
      return { tool: name, target: named('timeline', p ? timelineBy(p, input.timeline_id)?.name : undefined), fields }
    case 'set_image_primary':
      return { tool: name, target: named('image', p ? imageBy(p, input.image)?.title : undefined), fields: [{ path: 'face', snippet: Number(input.edit) > 0 ? `edit ${String(input.edit)}` : 'the original' }] }
    case 'set_assembly_outline':
      return { tool: name, target: 'the assembly outline', fields }
    default:
      return null
  }
}

// ---- the writes ----
export async function runReachTool(name: string, input: Record<string, unknown>, p: Project, pushDelta: (d: ProjectDelta) => void): Promise<string | null> {
  const push = (d: ProjectDelta | null | undefined): void => {
    if (d) pushDelta(d)
  }
  switch (name) {
    case 'set_clip_settings': {
      const c = clipBy(p, input.clip_id)
      if (!c) return `ERROR: no clip with id or name ${String(input.clip_id)}`
      const pd = c.promptData
      const m = modelFor(pd.engine)
      const patch: Partial<PromptData> = {}
      const did: string[] = []
      const notes: string[] = []
      if (input.mode !== undefined) {
        if (!['ref2v', 'i2v', 't2v'].includes(String(input.mode))) return 'ERROR: mode must be ref2v, i2v or t2v'
        patch.mode = input.mode as PromptData['mode']
        did.push(`mode ${patch.mode}`)
        if (patch.mode !== 't2v' && !m.modes.includes(patch.mode as 'ref2v' | 'i2v')) notes.push(`${m.label} does not render ${patch.mode} — the form will block the render until the mode or the engine changes`)
      }
      const mode = patch.mode ?? pd.mode
      if (typeof input.resolution === 'string') {
        if (!m.resolutions.includes(input.resolution)) return `ERROR: ${m.label} makes ${m.resolutions.join(' / ') || 'no sizes'} — not ${input.resolution}`
        patch.resolution = input.resolution
        did.push(`resolution ${input.resolution}`)
      }
      if (typeof input.aspect_ratio === 'string') {
        if (!m.aspectRatios.includes(input.aspect_ratio)) return `ERROR: ${m.label} takes aspect ${m.aspectRatios.join(' / ') || '(none)'} — not ${input.aspect_ratio}`
        patch.aspectRatio = input.aspect_ratio
        did.push(`aspect ${input.aspect_ratio}`)
      }
      if (typeof input.sound === 'boolean') {
        patch.generateAudio = input.sound
        did.push(`sound ${input.sound ? 'on' : 'off'}`)
        if (!m.audioToggle) notes.push(`${m.label} always renders audio — the switch is kept but changes nothing on it`)
      }
      if (typeof input.negative === 'string') {
        patch.negative = input.negative.trim() || undefined
        did.push('negative')
      }
      if (typeof input.draft === 'boolean') {
        patch.draft = input.draft || undefined
        did.push(`draft ${input.draft ? 'on' : 'off'}`)
        if (input.draft && !m.draft) notes.push(`${m.label} has no draft mode (Seedance 2.5 on fal and ModelArk does) — kept, not sent`)
      }
      if ('start_frame' in input) {
        if (mode !== 'i2v') return 'ERROR: a start frame belongs to i2v — send mode: "i2v" with it (the clip’s reference images are set_clip_refs)'
        if (input.start_frame === null) patch.imageIds = []
        else {
          const im = imageBy(p, input.start_frame)
          if (!im) return `ERROR: no Library image ${String(input.start_frame)}`
          patch.imageIds = [im.id]
        }
        did.push(`start frame ${input.start_frame === null ? 'cleared' : String(input.start_frame)}`)
      }
      if ('end_frame' in input) {
        if (input.end_frame === null) patch.endImageId = undefined
        else {
          const im = imageBy(p, input.end_frame)
          if (!im) return `ERROR: no Library image ${String(input.end_frame)}`
          patch.endImageId = im.id
          if (!m.endFrame) notes.push(`${m.label} takes no end frame — kept, not sent`)
        }
        did.push(`end frame ${input.end_frame === null ? 'cleared' : String(input.end_frame)}`)
      }
      if (Array.isArray(input.video_refs)) {
        const out: VideoRef[] = []
        for (const r of input.video_refs as { video?: string; clip?: string; take?: number; in_sec?: number; out_sec?: number }[]) {
          const win = num(r.in_sec) != null && num(r.out_sec) != null && r.out_sec! > r.in_sec! ? { inSec: r.in_sec, outSec: r.out_sec } : {}
          if (r.video != null) {
            const v = videoBy(p, r.video)
            if (!v) return `ERROR: no Library video ${String(r.video)}`
            out.push({ videoId: v.id, ...win })
          } else {
            const src = clipBy(p, r.clip)
            const t = src ? (r.take != null ? takeN(src.takes, r.take) : playing(src)) : undefined
            if (!src || !t) return `ERROR: no such take for a video ref: clip ${String(r.clip)}${r.take != null ? ` take ${r.take}` : ''}`
            out.push({ takeRef: { clipId: src.id, takeId: t.id }, ...win })
          }
        }
        patch.videoRefs = out.length ? out : undefined
        did.push(`${out.length} video ref${out.length === 1 ? '' : 's'}`)
        if (out.length > m.maxRefVideos) notes.push(m.maxRefVideos ? `${m.label} takes ${m.maxRefVideos} video refs — the form will block the render` : `${m.label} has no video refs — kept, not sent`)
      }
      if (Array.isArray(input.audio_refs)) {
        const out: AudioRef[] = []
        for (const r of input.audio_refs as { audio?: string; voice?: string; role?: string; in_sec?: number; out_sec?: number }[]) {
          const win = num(r.in_sec) != null && num(r.out_sec) != null && r.out_sec! > r.in_sec! ? { inSec: r.in_sec, outSec: r.out_sec } : {}
          if (r.voice != null) {
            const v = voiceBy(p, r.voice)
            if (!v) return `ERROR: no voice ${String(r.voice)}`
            out.push({ voiceId: v.id, ...(r.role === 'dialogue' || r.role === 'timbre' ? { role: r.role } : {}), ...win })
          } else {
            const a = audioBy(p, r.audio)
            if (!a) return `ERROR: no Library audio ${String(r.audio)}`
            out.push({ audioId: a.id, ...win })
          }
        }
        patch.audioRefs = out.length ? out : undefined
        did.push(`${out.length} audio ref${out.length === 1 ? '' : 's'}`)
        if (out.length > m.maxRefAudios) notes.push(m.maxRefAudios ? `${m.label} takes ${m.maxRefAudios} audio refs — the form will block the render` : `${m.label} has no audio refs — kept, not sent`)
      }
      if (typeof input.loras_on === 'boolean') {
        patch.loraOn = input.loras_on
        did.push(`loras ${input.loras_on ? 'on' : 'off'}`)
      }
      if (Array.isArray(input.loras)) {
        const rows = (input.loras as { name?: string; weight?: number }[]).filter((l) => typeof l.name === 'string' && l.name.trim()).map((l) => ({ name: l.name!.trim(), weight: Math.max(0, Math.min(2, num(l.weight) ?? 1)) }))
        patch.loras = rows.length ? rows : undefined
        did.push(`${rows.length} lora${rows.length === 1 ? '' : 's'}`)
        if (m.provider !== 'local') notes.push(`${m.label} takes no loras (the local video engines do) — kept, not sent`)
      }
      if (typeof input.ltx_size === 'string') {
        patch.ltxSize = input.ltx_size.trim() || undefined
        did.push(`local size ${patch.ltxSize ?? 'best installed'}`)
      }
      if ('prompt_link' in input) {
        if (input.prompt_link === null) patch.promptLink = undefined
        else {
          const l = input.prompt_link as { clip?: string; pos?: string }
          const src = clipBy(p, l.clip)
          if (!src || src.id === c.id) return `ERROR: prompt_link needs another clip — ${String(l.clip)} is not one`
          patch.promptLink = { clipId: src.id, pos: l.pos === 'after' ? 'after' : 'before' }
        }
        did.push(input.prompt_link === null ? 'prompt link cleared' : 'prompt link')
      }
      if (Array.isArray(input.beat_pictures)) {
        const beats = pd.beats.map((b) => ({ ...b }))
        for (const r of input.beat_pictures as { beat?: number; image?: string | null }[]) {
          const b = beats[Math.round(Number(r.beat)) - 1]
          if (!b) return `ERROR: "${c.name}" has ${beats.length} beat${beats.length === 1 ? '' : 's'} — no beat ${String(r.beat)}`
          if (r.image == null) delete b.refImageId
          else {
            const im = imageBy(p, r.image)
            if (!im) return `ERROR: no Library image ${String(r.image)}`
            b.refImageId = im.id
          }
        }
        patch.beats = beats
        did.push(`${(input.beat_pictures as unknown[]).length} beat picture${(input.beat_pictures as unknown[]).length === 1 ? '' : 's'}`)
      }
      if (!did.length) return 'nothing to change'
      push(await setClipPromptData(c.id, patch))
      return `"${c.name}" dials: ${did.join(', ')}${notes.length ? `\nNOTE: ${notes.join(' · ')}` : ''}`
    }
    case 'set_take_flags': {
      const patch: { color?: string | null; disabled?: boolean } = {}
      if ('color' in input) patch.color = typeof input.color === 'string' && input.color.trim() ? input.color.trim() : null
      if (typeof input.disabled === 'boolean') patch.disabled = input.disabled
      if (!Object.keys(patch).length) return 'nothing to change'
      const owner = input.kind === 'clip' ? clipBy(p, input.id) : input.kind === 'score' ? scoreBy(p, input.id) : input.kind === 'voice' ? voiceBy(p, input.id) : input.kind === 'image_gen' ? ((p.imageGens ?? []).find((x) => x.id === input.id) ?? (p.imageGens ?? []).find((x) => low(x.name) === low(input.id))) : undefined
      if (!owner) return `ERROR: no ${String(input.kind)} with id or name ${String(input.id)}`
      const t = takeN(owner.takes as { id: string }[], input.take)
      if (!t) return `ERROR: "${owner.name}" has ${owner.takes.length} take${owner.takes.length === 1 ? '' : 's'} — no take ${String(input.take)}`
      push(await (input.kind === 'clip' ? setTakeMeta : input.kind === 'score' ? setScoreTakeMeta : input.kind === 'voice' ? setVoiceTakeMeta : setImageGenTakeMeta)(owner.id, t.id, patch))
      return `"${owner.name}" take ${Math.round(Number(input.take))}: ${[patch.color !== undefined ? (patch.color ? `colour ${patch.color}` : 'colour cleared') : '', patch.disabled !== undefined ? (patch.disabled ? 'disabled' : 'enabled') : ''].filter(Boolean).join(', ')}`
    }
    case 'delete_take': {
      const c = clipBy(p, input.clip_id)
      const t = c ? takeN(c.takes, input.take) : undefined
      if (!c || !t) return `ERROR: no such take: clip ${String(input.clip_id)} take ${String(input.take)}`
      push(await deleteTake(c.id, t.id))
      return `removed take ${Math.round(Number(input.take))} of "${c.name}" (its file stays on disk; the director can undo)`
    }
    case 'clip_from_take': {
      const c = clipBy(p, input.clip_id)
      const t = c ? (input.take != null ? takeN(c.takes, input.take) : playing(c)) : undefined
      if (!c || !t) return `ERROR: no such take: clip ${String(input.clip_id)}${input.take != null ? ` take ${String(input.take)}` : ' (it has no takes)'}`
      const r = await cloneClipFromTake(c.id, t.id)
      if (!r) return 'ERROR: could not make the clip'
      push(r.delta)
      return `created clip_id=${r.newClipId} from "${c.name}" take ${c.takes.indexOf(t) + 1}`
    }
    case 'clips_from_images': {
      const titles = Array.isArray(input.image_titles) ? (input.image_titles as string[]) : []
      const ims = titles.map((t) => imageBy(p, t))
      const missing = titles.filter((_, i) => !ims[i])
      if (!titles.length || missing.length) return `ERROR: ${titles.length ? `no Library image ${missing.join(', ')}` : 'no image_titles'}`
      const r = await newClipsFromImages(ims.map((i) => i!.id))
      if (!r) return 'ERROR: could not make the clips'
      push(r.delta)
      return `created ${r.clipIds.length} clip${r.clipIds.length === 1 ? '' : 's'}: ${r.clipIds.map((id) => `clip_id=${id}`).join(', ')}`
    }
    case 'create_score': {
      const sfx = input.kind === 'sound_fx'
      const r = await newScoreClip(typeof input.name === 'string' ? input.name : undefined, sfx ? 'sfx' : undefined)
      if (!r) return 'ERROR: could not create it'
      push(r.delta)
      return `created ${sfx ? 'sound fx' : 'score'} score_id=${r.scoreClipId}`
    }
    case 'set_score': {
      const s = scoreBy(p, input.score_id)
      if (!s) return `ERROR: no score or sound fx with id or name ${String(input.score_id)}`
      const recipe: ScoreRecipe = JSON.parse(JSON.stringify(s.recipe))
      const o: Record<string, string | number | boolean> = { ...(recipe.options ?? {}) }
      const did: string[] = []
      if (typeof input.model === 'string') {
        const m = SCORE_ENGINES.find((x) => x.id === input.model)
        if (!m) return `ERROR: no such model ${input.model}`
        if ((m.kind === 'sfx') !== (s.kind === 'sfx')) return `ERROR: ${m.label} is a ${m.kind === 'sfx' ? 'sound fx' : 'music'} model — "${s.name}" is a ${s.kind === 'sfx' ? 'sound fx' : 'score'}`
        recipe.engine = m.id
        did.push(`model ${m.label}`)
      }
      const model = audioModelFor(recipe.engine)
      const setO = (k: string, v: string | number | boolean, say: string): void => {
        o[k] = v
        did.push(say)
      }
      if (typeof input.style === 'string') setO('styleText', input.style, 'style')
      if (typeof input.lyrics === 'string') setO('lyricsText', input.lyrics, 'lyrics')
      if (typeof input.instrumental === 'boolean') setO('isInstrumental', input.instrumental, input.instrumental ? 'instrumental' : 'sings')
      if (num(input.length_sec) != null) setO('durationSec', Math.max(5, Math.min(model.maxDurationSec, input.length_sec as number)), `length ${input.length_sec}s`)
      if (num(input.sound_length_sec) != null) setO('sfxSec', input.sound_length_sec === 0 ? 0 : Math.max(0.5, Math.min(30, input.sound_length_sec as number)), `sound length ${input.sound_length_sec || 'auto'}`)
      if (typeof input.loop === 'boolean') setO('loop', input.loop, `loop ${input.loop ? 'on' : 'off'}`)
      if (num(input.follow_words) != null) setO('promptInfluence', Math.max(0, Math.min(1, input.follow_words as number)), 'follow the words')
      if (num(input.music_ref_from) != null) setO('musicRefFrom', Math.max(0, input.music_ref_from as number), 'music ref start')
      if (num(input.music_ref_strength) != null) setO('musicRefStrength', Math.max(0, Math.min(1, input.music_ref_strength as number)), 'music ref strength')
      if ('music_ref' in input) {
        if (input.music_ref === null) delete recipe.musicRefId
        else {
          const a = audioBy(p, input.music_ref)
          if (!a) return `ERROR: no Library audio ${String(input.music_ref)}`
          recipe.musicRefId = a.id
        }
        did.push(input.music_ref === null ? 'music ref cleared' : `music ref ${String(input.music_ref)}`)
      }
      if (Array.isArray(input.pictures)) {
        const ims = (input.pictures as string[]).map((t) => imageBy(p, t))
        const missing = (input.pictures as string[]).filter((_, i) => !ims[i])
        if (missing.length) return `ERROR: no Library image ${missing.join(', ')}`
        recipe.imageIds = ims.length ? ims.map((i) => i!.id) : undefined
        did.push(`${ims.length} picture${ims.length === 1 ? '' : 's'}`)
      }
      recipe.options = o
      const beats = Array.isArray(input.beats) ? (input.beats as { at?: number; text?: string }[]).map((b) => ({ id: randomUUID(), at: Math.max(0, Number(b.at) || 0), text: String(b.text ?? '') })) : undefined
      if (beats) did.push(`${beats.length} beat${beats.length === 1 ? '' : 's'}`)
      const rename = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined
      if (rename) did.push(`name "${rename}"`)
      if (!did.length) return 'nothing to change'
      push(await setScoreClipData(s.id, { recipe, ...(beats ? { beats } : {}), ...(rename ? { name: rename } : {}) }))
      const unused = [
        'music_ref' in input && input.music_ref !== null && !model.musicRef ? `${model.label} takes no music ref — kept, not sent` : '',
        Array.isArray(input.pictures) && input.pictures.length && !model.imageInputs ? `${model.label} takes no pictures — kept, not sent` : ''
      ].filter(Boolean)
      return `"${rename ?? s.name}": ${did.join(', ')}${unused.length ? `\nNOTE: ${unused.join(' · ')}` : ''}`
    }
    case 'create_voice': {
      const r = await newVoiceClip(typeof input.name === 'string' ? input.name : undefined)
      if (!r) return 'ERROR: could not create the voice'
      push(r.delta)
      return `created voice_id=${r.voiceClipId}`
    }
    case 'set_voice': {
      const v = voiceBy(p, input.voice_id)
      if (!v) return `ERROR: no voice with id or name ${String(input.voice_id)}`
      const recipe: VoiceRecipe = JSON.parse(JSON.stringify(v.recipe))
      const o: Record<string, string | number | boolean> = { ...(recipe.options ?? {}) }
      const did: string[] = []
      if (typeof input.model === 'string') {
        const m = VOICE_ENGINES.find((x) => x.id === input.model)
        if (!m) return `ERROR: no such voice model ${input.model}`
        recipe.engine = m.id
        did.push(`model ${m.label}`)
      }
      if (typeof input.description === 'string') {
        recipe.desc = input.description || undefined
        did.push('description')
      }
      if (typeof input.test_line === 'string') {
        recipe.testLine = input.test_line || undefined
        did.push('test line')
      }
      if ('image' in input) {
        if (input.image === null) delete recipe.imageId
        else {
          const im = imageBy(p, input.image)
          if (!im) return `ERROR: no Library image ${String(input.image)}`
          recipe.imageId = im.id
        }
        did.push('image')
      }
      for (const [key, field, say] of [['sample', 'refAudioId', 'sample'], ['consent', 'consentAudioId', 'consent clip']] as const) {
        if (!(key in input)) continue
        if (input[key] === null) delete recipe[field]
        else {
          const a = audioBy(p, input[key])
          if (!a) return `ERROR: no Library audio ${String(input[key])}`
          recipe[field] = a.id
        }
        did.push(say)
      }
      if (typeof input.ready_voice === 'string') {
        o.voice = input.ready_voice.trim()
        did.push(o.voice ? `ready voice ${o.voice}` : 'a new voice')
      }
      if (typeof input.style === 'string') {
        o.style = input.style
        did.push('style')
      }
      if (typeof input.language === 'string') {
        o.language = input.language.trim().toLowerCase()
        did.push('language')
      }
      if ('second_speaker' in input) {
        if (input.second_speaker === null || input.second_speaker === '') {
          delete o.voice2
          delete o.voice2Name
        } else {
          const other = voiceBy(p, input.second_speaker)
          if (other && other.id === v.id) return 'ERROR: the second speaker has to be another voice'
          o.voice2 = other ? `clip:${other.id}` : String(input.second_speaker).trim()
          o.voice2Name = other ? '' : String(input.second_speaker).trim().split(/[^\p{L}\p{N}]/u)[0]
        }
        did.push(input.second_speaker ? `second speaker ${String(input.second_speaker)}` : 'one speaker')
      }
      recipe.options = o
      const rename = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined
      if (rename) did.push(`name "${rename}"`)
      if (!did.length) return 'nothing to change'
      push(await setVoiceClipData(v.id, { recipe, ...(rename ? { name: rename } : {}) }))
      return `voice "${rename ?? v.name}": ${did.join(', ')}`
    }
    case 'delete_item': {
      if (input.kind === 'score') {
        const s = scoreBy(p, input.id)
        if (!s) return `ERROR: no score or sound fx with id or name ${String(input.id)}`
        push(await deleteScoreClip(s.id))
        return `deleted ${s.kind === 'sfx' ? 'sound fx' : 'score'} "${s.name}" (its timeline blocks went with it; the director can undo)`
      }
      if (input.kind === 'voice') {
        const v = voiceBy(p, input.id)
        if (!v) return `ERROR: no voice with id or name ${String(input.id)}`
        push(await deleteVoiceClip(v.id))
        return `deleted voice "${v.name}" (the director can undo)`
      }
      return 'ERROR: kind must be score or voice'
    }
    case 'set_timeline_audio': {
      const tl = timelineBy(p, input.timeline_id)
      if (!tl) return `ERROR: no timeline with id or name ${String(input.timeline_id)}`
      const rows = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : []
      // the clips' own sound (and a nest's) stays exactly where it is; Library audio and sound fx are this list
      const kept = (tl.audioItems ?? []).filter((a) => !('audioId' in a.source) && !('sfxId' in a.source))
      const out: TimelineAudioItem[] = []
      for (const r of rows) {
        // v24 (his 10-02 "clip effect not score"): a sound fx is an A block too
        if (r.sound_fx != null) {
          const fx = scoreBy(p, r.sound_fx)
          if (!fx || fx.kind !== 'sfx') return `ERROR: no sound fx ${String(r.sound_fx)}`
          const span = Number(r.span_sec)
          if (!(span > 0)) return `ERROR: "${fx.name}": span_sec must be more than 0`
          const take = r.take != null ? takeN(fx.takes, r.take) : undefined
          if (r.take != null && !take) return `ERROR: "${fx.name}" has ${fx.takes.length} take${fx.takes.length === 1 ? '' : 's'}, no take ${String(r.take)}`
          const lane = Math.max(0, Math.round(num(r.track) ?? 1) - 1)
          const start = Math.max(0, Number(r.start_sec) || 0)
          const prev = (tl.audioItems ?? []).find((x) => 'sfxId' in x.source && x.source.sfxId === fx.id && x.lane === lane && Math.abs(x.startSec - start) < 0.01)
          const inSec = prev?.inSec ?? 0
          out.push({
            ...(prev ?? {}), // the same block again keeps its id (the span a render is aimed at) and his keyframes
            id: prev?.id ?? randomUUID(),
            lane,
            source: { sfxId: fx.id, ...(take ? { takeId: take.id } : r.take === undefined && prev && 'sfxId' in prev.source && prev.source.takeId ? { takeId: prev.source.takeId } : {}) },
            startSec: start,
            inSec,
            outSec: inSec + span,
            ...(num(r.gain) != null ? { gain: Math.max(0, Math.min(2, r.gain as number)) } : {}),
            ...(num(r.fade_in_sec) != null ? { fadeInSec: Math.max(0, r.fade_in_sec as number) } : {}),
            ...(num(r.fade_out_sec) != null ? { fadeOutSec: Math.max(0, r.fade_out_sec as number) } : {}),
            ...(typeof r.muted === 'boolean' ? { muted: r.muted } : {})
          })
          continue
        }
        const a = audioBy(p, r.audio)
        if (!a) return `ERROR: no Library audio ${String(r.audio)}`
        const inSec = Math.max(0, num(r.in_sec) ?? 0)
        // a track whose length nothing has measured yet (the Library measures it when it first plays) is measured here
        let nat = a.durationSec
        if (nat == null && num(r.out_sec) == null) {
          nat = (await probeVideo(a.file)).duration || undefined
          if (nat) push(await setAudioDuration(a.id, nat))
        }
        const outSec = num(r.out_sec) ?? nat
        if (outSec == null) return `ERROR: "${a.title}" can’t be read as audio — send out_sec for it, or re-import the file`
        if (outSec <= inSec) return `ERROR: "${a.title}": out_sec must be after in_sec`
        const lane = Math.max(0, Math.round(num(r.track) ?? 1) - 1)
        const prev = (tl.audioItems ?? []).find((x) => 'audioId' in x.source && x.source.audioId === a.id && x.lane === lane && Math.abs(x.startSec - Number(r.start_sec)) < 0.01)
        out.push({
          ...(prev ?? {}), // the same block again keeps what he did to it by hand (its keyframes, its speed)
          id: prev?.id ?? randomUUID(),
          lane,
          source: { audioId: a.id },
          startSec: Math.max(0, Number(r.start_sec) || 0),
          inSec,
          outSec,
          ...(num(r.gain) != null ? { gain: Math.max(0, Math.min(2, r.gain as number)) } : {}),
          ...(num(r.fade_in_sec) != null ? { fadeInSec: Math.max(0, r.fade_in_sec as number) } : {}),
          ...(num(r.fade_out_sec) != null ? { fadeOutSec: Math.max(0, r.fade_out_sec as number) } : {}),
          ...(typeof r.muted === 'boolean' ? { muted: r.muted } : {})
        })
      }
      const tracks = Math.max(0, ...out.map((x) => x.lane)) + 1
      if (tracks > (tl.audioTracks ?? 3)) push(await setTimelineMeta(tl.id, { audioTracks: tracks }))
      push(await setTimelineAudioItems(tl.id, [...kept, ...out]))
      const nFx = out.filter((x) => 'sfxId' in x.source).length
      const nA = out.length - nFx
      const what = [nA || !nFx ? `${nA} Library audio block${nA === 1 ? '' : 's'}` : '', nFx ? `${nFx} sound fx block${nFx === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
      return `timeline "${tl.name}": ${what}${out.length ? ` (${out.map((x) => `A${x.lane + 1} @${x.startSec.toFixed(1)}s`).join(', ')})` : ''}`
    }
    case 'set_timeline_scores': {
      const tl = timelineBy(p, input.timeline_id)
      if (!tl) return `ERROR: no timeline with id or name ${String(input.timeline_id)}`
      const rows = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : []
      const out: TimelineScoreItem[] = []
      for (const r of rows) {
        const s = scoreBy(p, r.score)
        if (!s) return `ERROR: no score or sound fx ${String(r.score)}`
        if (s.kind === 'sfx') return `ERROR: "${s.name}" is a sound fx: it goes on the audio tracks (set_timeline_audio with sound_fx), not the score tracks`
        const start = Math.max(0, Number(r.start_sec) || 0)
        const span = Number(r.span_sec)
        if (!(span > 0)) return `ERROR: "${s.name}": span_sec must be more than 0`
        const lane = Math.max(0, Math.round(num(r.track) ?? 1) - 1)
        const clash = out.find((x) => (x.lane ?? 0) === lane && start < x.startSec + x.spanSec - 0.001 && x.startSec < start + span - 0.001)
        if (clash) return `ERROR: two blocks overlap on S${lane + 1} (${clash.startSec.toFixed(1)}–${(clash.startSec + clash.spanSec).toFixed(1)}s and ${start.toFixed(1)}–${(start + span).toFixed(1)}s) — put one on another track`
        const take = r.take != null ? takeN(s.takes, r.take) : undefined
        if (r.take != null && !take) return `ERROR: "${s.name}" has ${s.takes.length} take${s.takes.length === 1 ? '' : 's'} — no take ${String(r.take)}`
        const prev = (tl.scoreItems ?? []).find((x) => x.scoreClipId === s.id && (x.lane ?? 0) === lane && Math.abs(x.startSec - start) < 0.01)
        out.push({
          ...(prev ?? {}), // the same block again keeps its id (the span a render is aimed at) and his keyframes
          id: prev?.id ?? randomUUID(),
          scoreClipId: s.id,
          startSec: start,
          spanSec: span,
          ...(lane ? { lane } : { lane: undefined }),
          ...(take ? { takeId: take.id } : r.take === undefined ? {} : { takeId: undefined }),
          ...(num(r.gain) != null ? { gain: Math.max(0, Math.min(2, r.gain as number)) } : {}),
          ...(num(r.fade_in_sec) != null ? { fadeInSec: Math.max(0, r.fade_in_sec as number) } : {}),
          ...(num(r.fade_out_sec) != null ? { fadeOutSec: Math.max(0, r.fade_out_sec as number) } : {}),
          ...(typeof r.muted === 'boolean' ? { muted: r.muted } : {})
        })
      }
      const tracks = Math.max(0, ...out.map((x) => x.lane ?? 0)) + 1
      if (tracks > (tl.scoreTracks ?? 3)) push(await setTimelineMeta(tl.id, { scoreTracks: tracks }))
      push(await setTimelineScoreItems(tl.id, out))
      return `timeline "${tl.name}": ${out.length} score block${out.length === 1 ? '' : 's'}${out.length ? ` (${out.map((x) => `S${(x.lane ?? 0) + 1} ${x.startSec.toFixed(1)}–${(x.startSec + x.spanSec).toFixed(1)}s`).join(', ')})` : ''}`
    }
    case 'set_timeline_output': {
      const tl = timelineBy(p, input.timeline_id)
      if (!tl) return `ERROR: no timeline with id or name ${String(input.timeline_id)}`
      const prefs = { ...(typeof input.export_res === 'string' ? { exportRes: input.export_res as '480' | '720' | '1080' } : {}), ...(typeof input.export_fps === 'string' ? { exportFps: input.export_fps as 'auto' | '24' | '30' } : {}), ...(typeof input.export_quality === 'string' ? { exportQuality: input.export_quality as 'draft' | 'standard' | 'high' } : {}) }
      const mutes = { ...(typeof input.video_muted === 'boolean' ? { videoMuted: input.video_muted } : {}), ...(typeof input.music_muted === 'boolean' ? { musicMuted: input.music_muted } : {}) }
      if (!Object.keys(prefs).length && !Object.keys(mutes).length) return 'nothing to change'
      if (Object.keys(prefs).length) push(await setTimelineExportPrefs(tl.id, prefs))
      if (Object.keys(mutes).length) push(await setTimelineMutes(tl.id, mutes))
      return `timeline "${tl.name}": ${[...Object.entries(prefs), ...Object.entries(mutes)].map(([k, v]) => `${k} ${String(v)}`).join(', ')}`
    }
    case 'set_image_primary': {
      const im = imageBy(p, input.image)
      if (!im) return `ERROR: no Library image ${String(input.image)}`
      const sess = p.editSessions.find((s) => s.rootImageId === im.id)
      const n = Math.round(Number(input.edit))
      if (!sess?.nodes.length) return `ERROR: ${im.title} has no edits yet — an edit is made in Image Edit (fire_render kind=image_edit)`
      const node = n > 0 ? sess.nodes[n - 1] : null
      if (n > 0 && !node) return `ERROR: ${im.title} has ${sess.nodes.length} edit${sess.nodes.length === 1 ? '' : 's'} — no edit ${n}`
      const d = await setPrimaryNode(sess.id, node ? node.id : null)
      if (!d) return 'ERROR: could not set the primary'
      push(d)
      return `${im.title} now shows ${node ? `edit ${n}` : 'the original'} everywhere it is used`
    }
    case 'set_assembly_outline': {
      const patch = { ...(typeof input.outline === 'string' ? { outline: input.outline } : {}), ...(typeof input.locked === 'boolean' ? { locked: input.locked } : {}) }
      if (!Object.keys(patch).length) return 'nothing to change'
      push(await setAssembly(patch))
      return `assembly outline: ${[typeof input.outline === 'string' ? 'written' : '', typeof input.locked === 'boolean' ? (input.locked ? 'locked' : 'unlocked') : ''].filter(Boolean).join(', ')} — the director presses assemble`
    }
    default:
      return null
  }
}

// ---- the kinds rename_item / duplicate_item / set_keeper_take gain (codir.ts calls these first) ----
export async function reachRename(p: Project, kind: unknown, id: unknown, name: string, pushDelta: (d: ProjectDelta) => void): Promise<string | null> {
  if (!['score', 'voice', 'audio', 'video'].includes(String(kind))) return null
  const to = name.trim()
  if (!to) return 'ERROR: empty name'
  // (the old name is read BEFORE the write: the project object is live, the write renames it in place)
  const hit = kind === 'score' ? scoreBy(p, id) : kind === 'voice' ? voiceBy(p, id) : kind === 'audio' ? audioBy(p, id) : videoBy(p, id)
  if (!hit) return `ERROR: no ${kind === 'audio' || kind === 'video' ? `Library ${String(kind)}` : String(kind)} with id or name ${String(id)}`
  const was = 'title' in hit ? hit.title : hit.name
  const d = await (kind === 'score' ? setScoreClipData(hit.id, { name: to }) : kind === 'voice' ? setVoiceClipData(hit.id, { name: to }) : kind === 'audio' ? renameAudio(hit.id, to) : renameVideo(hit.id, to))
  if (!d) return `ERROR: could not rename "${was}"`
  pushDelta(d)
  return `renamed ${String(kind)} "${was}" → "${to}"`
}
export async function reachDuplicate(p: Project, kind: unknown, id: unknown, pushDelta: (d: ProjectDelta) => void): Promise<string | null> {
  if (kind === 'score') {
    const s = scoreBy(p, id)
    if (!s) return `ERROR: no score with id or name ${String(id)}`
    const r = await duplicateScoreClip(s.id)
    if (!r) return 'ERROR: could not duplicate it'
    pushDelta(r.delta)
    return `duplicated "${s.name}" → score_id=${r.newScoreClipId}`
  }
  if (kind === 'image') {
    const im = imageBy(p, id)
    if (!im) return `ERROR: no Library image ${String(id)}`
    const r = await duplicateImage(im.id)
    if (!r) return 'ERROR: could not duplicate it'
    pushDelta(r.delta)
    return `duplicated ${im.title} → image_id=${r.newId}`
  }
  return null
}
export async function reachKeeper(p: Project, input: Record<string, unknown>, pushDelta: (d: ProjectDelta) => void): Promise<string | null> {
  const s = typeof input.score_id === 'string' && input.score_id ? scoreBy(p, input.score_id) : undefined
  const v = typeof input.voice_id === 'string' && input.voice_id ? voiceBy(p, input.voice_id) : undefined
  if (input.score_id == null && input.voice_id == null) return null
  const owner = s ?? v
  if (!owner) return `ERROR: no ${input.score_id != null ? 'score' : 'voice'} with id or name ${String(input.score_id ?? input.voice_id)}`
  const t = takeN(owner.takes as { id: string }[], input.take)
  if (!t) return `ERROR: "${owner.name}" has ${owner.takes.length} take${owner.takes.length === 1 ? '' : 's'} — no take ${String(input.take)}`
  const d = await (s ? setScoreKeeper : setVoiceKeeper)(owner.id, t.id)
  if (d) pushDelta(d)
  return `keeper on "${owner.name}" is now take ${Math.round(Number(input.take))}${v ? ' — that take IS the voice now' : ''}`
}

// ---- FIRING (the gates live in codir.ts): what a render job looks like for the kinds whose whole
// recipe is on disk or in the call. The job is the one the panel's own button would queue. ----
export interface FireJob {
  kind: 'score' | 'voice' | 'image' | 'vedit'
  label: string
  engineLabel: string
  estCost?: number
  payload: unknown
}
export function buildFireJob(p: Project, input: Record<string, unknown>): { job: FireJob; what: string } | { error: string } {
  switch (input.kind) {
    case 'score': {
      const s = scoreBy(p, input.id)
      if (!s) return { error: `no score or sound fx with id or name ${String(input.id)}` }
      const m = audioModelFor(s.recipe.engine)
      const tl = p.timelines.find((t) => t.id === p.activeTimelineId)
      const spans: { id: string }[] = s.kind === 'sfx' ? (tl?.audioItems ?? []).filter((x) => 'sfxId' in x.source && x.source.sfxId === s.id) : (tl?.scoreItems ?? []).filter((x) => x.scoreClipId === s.id)
      const span = input.span != null ? spans[Math.round(Number(input.span)) - 1] : spans.length === 1 ? spans[0] : undefined
      if (input.span != null && !span) return { error: `"${s.name}" has ${spans.length} span${spans.length === 1 ? '' : 's'} on the timeline on screen — no span ${String(input.span)}` }
      if (m.videoToMusic && !span) return { error: spans.length ? `"${s.name}" has ${spans.length} spans on the timeline on screen — say which (span: 1…)` : `"${s.name}" is made from footage: put it on the timeline on screen first (${s.kind === 'sfx' ? 'set_timeline_audio, sound_fx' : 'set_timeline_scores'}) — it makes the sound of what lies under its span` }
      if (s.kind === 'sfx' && !m.videoToMusic && !String(s.recipe.options?.styleText ?? '').trim()) return { error: `"${s.name}" has no words yet — set_score style says what the sound is` }
      const via = { fal: 'fal', elevenlabs: 'ElevenLabs', google: 'Google', local: 'Local' }[m.provider]
      return { what: `${s.kind === 'sfx' ? 'sound fx' : 'score'} "${s.name}"`, job: { kind: 'score', label: s.name, engineLabel: `${m.label} · via ${via}`, payload: scoreRenderRequest(s, p, span?.id) } }
    }
    case 'voice': {
      const v = voiceBy(p, input.id)
      if (!v) return { error: `no voice with id or name ${String(input.id)}` }
      if (!(v.recipe.testLine ?? '').trim()) return { error: `voice "${v.name}" has no test line — every take needs words to speak (set_voice test_line)` }
      const m = audioModelFor(v.recipe.engine)
      const via = { fal: 'fal', elevenlabs: 'ElevenLabs', google: 'Google', local: 'Local' }[m.provider]
      return { what: `voice "${v.name}"`, job: { kind: 'voice', label: v.name, engineLabel: `${m.label} · via ${via}`, payload: { voiceClipId: v.id, engine: m.id } } }
    }
    case 'image_edit': {
      const prompt = String(input.prompt ?? '').trim()
      if (!prompt) return { error: 'an image edit needs a prompt: what to change (or, with no image, what to make)' }
      const root = input.image != null && input.image !== '' ? imageBy(p, input.image) : undefined
      if (input.image != null && input.image !== '' && !root) return { error: `no Library image ${String(input.image)}` }
      const model = input.model != null ? PICKABLE_IMAGE_MODELS.find((m) => m.id === input.model) : PICKABLE_IMAGE_MODELS[0]
      if (!model) return { error: `no such image model ${String(input.model)} — one of ${PICKABLE_IMAGE_MODELS.map((m) => m.id).join(', ')}` }
      const via = imageViaFor(model, typeof input.via === 'string' ? input.via : 'fal')
      if (!via || !via.ready) return { error: `${model.label} is not served by ${String(input.via)} — one of ${model.vias.filter((x) => x.ready).map((x) => x.id).join(', ')}` }
      const refTitles = Array.isArray(input.refs) ? (input.refs as string[]) : []
      const refs = refTitles.map((t) => imageBy(p, t))
      const missing = refTitles.filter((_, i) => !refs[i])
      if (missing.length) return { error: `no Library image ${missing.join(', ')}` }
      if ((root ? 1 : 0) + refs.length > model.maxImages) return { error: `${model.label} takes ${model.maxImages} images in all (the base and its refs)` }
      const aspects = root ? model.aspectRatiosEdit : model.aspectRatiosGenerate
      const aspect = typeof input.aspect === 'string' ? input.aspect : aspects[0]
      if (!(via.aspects ?? aspects).includes(aspect)) return { error: `${model.label} takes aspect ${(via.aspects ?? aspects).join(' / ')} — not ${aspect}` }
      const sizes = via.resolutions ?? model.resolutions
      const resolution = typeof input.resolution === 'string' ? input.resolution : sizes?.[0]
      if (resolution && sizes && !sizes.includes(resolution)) return { error: `${model.label} on ${via.label} makes ${sizes.join(' / ')} — not ${resolution}` }
      const n = Math.max(1, Math.min(model.maxVariants, Math.round(Number(input.variants)) || 1))
      const each = (via.price ?? model.price)({ resolution, quality: model.qualities?.[0], refs: refs.length })
      return {
        what: `image edit of ${root?.title ?? 'a new image'}`,
        job: {
          kind: 'image',
          label: `${root?.title ?? 'new image'} · image edit`,
          engineLabel: model.label,
          ...(each * n > 0 ? { estCost: each * n } : {}),
          payload: { rootImageId: root?.id ?? '', parentNodeId: null, prompt, refIds: refs.map((r) => r!.id), numImages: n, aspectRatio: aspect, model: model.id, via: via.id, resolution, quality: model.qualities?.[0], background: model.backgrounds?.[0] }
        }
      }
    }
    case 'video_edit': {
      const m = EDIT_ENGINES.find((x) => x.id === input.engine)
      if (!m) return { error: `no such video edit engine ${String(input.engine)} — one of ${EDIT_ENGINES.map((x) => x.id).join(', ')}` }
      let root: VeditArgs['root']
      let name: string
      let natSec: number | undefined
      if (input.video != null) {
        const v = videoBy(p, input.video)
        if (!v) return { error: `no Library video ${String(input.video)}` }
        root = { videoId: v.id }
        name = v.title
        natSec = v.durationSec
      } else {
        const c = clipBy(p, input.id)
        const t = c ? (input.take != null ? takeN(c.takes, input.take) : playing(c)) : undefined
        if (!c || !t) return { error: `no such take: clip ${String(input.id)}${input.take != null ? ` take ${String(input.take)}` : ''}` }
        root = { takeRef: { clipId: c.id, takeId: t.id } }
        name = `${c.name} · T${c.takes.indexOf(t) + 1}`
        natSec = t.durationSec
      }
      const caps = m.v2v
      const windowed = num(input.in_sec) != null && num(input.out_sec) != null && (input.out_sec as number) > (input.in_sec as number)
      const win = windowed ? { inSec: input.in_sec as number, outSec: input.out_sec as number } : {}
      const span = windowed ? (input.out_sec as number) - (input.in_sec as number) : natSec
      if (caps && span != null && span > caps.maxInSec + 0.05) return { error: `${m.label} takes ${caps.maxInSec}s of video at most — this is ${span.toFixed(1)}s. Send in_sec and out_sec for the part to edit.` }
      const prompt = String(input.prompt ?? '').trim()
      let lip: { lipAudio: AudioRef; syncMode?: string } | undefined
      if (caps?.lipsync) {
        const voice = input.voice != null ? voiceBy(p, input.voice) : undefined
        const audio = input.audio != null ? audioBy(p, input.audio) : undefined
        if (!voice && !audio) return { error: `${m.label} matches the mouths to a sound — send voice (a Bin voice) or audio (a Library audio title)` }
        lip = { lipAudio: voice ? { voiceId: voice.id } : { audioId: audio!.id }, ...(caps.lipsync.modes ? { syncMode: caps.lipsync.modes.includes(String(input.sync_mode)) ? String(input.sync_mode) : caps.lipsync.modes[0] } : {}) }
      } else if (!prompt) return { error: 'a video edit needs a prompt: what to change' }
      const est = caps ? (span ?? 0) * (caps.pricePerSecOut + caps.pricePerSecIn) : 0
      return {
        what: `${caps?.lipsync ? 'lip-sync' : caps?.extend ? 'extend' : caps ? 'edit' : 're-gen'} of ${name}`,
        job: {
          kind: 'vedit',
          label: `${name} · ${caps?.lipsync ? 'lip-sync' : caps?.extend ? 'extend' : caps ? 'edit' : 're-gen'}`,
          engineLabel: m.label,
          ...(est > 0 ? { estCost: est } : {}),
          payload: { engine: m.id as EngineId, prompt: lip ? `lip-sync to ${input.voice ?? input.audio}` : prompt, root, parentId: null, ...win, ...(lip ?? {}), ...(caps ? {} : { duration: 'auto', resolution: m.resolutions.includes('720p') ? '720p' : m.resolutions[0], aspectRatio: 'auto', generateAudio: true }) } satisfies VeditArgs
        }
      }
    }
    default:
      return { error: 'kind must be clip, image_gen, score, voice, image_edit or video_edit' }
  }
}
