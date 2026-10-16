// Pre-render validation against the active model's capability descriptor — catches what would
// otherwise be a PAID fal 422 (or a silently-dropped input) before the user spends credits.
import type { ModelDescriptor } from '../shared/models'

export interface RenderFormCheck {
  mode: 'ref2v' | 'i2v' | 't2v' // t2v (his mode, 2026-09-01): words only — refs park, none required
  promptEmpty: boolean
  refCount: number
  hasStart: boolean
  hasEnd: boolean
  duration: string
  resolution: string
  aspect: string
  // Seedance multimodal refs (0/absent on engines without them)
  videoRefCount?: number
  audioRefCount?: number
  videoRefTotalSec?: number // combined windowed length; undefined = some durations still unknown
  videoRefSecs?: (number | null | undefined)[] // each slot's windowed length, in slot order (null = not known yet)
  audioRefTotalSec?: number
  audioRefSecs?: (number | null | undefined)[] // each audio slot's windowed length (null = not known yet)
}

export interface ValidationResult {
  errors: string[] // block the render
  warnings: string[] // allowed, but the user should know
}

export function validateForm(f: RenderFormCheck, m: ModelDescriptor): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // list 23: a talking still is one picture + one sound; no words are sent, the sound is the length
  if (m.talkingStill) {
    const auds = f.audioRefCount ?? 0
    if (f.mode !== 'ref2v') errors.push(`${m.label} makes a talking video from a picture and a voice — switch the mode to ref2v (your inputs are kept)`)
    if (f.refCount !== 1) errors.push(f.refCount ? `${m.label} takes one picture (${f.refCount} are attached)` : 'add the picture that talks (one reference image)')
    if (auds !== 1) errors.push(auds ? `${m.label} takes one voice (${auds} audio refs are attached)` : 'add the voice it speaks with (one audio ref: a Library track or a Bin voice)')
    const sec = f.audioRefSecs?.[0]
    if (auds === 1 && sec != null && sec < m.talkingStill.minAudioSec) errors.push(`the voice is ${sec.toFixed(1)}s — ${m.label} needs at least ${m.talkingStill.minAudioSec}s`)
    if (auds === 1 && sec != null && sec > m.talkingStill.maxAudioSec) errors.push(`the voice is ${Math.round(sec / 60)} min — ${m.label} takes ${Math.round(m.talkingStill.maxAudioSec / 60)} min at most`)
    if ((f.videoRefCount ?? 0) > 0) warnings.push(`${m.label} has no video refs — the @video slots are kept but will NOT be sent`)
    if (!f.promptEmpty) warnings.push(`${m.label} takes no words — the prompt and fields are kept but will NOT be sent`)
    if (!m.resolutions.includes(f.resolution)) errors.push(`resolution ${f.resolution} isn't valid for ${m.label} (use ${m.resolutions.join(' / ')})`)
    return { errors, warnings }
  }

  if (f.promptEmpty) errors.push('write a prompt or fill some fields first')

  const t2vAble = !!m.endpoints.t2v || !!m.provider // fal t2v slug, or an adapter with zero-ref grammar
  if (f.mode === 't2v') {
    if (!t2vAble) errors.push(`${m.label} can't render from words alone — it needs at least one reference`)
    // refs/frames stay parked in the UI, never sent — nothing else to check here
  } else if (!m.modes.includes(f.mode)) {
    errors.push(`${m.label} doesn't support ${f.mode} — switch the render mode (your inputs are kept)`)
  } else if (f.mode === 'i2v') {
    if (!f.hasStart) errors.push('set a start frame first')
    if (f.hasEnd && !m.endFrame) warnings.push(`${m.label} has no end frame — the end image is kept but will NOT be sent`)
  } else {
    const vids = f.videoRefCount ?? 0
    const auds = f.audioRefCount ?? 0
    // ref2v with zero refs: engines that can go words-only point at the t2v mode instead of
    // blocking; engines that can't still refuse (paid 422 guard)
    if (m.maxRefImages > 0 && f.refCount === 0 && (vids === 0 || m.maxRefVideos === 0))
      errors.push(t2vAble ? 'no references — switch mode to t2v to render from words alone' : 'add at least one reference (image or video)')
    if (f.refCount > m.maxRefImages) errors.push(`too many reference images for ${m.label} (${f.refCount}/${m.maxRefImages})`)
    // video/audio refs: engines without support keep the slots visibly parked (never silently sent)
    if (vids > 0 && m.maxRefVideos === 0) warnings.push(`${m.label} has no video refs — the @video slots are kept but will NOT be sent`)
    if (auds > 0 && m.maxRefAudios === 0) warnings.push(`${m.label} has no audio refs — the @audio slots are kept but will NOT be sent`)
    if (m.maxRefVideos > 0 && vids > m.maxRefVideos) errors.push(`too many video refs for ${m.label} (${vids}/${m.maxRefVideos})`)
    if (m.maxRefAudios > 0 && auds > m.maxRefAudios) errors.push(`too many audio refs for ${m.label} (${auds}/${m.maxRefAudios})`)
    if (m.maxRefVideos > 0 && vids > 0 && m.refVideoEachMaxSec) {
      // list 13 (Omni 1.1): each clip has its own cap, there is no combined rule
      const secs = f.videoRefSecs ?? []
      const over = secs.findIndex((x) => x != null && x > m.refVideoEachMaxSec! + 0.05)
      if (over >= 0) errors.push(`@video${over + 1} is ${secs[over]!.toFixed(1)}s — ${m.label} takes ${m.refVideoEachMaxSec}s per video ref at most. Trim its ✂ window.`)
    } else if (m.maxRefVideos > 0 && vids > 0) {
      if (f.videoRefTotalSec != null && f.videoRefTotalSec > 15.05)
        errors.push(`video refs are ${f.videoRefTotalSec.toFixed(1)}s combined — fal caps them at 15s. Trim the ✂ windows.`)
      if (f.videoRefTotalSec != null && f.videoRefTotalSec < 2) errors.push('video refs must be at least 2s combined (fal minimum)')
    }
    if (m.maxRefAudios > 0 && auds > 0) {
      if (f.refCount + vids === 0) errors.push('audio refs need at least one image or video ref alongside them (fal rule)')
      if (f.audioRefTotalSec != null && f.audioRefTotalSec > 15.05)
        errors.push(`audio refs are ${f.audioRefTotalSec.toFixed(1)}s combined — fal caps them at 15s. Trim the ✂ windows.`)
    }
    if (m.maxRefVideos > 0 && !m.refVideoEachMaxSec && f.refCount + vids + auds > 12)
      errors.push(`${f.refCount + vids + auds} reference files — fal caps 12 across images+videos+audio`)
  }

  if (!m.durations.includes(f.duration))
    errors.push(`duration ${f.duration} isn't valid for ${m.label} (use ${m.durations.join(' / ')})`)
  if (!m.resolutions.includes(f.resolution))
    errors.push(`resolution ${f.resolution} isn't valid for ${m.label} (use ${m.resolutions.join(' / ')})`)
  if (!m.aspectRatios.includes(f.aspect))
    errors.push(`aspect ${f.aspect} isn't valid for ${m.label} (use ${m.aspectRatios.join(' / ')})`)

  return { errors, warnings }
}
