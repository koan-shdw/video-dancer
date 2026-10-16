import { vd } from '../api'
// The download WIZARD (LOCAL-MODELS-PLAN phase 4) — the ONE flow between "I want this model"
// and the Models card owning the download. Every entry point funnels here: the card's own
// download buttons AND the engine pickers (Score, Clip Gen, Voices) when an undownloaded
// local engine is chosen. Runs in the app's one confirm shell (law 11): the facts — size,
// disk space, GPU, variant recommendation — then Download / Cancel. Recommends, never
// restricts. Confirm hands off to the card scrolled to the row; the card owns it from there.
import { confirmDialog } from '../prompt'
import { localModelFor, LOCAL_MODELS, type LocalModelDef } from '../shared/localModels'
import { openModelsCard } from '../panelBus'
import { useStore } from '../store'

const GB = 1 << 30
const fmtGB = (n: number): string => `${(n / GB).toFixed(1)} GB`

// "~66 GB" / "~150 MB" → bytes for the disk check; "size TBC" → null (no fake math)
function parseSizeNote(note: string): number | null {
  const m = note.match(/([\d.]+)\s*(GB|MB)/i)
  if (!m) return null
  return Number(m[1]) * (m[2].toUpperCase() === 'GB' ? GB : 1 << 20)
}

// the LTX group: which size fits this GPU (recommends, never restricts). MEASURED law
// (user, sprite-dancer live testing 2026-08-27): int8 renders ~40× faster than Q5 GGUF on a
// 16 GB card (~5s vs ~200s a step — GGUF dequant is the drag), so int8 is the pick down to
// 12 GB ("rec int8 it works great"); the GGUF sizes stay downloadable for smaller cards.
export function recommendLtxVariant(vramMB: number | undefined): { id: string; why: string } | null {
  if (!vramMB) return null
  const gb = vramMB / 1024
  if (gb >= 12) return { id: 'ltx-2.5-quality', why: `int8 measured ~40× faster than the GGUF sizes on ${gb.toFixed(0)}GB — and it's the best-looking tier` }
  return { id: 'ltx-2.5-minimum', why: `Q2 is the only size that fits ${gb.toFixed(0)}GB — expect soft output` }
}

// the Krea 2 group (KREA2-LOCAL-SPEC §7): NOT measured yet — the recommendation is the docs'
// (fp8 for most cards; nvfp4 only on Blackwell); it says so. Warns on a too-big file, never blocks.
export function recommendKrea2Variant(vramMB: number | undefined, gpuName?: string): { id: string; why: string } | null {
  if (!vramMB) return null
  const gb = vramMB / 1024
  const blackwell = /RTX\s*50|B\d{3}/i.test(gpuName ?? '')
  if (gb >= 12) return { id: 'krea-2-quality', why: `fp8 is the build the docs recommend for ${gb.toFixed(0)} GB — not measured here yet` }
  if (blackwell) return { id: 'krea-2-compact', why: `nvfp4 is half the size and your card can run it — not measured here yet` }
  return { id: 'krea-2-standard', why: `int8 is the smallest build your card supports — expect RAM offload on ${gb.toFixed(0)} GB` }
}

