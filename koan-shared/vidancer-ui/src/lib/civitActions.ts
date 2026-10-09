import { vd } from '../api'
import { useStore } from '../store'
import { toast } from '../ui/Toast'
import { openCoDirector } from '../panelBus'

// ----- what BOTH callers of the settings menu do with a Civitai like (CIVIT-DRAG-SPEC-2026-09-19):
// the Watched panel's civit tiles and Image Gen's `drop png or a civit like` box. One copy. -----

// the bases Image Gen's engine can load — the sidebar's civit tab filters to the same list
export const KREA_BASES = ['Krea 2']
export const baseSupported = (base?: string): boolean => !base || KREA_BASES.some((b) => b.toLowerCase() === base.toLowerCase())

// the full image to disk through main (cached there), then into the Library
export async function civitImport(id: number, url: string): Promise<string[]> {
  const r = await vd().civitImageFile(id, url)
  if (!r.ok || !r.file) {
    toast(r.error ?? 'could not fetch the image', { kind: 'error' })
    return []
  }
  return useStore.getState().importPaths([r.file])
}

// import → the Library's `civit` folder → his @title in the Co-Director's box with the ask; he sends
export async function civitToCoDirector(id: number, url: string): Promise<void> {
  const ids = await civitImport(id, url)
  const st = useStore.getState()
  if (!ids.length || !st.project) return
  let folder = st.project.folders.find((f) => f.kind === 'lib' && f.name === 'civit' && !f.parent)?.id ?? null
  if (!folder) folder = await st.addFolder('lib', 'civit', null)
  if (folder) await st.moveItems('lib', ids, folder)
  const title = useStore.getState().project?.images.find((i) => i.id === ids[0])?.title ?? ''
  st.setCodirSeed(`${title} write an image gen prompt from this`.trim())
  openCoDirector()
}

// GET + USE (§4): a lora the image used, known only by its Civitai version id → the row the ONE
// downloader takes → downloaded (own folder, sha gate, support files, the sidebar's progress) →
// its `rel` in his folders, ready for a slot. A lora made for another base is refused here too
// (his call: "skip loras not in supported model") — the row's own base is the last word.
export async function getLoraByVersion(versionId: number, onNote?: (msg: string) => void): Promise<{ ok: true; rel: string } | { ok: false; error: string }> {
  const get = vd().imageGenCivitGetVersion
  if (!get) return { ok: false, error: 'restart Video Dancer to download from here — this window is still running the older app core' }
  onNote?.('asking Civitai for the lora…')
  const v = await get(versionId)
  if (!v.ok || !v.row) return { ok: false, error: v.error ?? 'Civitai did not answer' }
  if (!baseSupported(v.row.baseModel)) return { ok: false, error: `${v.row.name} is made for ${v.row.baseModel} — Krea 2 can't load it` }
  onNote?.(`getting ${v.row.name}…`)
  const d = await vd().imageGenCivitDownload(v.row)
  if (!d.ok) return { ok: false, error: d.error ?? 'download failed' }
  // the folder scan indexes the new file a beat after it lands — look a few times
  for (let i = 0; i < 8; i++) {
    const rows = await vd().imageGenLoras()
    // this version first; a same-named file of another version never stands in for it (audit 2026-10-09 M45)
    const hit = rows.find((x) => x.civitKey === v.row!.key || !!x.civitKey?.endsWith(`:${versionId}`)) ?? rows.find((x) => !x.civitKey && x.file.toLowerCase() === v.row!.file.toLowerCase())
    if (hit) return { ok: true, rel: hit.rel }
    await new Promise((r) => setTimeout(r, 700))
  }
  return { ok: false, error: `${v.row.name} downloaded, but it has not shown up in your lora folder yet — it is in the sidebar's local tab in a moment` }
}
