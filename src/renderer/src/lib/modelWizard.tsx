// The download WIZARD (LOCAL-MODELS-PLAN phase 4) — the ONE flow between "I want this model"
// and the Models card owning the download. Every entry point funnels here: the card's own
// download buttons AND the engine pickers (Score, Clip Gen, Voices) when an undownloaded
// local engine is chosen. Runs in the app's one confirm shell (law 11): the facts — size,
// disk space, GPU, variant recommendation — then Download / Cancel. Recommends, never
// restricts. Confirm hands off to the card scrolled to the row; the card owns it from there.
import { confirmDialog } from '../prompt'
import { localModelFor, LOCAL_MODELS, type LocalModelDef } from '../../../shared/localModels'
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

// the LTX group: which size fits this GPU (recommends, never restricts) — tiers from the
// verified VRAM table, docs/LTX-SPEC.md §3 (16 GB is LTX's own stated floor for the big tiers)
export function recommendLtxVariant(vramMB: number | undefined): { id: string; why: string } | null {
  if (!vramMB) return null
  const gb = vramMB / 1024
  if (gb >= 24) return { id: 'ltx-2.5-quality', why: `${gb.toFixed(0)}GB VRAM runs the official int8 recipe` }
  if (gb >= 16) return { id: 'ltx-2.5-standard', why: `Q5 is the pick for ${gb.toFixed(0)}GB cards` }
  if (gb >= 12) return { id: 'ltx-2.5-compact', why: `Q4 is the sweet spot for ${gb.toFixed(0)}GB cards` }
  if (gb >= 12) return { id: 'ltx-2.5-small', why: `Q3 is the honest pick for ${gb.toFixed(0)}GB VRAM` }
  return { id: 'ltx-2.5-minimum', why: `Q2 is the only size that fits ${gb.toFixed(0)}GB — expect soft output` }
}

const line: React.CSSProperties = { display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.6 }
const key: React.CSSProperties = { color: 'var(--dim)', width: 86, flex: '0 0 auto', fontFamily: 'var(--mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }

// Returns true when a download was started (or the model was already there). The row on the
// card is the progress UI either way — this function always leaves the user looking at it.
export async function modelWizard(modelId: string): Promise<boolean> {
  // the LTX parent id is a group header with no files of its own — route to the size the
  // GPU probe recommends (the wizard dialog still shows the suggestion line either way)
  if (modelId === 'ltx-2.5') {
    const list = await window.vidancer.modelsList()
    const rec = recommendLtxVariant(list.gpu?.vramMB)
    return modelWizard(rec?.id ?? 'ltx-2.5-minimum')
  }
  const m = localModelFor(modelId)
  if (!m) return false
  const focusAndRaise = (id: string): void => {
    useStore.getState().setModelsFocus(id)
    openModelsCard()
  }
  const installable = !!m.files?.length || m.id === 'python-runtime' || m.id === 'ace-step-1.5' || m.id === 'minimax-music-3' || m.id === 'ltx-comfy-engine'
  if (!installable) {
    // nothing to download yet (engine files land in a later phase) — the row's gated state explains
    focusAndRaise(m.id)
    return false
  }
  const [list, free] = await Promise.all([window.vidancer.modelsList(), window.vidancer.modelsDiskFree()])
  const row = list.rows.find((r) => r.id === m.id)
  if (row?.status === 'ready' || row?.status === 'downloading') {
    focusAndRaise(m.id) // already there / already coming — just show it
    return true
  }
  const need = parseSizeNote(m.sizeNote)
  const tooTight = need !== null && free !== null && free < need * 1.1 // 10% headroom
  const rec = m.variantOf === 'ltx-2.5' || m.id === 'ltx-2.5' ? recommendLtxVariant(list.gpu?.vramMB) : null
  const recModel: LocalModelDef | undefined = rec ? LOCAL_MODELS.find((x) => x.id === rec.id) : undefined
  const ok = await confirmDialog(
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt-hi)', marginBottom: 8 }}>
        {m.label} <span style={{ color: 'var(--dim)', fontSize: 11 }}>— {m.blurb}</span>
      </div>
      <div style={line}>
        <span style={key}>download</span>
        <span>{m.sizeNote || 'size read from the manifest'} · once, into the app's models folder</span>
      </div>
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
  void window.vidancer.modelsDownload(m.id)
  return true
}