const line: React.CSSProperties = { display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.6 }
const key: React.CSSProperties = { color: 'var(--dim)', width: 86, flex: '0 0 auto', fontFamily: 'var(--mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }

// Ready models leave the current editor in front. The Models card owns download progress
// only when setup is still needed or already running.
export async function modelWizard(modelId: string): Promise<boolean> {
  // the LTX parent id is a group header with no files of its own — route to the size the
  // GPU probe recommends (the wizard dialog still shows the suggestion line either way)
  if (modelId === 'ltx-2.5') {
    const list = await vd().modelsList()
    const rec = recommendLtxVariant(list.gpu?.vramMB)
    return modelWizard(rec?.id ?? 'ltx-2.5-minimum')
  }
  if (modelId === 'krea-2') {
    const list = await vd().modelsList()
    const rec = recommendKrea2Variant(list.gpu?.vramMB, list.gpu?.name)
    return modelWizard(rec?.id ?? 'krea-2-quality')
  }
  const m = localModelFor(modelId)
  if (!m) return false
  const focusAndRaise = (id: string): void => {
    useStore.getState().setModelsFocus(id)
    openModelsCard()
  }
  const installable = !!m.files?.length || m.id === 'python-runtime' || m.id === 'ace-step-1.5' || m.id === 'minimax-music-3' || m.id === 'ltx-comfy-engine' || m.id === 'minimax-h3-kernels'
  if (!installable) {
    // nothing to download yet (engine files land in a later phase) — the row's gated state explains
    focusAndRaise(m.id)
    return false
  }
  const list = await vd().modelsList()
  const row = list.rows.find((r) => r.id === m.id)
  if (row?.status === 'ready') return true
  if (row?.status === 'downloading') {
    focusAndRaise(m.id)
    return true
  }
  const free = await vd().modelsDiskFree()
  const need = parseSizeNote(m.sizeNote)
  const tooTight = need !== null && free !== null && free < need * 1.1 // 10% headroom
  const rec = m.variantOf === 'ltx-2.5' || m.id === 'ltx-2.5' ? recommendLtxVariant(list.gpu?.vramMB) : m.variantOf === 'krea-2' ? recommendKrea2Variant(list.gpu?.vramMB, list.gpu?.name) : null
  // warn, never block (his order 2026-09-08): a file bigger than the card runs with RAM offload, slower
  const fileBytes = (m.files ?? []).reduce((a, f) => a + (f.bytes ?? 0), 0)
  const overVram = !!list.gpu && fileBytes > list.gpu.vramMB * 1024 * 1024 && m.category === 'image' && m.id !== 'krea-2-core'
  const recModel: LocalModelDef | undefined = rec ? LOCAL_MODELS.find((x) => x.id === rec.id) : undefined
  const ok = await confirmDialog(
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt-hi)', marginBottom: 8 }}>
        {m.label} <span style={{ color: 'var(--dim)', fontSize: 11 }}>— {m.blurb}</span>
      </div>
      <div style={line}>
        <span style={key}>download</span>
        <span>
          {(row?.filesDone ?? 0) > 0
            ? `resumes — ${row?.bytesLeft ? fmtGB(row.bytesLeft) : 'the rest'} left of ${m.sizeNote} (${row?.filesDone}/${row?.filesTotal} files already on disk)`
            : `${m.sizeNote || 'size read from the manifest'} · once, into the app's models folder`}
        </span>
      </div>
      {m.variantOf === 'krea-2' && m.id !== 'krea-2-core' && (
        <div style={line}>
          <span style={key}>first time</span>
          <span>also fetches the local engine (~7 GB), its Krea 2 refs nodes, and the essentials (~7.8 GB) if missing — later builds reuse them</span>
        </div>
      )}
      {overVram && (
        <div style={line}>
          <span style={key}>heads up</span>
          <span style={{ color: 'var(--amber)' }}>bigger than your card — runs with RAM offload, slower</span>
        </div>
      )}
      {m.variantOf === 'ltx-2.5' && m.id !== 'ltx-2.5-core' && (
        // download honesty: the first LTX size also pulls the engine + shared essentials
        <div style={line}>
          <span style={key}>first time</span>
          <span>also fetches the LTX engine (~7 GB) and essentials (~8 GB) if missing — later sizes reuse them</span>
        </div>
      )}
      <div style={line}>
        <span style={key}>disk</span>
        <span style={tooTight ? { color: 'var(--bad)' } : undefined}>
          {free === null ? 'free space unknown' : `${fmtGB(free)} free${tooTight ? ' — tight for this download' : ''}`}
        </span>
      </div>
      <div style={line}>
        <span style={key}>gpu</span>
        <span>{list.gpu ? `${list.gpu.name} · ${(list.gpu.vramMB / 1024).toFixed(0)} GB` : 'no NVIDIA GPU found — local renders will be slow or unavailable'}</span>
      </div>
      {rec && recModel && (
        <div style={line}>
          <span style={key}>suggests</span>
          <span style={rec.id === m.id ? { color: 'var(--ok)' } : { color: 'var(--amber)' }}>
            {rec.id === m.id ? `this size — ${rec.why}` : `${recModel.label} — ${rec.why} (your pick still downloads)`}
          </span>
        </div>
      )}
    </div>,
    { confirmLabel: 'Download' }
  )
  if (!ok) return false
  focusAndRaise(m.id) // the card owns progress from here (spec: confirm opens the card at the row)
  void vd().modelsDownload(m.id)
  return true
}


// civit checkpoint wizard (KREA2-LOCAL-SPEC §7): the same facts — size, disk, GPU, the over-VRAM
// warning — for a Civitai row that has no registry entry. Warns, never blocks.
export async function civitCheckpointWizard(it: CivitVersionRow): Promise<boolean> {
  const [list, free] = await Promise.all([vd().modelsList(), vd().modelsDiskFree()])
  const need = it.bytes ?? 0
  const tooTight = need > 0 && free !== null && free < need * 1.1
  const overVram = !!list.gpu && need > list.gpu.vramMB * 1024 * 1024
  return confirmDialog(
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt-hi)', marginBottom: 8 }}>
        {it.name} <span style={{ color: 'var(--dim)', fontSize: 11 }}>— a Krea 2 checkpoint from civitai.com{it.author ? ` by ${it.author}` : ''}</span>
      </div>
      <div style={line}>
        <span style={key}>download</span>
        <span>{need ? fmtGB(need) : 'size unknown'} · once, into the app's models folder (image/civit)</span>
      </div>
      <div style={line}>
        <span style={key}>needs</span>
        <span>the local engine + Krea 2 essentials to render — the official rows above fetch them</span>
      </div>
      <div style={line}>
        <span style={key}>disk</span>
        <span style={tooTight ? { color: 'var(--bad)' } : undefined}>{free === null ? 'free space unknown' : `${fmtGB(free)} free${tooTight ? ' — tight for this download' : ''}`}</span>
      </div>
      <div style={line}>
        <span style={key}>gpu</span>
        <span>{list.gpu ? `${list.gpu.name} · ${(list.gpu.vramMB / 1024).toFixed(0)} GB` : 'no NVIDIA GPU found'}</span>
      </div>
      {overVram && (
        <div style={line}>
          <span style={key}>heads up</span>
          <span style={{ color: 'var(--amber)' }}>bigger than your card — runs with RAM offload, slower</span>
        </div>
      )}
    </div>,
    { confirmLabel: 'Download' }
  )
}
