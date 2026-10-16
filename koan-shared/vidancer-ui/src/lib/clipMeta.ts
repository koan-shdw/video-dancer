import { MODELS } from '../shared/models'

// model / render details line shown in the details overlays + bin details strip
export function clipModelLine(c: Clip): string {
  const pd = c.promptData
  const label = MODELS[pd.engine ?? 'seedance2']?.label ?? 'Seedance 2'
  const parts: string[] = [label, pd.mode, `${pd.duration}s`, pd.resolution, pd.aspectRatio]
  if (pd.generateAudio) parts.push('audio')
  return parts.join(' · ')
}

// the seed shown for a clip: its keeper take's, else the last take's, else the recipe's
export function clipSeed(c: Clip): number | undefined {
  const keeper = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
  return keeper?.seed ?? c.promptData.seed
}
