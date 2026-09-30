// list 17 (2026-09-30) — Seedance 2.5's Draft mode: a 480p Draft first, then the same video at
// 1080p from the Draft's id, within seven days, on the account that made it (fal and ModelArk;
// docs/SEEDANCE25-DRAFT-LANE-2026-09-30.md). Pure: what a landed take remembers about its Draft,
// and the request that finishes it.
import { modelFor } from '@koan/vidancer-ui/shared/models'
import { draftLeftMs, DRAFT_DAYS } from '@koan/vidancer-ui/shared/types'
import type { Project, PromptData, Take } from '@koan/vidancer-ui/shared/types'
import type { RenderRequest } from './fal'

// only a Draft render that came back with an id, on the two suppliers that have the mode.
// `at` starts the seven days.
export const draftOf = (req: { draft?: boolean; draftId?: string }, id: string | undefined, provider: string, at = Date.now()): Take['draft'] =>
  req.draft && !req.draftId && id && (provider === 'fal' || provider === 'modelark') ? { id, via: provider, at } : undefined

export type DraftFinishRequest = RenderRequest &
  Pick<PromptData, 'freeform' | 'scene' | 'characters' | 'beats' | 'production' | 'videoRefs' | 'audioRefs' | 'promptLink' | 'fieldLinks' | 'fieldOverrides' | 'characterLinks'> & { clipId: string; name: string; draftId: string }

// The FINISH of a Draft. The panel names the take; the request is rebuilt from the take's own frozen
// recipe, because the supplier re-uses the Draft's prompt, refs, seed, shape and length and takes
// nothing but its id. The images are the Library's own files, so landing (and crash recovery)
// finds the same entries again instead of importing copies.
export function draftFinishRequest(proj: Project | null, fd: { clipId: string; takeId: string }, now = Date.now()): { req: DraftFinishRequest } | { error: string } {
  const clip = proj?.clips.find((c) => c.id === fd.clipId)
  const take = clip?.takes.find((t) => t.id === fd.takeId)
  if (!proj || !clip || !take) return { error: 'that take is gone — nothing to finish' }
  const snap = take.snapshot
  if (!take.draft || !snap) return { error: 'that take is not a draft' }
  const model = modelFor(snap.engine)
  if (!model.draft || (model.provider ?? 'fal') !== take.draft.via) return { error: `this draft was made on another account (${take.draft.via}) — only that account can finish it` }
  if (draftLeftMs(take, now) <= 0) return { error: `this draft is more than ${DRAFT_DAYS} days old — ${model.label} can no longer finish it. Render it again.` }
  const fileOf = (id?: string): string | undefined => proj.images.find((i) => i.id === id)?.file
  return {
    req: {
      clipId: clip.id,
      name: clip.name,
      engine: snap.engine,
      mode: snap.mode === 'i2v' ? 'i2v' : 'ref2v',
      prompt: '',
      freeform: snap.freeform,
      scene: snap.scene,
      characters: snap.characters,
      beats: snap.beats,
      production: snap.production,
      images: snap.imageIds.map(fileOf).filter((f): f is string => !!f),
      endImage: fileOf(snap.endImageId),
      videoRefs: snap.videoRefs,
      audioRefs: snap.audioRefs,
      duration: snap.duration,
      resolution: model.draft.final,
      aspectRatio: snap.aspectRatio,
      generateAudio: snap.generateAudio,
      seed: snap.seed,
      promptLink: snap.promptLink,
      fieldLinks: snap.fieldLinks,
      fieldOverrides: snap.fieldOverrides,
      characterLinks: snap.characterLinks,
      draftId: take.draft.id
    }
  }
}
