// Pre-render validation against the active model's capability descriptor — catches what would
// otherwise be a PAID fal 422 (or a silently-dropped input) before the user spends credits.
import type { ModelDescriptor } from '../../../shared/models'

export interface RenderFormCheck {
  mode: 'ref2v' | 'i2v'
  promptEmpty: boolean
  refCount: number
  hasStart: boolean
  hasEnd: boolean
  duration: string
  resolution: string
  aspect: string
}

export interface ValidationResult {
  errors: string[] // block the render
  warnings: string[] // allowed, but the user should know
}

export function validateForm(f: RenderFormCheck, m: ModelDescriptor): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (f.promptEmpty) errors.push('write a prompt or fill some fields first')

  if (!m.modes.includes(f.mode)) {
    errors.push(`${m.label} doesn't support ${f.mode} — switch the render mode (your inputs are kept)`)
  } else if (f.mode === 'i2v') {
    if (!f.hasStart) errors.push('set a start frame first')
    if (f.hasEnd && !m.endFrame) warnings.push(`${m.label} has no end frame — the end image is kept but will NOT be sent`)
  } else {
    if (f.refCount === 0) errors.push('add at least one reference image')
    if (f.refCount > m.maxRefImages) errors.push(`too many reference images for ${m.label} (${f.refCount}/${m.maxRefImages})`)
  }

  if (!m.durations.includes(f.duration))
    errors.push(`duration ${f.duration} isn't valid for ${m.label} (use ${m.durations.join(' / ')})`)
  if (!m.resolutions.includes(f.resolution))
    errors.push(`resolution ${f.resolution} isn't valid for ${m.label} (use ${m.resolutions.join(' / ')})`)
  if (!m.aspectRatios.includes(f.aspect))
    errors.push(`aspect ${f.aspect} isn't valid for ${m.label} (use ${m.aspectRatios.join(' / ')})`)

  return { errors, warnings }
}
