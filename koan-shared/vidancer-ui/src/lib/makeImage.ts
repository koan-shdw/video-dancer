import { vd } from '../api'
import { useStore } from '../store'
import { openCoDirector, openImageGen } from '../panelBus'
import { ASPECTS } from '../panels/ImageGen'
import { loraFolderMatch } from './settingsMenu'
import { toast } from '../ui/Toast'

// MAKE IMAGE (Library right-click, his ask 2026-10-15): a new Image Gen card filled from what made
// this image. First the Image Gen take it was saved from (the whole recipe), else the settings baked
// into the PNG (another Comfy, A1111), else the Image Editor prompt that made it. The seed stays
// random: a new image, not a copy. With none of it the card opens on its defaults and the
// Co-Director asks whether to help fill it in.

const baseOf = (name: string): string => name.split(/[\\/]/).pop()?.replace(/\.safetensors$/i, '') ?? name

// the PNG's pixel size → the nearest aspect and size the card offers
function sizeOf(w: number, h: number): Pick<ImageGenRecipe, 'aspect' | 'megapixels'> {
  const ratio = (a: string): number => {
    const [x, y] = a.split(':').map(Number)
    return x / y
  }
  const aspect = ASPECTS.reduce((best, a) => (Math.abs(Math.log(ratio(a) / (w / h))) < Math.abs(Math.log(ratio(best) / (w / h))) ? a : best))
  const megapixels = [1, 1.5, 2].reduce((best, m) => (Math.abs(m - (w * h) / 1e6) < Math.abs(best - (w * h) / 1e6) ? m : best))
  return { aspect, megapixels }
}

export async function recipeFromImage(p: Project, im: ProjImage): Promise<{ recipe: Partial<ImageGenRecipe>; left: string[] } | null> {
  for (const g of p.imageGens ?? []) {
    const t = g.takes.find((x) => x.keptImageId === im.id)
    if (t) return { recipe: { ...t.snapshot, seed: 0 }, left: [] }
  }
  if (/\.png$/i.test(im.file)) {
    const r = await vd().imageGenReadPng(im.file).catch(() => null)
    const s = r?.ok ? r.settings : undefined
    if (s && (s.prompt.trim() || s.loras.length)) {
      const rows = await vd().imageGenLoras().catch(() => [] as FolderLoraRow[])
      const hits = s.loras.map((l) => ({ l, row: loraFolderMatch(l, rows) }))
      const found = hits.filter((h) => h.row)
      const loras = found.slice(0, 2).map((h) => ({ name: h.row!.rel, weight: Math.max(0, Math.min(2, h.l.weight)) })) // two slots
      const left = [...hits.filter((h) => !h.row), ...found.slice(2)].map((h) => baseOf(h.l.name))
      return { recipe: { prompt: s.prompt, loras, loraOn: true, ...(s.width && s.height ? sizeOf(s.width, s.height) : {}) }, left }
    }
  }
  const node = p.editSessions.flatMap((s) => s.nodes).find((n) => n.keptImageId === im.id)
  const prompt = node?.prompt ?? (im.editedFrom ? im.genPrompt : undefined)
  return prompt?.trim() ? { recipe: { prompt }, left: [] } : null
}

export async function makeImageFrom(im: ProjImage): Promise<void> {
  const st = useStore.getState()
  if (!st.project) return
  const found = await recipeFromImage(st.project, im)
  const id = await st.createImageGen(undefined, found?.recipe)
  if (!id) return
  useStore.getState().setEditorImageGen(id)
  openImageGen()
  if (found) {
    if (found.left.length) toast(`left out (not in your lora folders, or past the two slots): ${found.left.join(', ')}`, { kind: 'error' })
    return
  }
  const name = useStore.getState().project?.imageGens?.find((g) => g.id === id)?.name ?? 'the new image gen'
  const d = await vd().codirSay(
    `${im.title} has no prompt data, so I opened "${name}" with its defaults. Want me to fill it in? I'll look at the image and write the prompt and aspect straight into that card.`,
    // his yes IS the go for these two writes (10-15: the guide's picture-first + go gate made it stop twice)
    { yes: `yes, go: look at ${im.title} and write a prompt into the image gen "${name}" that makes an image like it, and set its aspect to match. Write them straight in, no need to check with me first; I'll check the card before Generate. Don't render.` },
    [im.id]
  )
  if (d) useStore.getState().applyDelta(d)
  openCoDirector()
}
