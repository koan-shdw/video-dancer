// Pre-render validation against the active model's capability descriptor — catches what would
// otherwise be a PAID fal 422 (or a silently-dropped input) before the user spends credits.
import type { ModelDescriptor } from '../../../shared/models'

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
  audioRefTotalSec?: number
}

export interface ValidationResult {
  errors: string[] // block the render
  warnings: string[] // allowed, but the user should know
}

export function validateForm(f: RenderFormCheck, m: ModelDescriptor): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

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
    if (m.maxRefVideos > 0 && vids > 0) {
      if (f.videoRefTotalSec != null && f.videoRefTotalSec > 15.05)
        errors.push(`video refs are ${f.videoRefTotalSec.toFixed(1)}s combined — fal caps them at 15s. Trim the ✂ windows.`)
      if (f.videoRefTotalSec != null && f.videoRefTotalSec < 2) errors.push('video refs must be at least 2s combined (fal minimum)')
    }
    if (m.maxRefAudios > 0 && auds > 0) {
      if (f.refCount + vids === 0) errors.push('audio refs need at least one image or video ref alongside them (fal rule)')
      if (f.audioRefTotalSec != null && f.audioRefTotalSec > 15.05)
        errors.push(`audio refs are ${f.audioRefTotalSec.toFixed(1)}s combined — fal caps them at 15s. Trim the ✂ windows.`)
    }
    if (m.maxRefVideos > 0 && f.refCount + vids + auds > 12)
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
