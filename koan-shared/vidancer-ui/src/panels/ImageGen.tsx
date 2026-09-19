import { useEffect, useMemo, useRef, useState } from 'react'
import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
import { FloatPick } from '../ui/FloatPick'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { Thumbnail } from '../Thumbnail'
import { MIME_GENTAKE } from '../lib/dragDrop'
import { acceptsImageGenReference, dropImageGenReference } from '../lib/imageGenReferenceDrop'
import { ctl } from '../ui/controls'
import { Ic, Copy, Trash2, Star, Pencil } from '../ui/icons'
import { Dropdown, ContextMenu, Section, aspectLabel, dropPath, type DropdownOption, type MenuEntry } from '@koan/shared'
import { ResizeHandle } from '../ui/ResizeHandle'
import { toast } from '../ui/Toast'
import { openImageEditor, openModelsCard } from '../panelBus'
import { KREA2_VARIANT_IDS, localModelFor } from '../shared/localModels'
import { TAKE_COLORS } from './shared/takeRows'
import { tetherAttr } from '../lib/tether'
import { ImageGenSidebar, useFolderLoras } from './ImageGenSidebar'
import { buildSettingsMenu } from '../lib/settingsMenu'
import { openInEntry } from '../lib/externalEditor'
import { useTakeMultiSelect } from '../lib/takeSelection'
import { confirmDialog } from '../prompt'

// ---- Image Gen (docs/KREA2-LOCAL-SPEC-2026-09-08.md §4, re-cut 2026-09-09 to CLIP GEN'S GRAMMAR
// after his side-by-side): image big on top, then Clip Gen's bordered section cards — PROMPT
// (IMG boxes A/B in the "＋ drag" square, boost under each, the PNG reader, the prompt),
// MODEL (the dials in .field rows, the lora stack as picker chips), TAKES (Clip Gen's take
// card, one for one) — and Clip Gen's sticky footer: ▶ Generate hero + ＋ Queue + status line.
// The right column is the LoRA sidebar, where Image Edit keeps its results tree. ----

const ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']
const SIZES = [
  { value: '1', label: '1 MP' },
  { value: '1.5', label: '1.5 MP' },
  { value: '2', label: '2 MP' }
]
const UNLEASHED_FILE = 'krea2filterbypass3.safetensors'
const SQ = 64 // the ref chip square — Clip Gen's SQ

// the house field frame around a bare number (Clip Gen's seed grammar: one row height)
function NumBox({ value, onChange, width = 64, title, step = 0.1, min = 0, max = 5 }: { value: number; onChange: (v: number) => void; width?: number; title?: string; step?: number; min?: number; max?: number }): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Number(draft)
    if (Number.isNaN(n)) return setDraft(String(value))
    const v = Math.max(min, Math.min(max, Math.round(n / step) * step))
    onChange(Number(v.toFixed(2)))
  }
  return (
    <div title={title} style={{ background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', width }}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0, margin: 0, width: '100%', fontSize: 12, lineHeight: '15px', height: 15, color: 'var(--txt-hi)', fontFamily: 'inherit' }}
      />
    </div>
  )
}

// ＋ Queue (Clip Gen's second button): image gens run one after another through the same
// engine wait — a small in-panel line, drained in order; "now" jumps the line
type QueueItem = { imageGenId: string; runNow?: boolean }
const line: QueueItem[] = []
let draining = false
const queueSubs = new Set<() => void>()
const notify = (): void => queueSubs.forEach((s) => s())

export function ImageGenPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const editorId = useStore((s) => s.editorImageGenId)
  const setEditor = useStore((s) => s.setEditorImageGen)
  const createJob = useStore((s) => s.createImageGen)
  const saveJob = useStore((s) => s.saveImageGen)
  const setKeeper = useStore((s) => s.setImageGenKeeper)
  const setTakeMeta = useStore((s) => s.setImageGenTakeMeta)
  const deleteTake = useStore((s) => s.deleteImageGenTake)
  const deleteJob = useStore((s) => s.deleteImageGen)
  const duplicateJob = useStore((s) => s.duplicateImageGen)
  const toLibrary = useStore((s) => s.imageGenToLibrary)
  const setEditorImage = useStore((s) => s.setEditorImage)
  const applyDelta = useStore((s) => s.applyDelta)
  const readFileSeed = useStore((s) => s.imageGenReadFile)
  const setReadFileSeed = useStore((s) => s.setImageGenReadFile)
  const undoTick = useStore((s) => s.undoTick) // outside writes (tether commit, Co-Director, undo) reload the prompt box

  const job = editorId ? (project?.imageGens ?? []).find((g) => g.id === editorId) : undefined
  const r = job?.recipe
  const takeSelection = useTakeMultiSelect(job?.id, job?.takes.map((t) => t.id) ?? [])
  const [status, setStatus] = useState<ImageGenStatus | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null) // the job rendering right now
  const [progress, setProgress] = useState('')
  const [pct, setPct] = useState<number | undefined>()
  const [errLine, setErrLine] = useState('')
  const [queued, setQueued] = useState(0)
  const [onScreen, setOnScreen] = useState<string | null>(null) // take id on the big view
  const [promptH, setPromptH] = useState(0)
  const [promptDraft, setPromptDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [refDrag, setRefDrag] = useState<'a' | 'b' | null>(null)
  const [pngDrag, setPngDrag] = useState(false)
  const [pngRead, setPngRead] = useState<{ x: number; y: number; s: PngSettings } | null>(null)
  const [pngBusy, setPngBusy] = useState(false)
  const [takeMenu, setTakeMenu] = useState<{ x: number; y: number; takeId: string; takeIds: string[] } | null>(null)
  const [searchSeed, setSearchSeed] = useState<string | undefined>()
  const [sideW, setSideW] = useState(260)
  const [sideOpen, setSideOpen] = useState(true)
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set())
  const folderRows = useFolderLoras()
  const previewH = useStore((s) => s.previewH.imageGen)
  const setPreviewH = useStore((s) => s.setPreviewH)
  const imgBoxRef = useRef<HTMLDivElement>(null)
  const promptTimer = useRef<number>(0)
  const lastSavedPrompt = useRef<string | null>(null) // the prompt text this panel wrote last — an incoming value that differs came from outside
  const pngBoxRef = useRef<HTMLDivElement>(null)
  const toggleSec = (id: string): void =>
    setClosedSecs((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode, right?: React.ReactNode): React.JSX.Element => (
    <Section title={title} right={right} collapsible open={!closedSecs.has(id)} onToggle={() => toggleSec(id)}>
      {body}
    </Section>
  )

  const refreshStatus = (): void => {
    void vd().imageGenStatus().then(setStatus)
  }
  useEffect(() => {
    refreshStatus()
    const off = vd().onModelsDone(() => refreshStatus())
    const offP = vd().onImageGenProgress((p) => {
      if (p.id !== editorId) return
      setProgress(p.msg)
      setPct(p.pct)
    })
    const sub = (): void => setQueued(line.length)
    queueSubs.add(sub)
    return () => {
      off()
      offP()
      queueSubs.delete(sub)
    }
  }, [editorId])
  useEffect(() => {
    setPromptDraft(r?.prompt ?? '')
    lastSavedPrompt.current = r?.prompt ?? ''
    setTitleDraft(job?.name ?? '')
    setErrLine('')
    setProgress('')
    setOnScreen(job?.keeperTakeId ?? job?.takes[job.takes.length - 1]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorId])
  // the prompt box holds a draft (400 ms autosave) — a write from OUTSIDE (a tether commit, the
  // Co-Director's set_image_gen_prompt, undo) must land in it too, or the box shows the old text and
  // the next keystroke saves the old text back over the new one (his report 2026-09-09: "the commit
  // buttons aren't working"). Own saves round-trip as the same string and are ignored here.
  useEffect(() => {
    if (!job) return
    const v = r?.prompt ?? ''
    if (v === lastSavedPrompt.current) return
    lastSavedPrompt.current = v
    window.clearTimeout(promptTimer.current)
    setPromptDraft(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.prompt, undoTick])
  // seeds from the Watched panel's civit menu (CIVIT-LIKES-SPEC): a lora to put in a slot, a name to search
  const useSeed = useStore((s) => s.imageGenUseSeed)
  const searchSeedOutside = useStore((s) => s.imageGenSearchSeed)
  useEffect(() => {
    if (!useSeed) return
    useStore.getState().setImageGenUseSeed(null)
    if (job) useLora(useSeed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSeed])
  useEffect(() => {
    if (!searchSeedOutside) return
    useStore.getState().setImageGenSearchSeed(null)
    setSearchSeed(searchSeedOutside)
  }, [searchSeedOutside])
  // a Library right-click "read its settings" lands here with the file
  useEffect(() => {
    if (!readFileSeed || !job) return
    const f = readFileSeed
    setReadFileSeed(null)
    void readPng(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readFileSeed, job?.id])

  const patch = (p: Partial<ImageGenRecipe>): void => {
    if (!job) return
    void saveJob(job.id, { recipe: p })
  }
  const onPrompt = (v: string): void => {
    setPromptDraft(v)
    window.clearTimeout(promptTimer.current)
    promptTimer.current = window.setTimeout(() => {
      lastSavedPrompt.current = v
      patch({ prompt: v })
    }, 400)
  }
  const commitTitle = (): void => {
    if (job && titleDraft.trim() && titleDraft.trim() !== job.name) void saveJob(job.id, { name: titleDraft.trim() })
  }

  // MODEL options: official builds (best first) + civit checkpoints by their Civitai name
  const modelLabel = (id: string): string => {
    const c = status?.civit.find((x) => x.id === id)
    if (c) return `${c.name}${c.versionName ? ` · ${c.versionName}` : ''}`
    const m = localModelFor(id)
    return m ? `Krea 2 (${m.label.replace(/[()]/g, '')})` : id
  }
  const modelOptions = useMemo((): DropdownOption[] => {
    const out: DropdownOption[] = []
    for (const id of KREA2_VARIANT_IDS) {
      const ok = !!status?.official.includes(id)
      out.push({ value: id, label: modelLabel(id), disabled: !ok, title: ok ? 'official Krea 2 build' : 'not downloaded — the Models card has it' })
    }
    if (status?.civit.length) {
      out.push({ value: '—', label: '', sep: true })
      for (const c of status.civit) out.push({ value: c.id, label: modelLabel(c.id), title: `civit checkpoint${c.baseModel ? ` · ${c.baseModel}` : ''}` })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  // first time = the last one he used, else best installed (highest-quality law)
  useEffect(() => {
    if (!job || !status) return
    const installed = [...KREA2_VARIANT_IDS.filter((id) => status.official.includes(id)), ...status.civit.map((c) => c.id)]
    if (!installed.length) return
    if (!r?.model || !installed.includes(r.model)) {
      void vd()
        .getSettings()
        .then((s) => {
          const last = s?.imageGenLastModel
          patch({ model: last && installed.includes(last) ? last : installed[0] })
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, status])

  const libImages = project?.images ?? []
  const imgOf = (id?: string): ProjImage | undefined => (id ? libImages.find((i) => i.id === id) : undefined)
  const refA = imgOf(r?.refA)
  const refB = imgOf(r?.refB)
  const unleashedRow = folderRows.find((x) => x.file.toLowerCase() === UNLEASHED_FILE)
  const activeWords = (r?.loraOn ? r.loras : []).flatMap((l) => folderRows.find((x) => x.rel === l.name)?.triggerWords ?? [])

  const useLora = (rel: string): void => {
    if (!r) return
    if (r.loras.some((l) => l.name === rel)) return
    const next = r.loras.length < 2 ? [...r.loras, { name: rel, weight: 1 }] : [r.loras[0], { name: rel, weight: 1 }]
    patch({ loras: next })
    if (r.loras.length >= 2) toast('slot 2 replaced — two loras is the stack', { kind: 'ok' })
  }
  const unuseLora = (rel: string): void => r && patch({ loras: r.loras.filter((l) => l.name !== rel) })

  const canRender = !!r && !!r.prompt.trim() && !!r.model && !!status?.engine && !!status?.essentials && !!status?.pack
  const renderWhy = !r
    ? ''
    : !status?.engine
      ? 'the local engine is not installed — download Krea 2 in the Models card'
      : !status?.pack
        ? 'the Krea 2 refs nodes are missing — press update engine in the Models card'
        : !status?.essentials
          ? 'Krea 2 essentials are missing — the Models card fetches them'
          : !r.model
            ? 'no model — download Krea 2 in the Models card'
            : !r.prompt.trim()
              ? 'write a prompt first'
              : ''

  // the line runner: one render at a time, in order; the ✓/✕ line reports the OPEN job
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      while (line.length) {
        const it = line.shift()!
        notify()
        setBusyId(it.imageGenId)
        setErrLine('')
        setProgress('starting…')
        setPct(undefined)
        const res = await vd().imageGenRender({ imageGenId: it.imageGenId })
        setPct(undefined)
        if (res.ok && res.delta) {
          applyDelta(res.delta)
          if (res.takeIds?.[0]) setOnScreen(res.takeIds[0])
          setProgress(`done ✓ — ${res.takeIds?.length ?? 0} take${(res.takeIds?.length ?? 0) > 1 ? 's' : ''} added`)
          const g = useStore.getState().project?.imageGens?.find((x) => x.id === it.imageGenId)
          if (g) void vd().setSettings({ imageGenLastModel: g.recipe.model })
        } else {
          setProgress('')
          setErrLine(res.error ?? 'unknown error')
        }
      }
    } finally {
      draining = false
      setBusyId(null)
      notify()
    }
  }
  const submit = async (lane: 'now' | 'queue'): Promise<void> => {
    if (!job || !canRender) return
    window.clearTimeout(promptTimer.current)
    if (promptDraft !== r?.prompt) await saveJob(job.id, { recipe: { prompt: promptDraft } })
    if (lane === 'now') line.unshift({ imageGenId: job.id, runNow: true })
    else line.push({ imageGenId: job.id })
    notify()
    void drain()
  }
  const busy = busyId === job?.id

  // ---- the PNG reader (§8): drop or pick → read → a context menu at the box ----
  const readPng = async (file: string): Promise<void> => {
    setPngBusy(true)
    const res = await vd().imageGenReadPng(file)
    setPngBusy(false)
    if (!res.ok || !res.settings) return setErrLine(res.error ?? 'could not read that PNG')
    const box = pngBoxRef.current?.getBoundingClientRect()
    setPngRead({ x: box ? box.left : 200, y: box ? box.bottom + 4 : 200, s: res.settings })
  }
  // the menu is shared with the Watched panel's civit tiles (lib/settingsMenu.tsx, law 11)
  const pngMenu = (): MenuEntry[] =>
    pngRead
      ? buildSettingsMenu(pngRead.s, folderRows, {
          sendToPrompt: (p) => {
            onPrompt(p)
            patch({ prompt: p })
            setProgress('prompt filled from the PNG — loras are listed, add them by hand')
          },
          useLora,
          searchCivit: setSearchSeed
        })
      : []

  // ---- empty panel: jobs float to be chosen from; none yet = ＋ new ----
  if (!project || !job || !r) {
    const jobs = project?.imageGens ?? []
    return (
      <EmptyState>
        {jobs.length > 0 ? (
          <>
            no image gen open — double-click one
            <FloatPick items={jobs.map((g) => ({ id: g.id, label: g.name, file: g.takes.find((t) => t.id === g.keeperTakeId)?.file ?? g.takes[g.takes.length - 1]?.file, glyph: '▦' }))} onOpen={(id) => setEditor(id)} hint="double-click to open" />
          </>
        ) : (
          <>Krea 2 on your own GPU — refs, loras, batches</>
        )}
        <div style={{ marginTop: 10 }}>
          <span className="btn koan-hbtn" style={{ fontFamily: 'var(--mono)', fontSize: 11 }} onClick={() => void createJob().then((id) => id && setEditor(id))} title="start a new image gen">
            ＋ new
          </span>
        </div>
      </EmptyState>
    )
  }

  const shown = job.takes.find((t) => t.id === onScreen) ?? job.takes.find((t) => t.id === job.keeperTakeId) ?? job.takes[job.takes.length - 1]
  const takeIdx = shown ? job.takes.indexOf(shown) + 1 : 0

  // Clip Gen's IMG slot: empty = the square dashed "＋ drag" box; filled = the square chip with ✕
  const refBox = (which: 'a' | 'b', im: ProjImage | undefined): React.JSX.Element => {
    const key = which === 'a' ? 'refA' : 'refB'
    const clear = (): void => patch({ [key]: undefined } as Partial<ImageGenRecipe>)
    const dropProps = {
      onDragOver: (e: React.DragEvent) => {
        if (acceptsImageGenReference(Array.from(e.dataTransfer.types))) {
          e.preventDefault()
          setRefDrag(which)
        }
      },
      onDragLeave: () => setRefDrag(null),
      onDrop: (e: React.DragEvent) => {
        setRefDrag(null)
        if (!acceptsImageGenReference(Array.from(e.dataTransfer.types))) return
        e.preventDefault()
        e.stopPropagation()
        void dropImageGenReference(job.id,key,e.dataTransfer).then(ok=>{if(!ok)toast('The image could not be added as a reference.',{kind:'error'})}).catch(e=>toast(e instanceof Error?e.message:String(e),{kind:'error'}))
      }
    }
    if (!im)
      return (
        <span
          {...dropProps}
          title={which === 'a' ? 'ref A — scene: drag a Library image or an Image Gen take here' : 'ref B — subject: drag a Library image or an Image Gen take here'}
          style={{ width: SQ + 8, height: SQ + 8, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, border: `1px dashed ${refDrag === which ? 'var(--amber)' : 'var(--line2)'}`, borderRadius: 5, background: 'var(--field)', color: 'var(--dim)', cursor: 'default' }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
          <span style={{ fontSize: 8 }}>drag</span>
          <span style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '.06em' }}>{which === 'a' ? 'scene' : 'subject'}</span>
        </span>
      )
    return (
      <span
        {...dropProps}
        title={`${im.title} — ref ${which.toUpperCase()}\ndouble-click = open in the Image Editor`}
        onDoubleClick={() => {
          setEditorImage(im.id)
          openImageEditor()
        }}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 4, borderRadius: 5, border: `1px solid ${refDrag === which ? 'var(--amber)' : 'var(--line2)'}`, background: 'var(--raised2)', userSelect: 'none' }}
      >
        <span style={{ position: 'relative' }}>
          <img src={mediaUrl(im.file)} alt="" style={{ width: SQ, height: SQ, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
          <span
            title={`clear ref ${which.toUpperCase()}`}
            style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, fontSize: 8, color: 'var(--dim)', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              clear()
            }}
          >
            ✕
          </span>
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--gold)', maxWidth: SQ + 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.title}</span>
      </span>
    )
  }
  // one ref group (his design 2026-09-09): the slot with its name INSIDE, the boost beside it —
  // "boost" label above the field, the field level with the box's top edge
  const refGroup = (which: 'a' | 'b', im: ProjImage | undefined, boost: number, onBoost: (v: number) => void): React.JSX.Element => (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, opacity: r.refOn ? 1 : 0.4 }}>
      {refBox(which, im)}
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
        <span className="lb" style={{ margin: 0 }}>boost</span>
        <NumBox value={boost} onChange={onBoost} width={36} title={which === 'a' ? 'ref_boost — how hard ref A holds (his graph: 2.1; 1 = the pack default)' : 'ref_boost_a — how hard ref B holds (his graph: 1.0)'} />
      </span>
    </span>
  )

  // the lora chip — the shelf picker's chip, one for one (name · slider · weight · ✕)
  const loraChip = (label: string, weight: number, onWeight: (w: number) => void, onRemove: (() => void) | undefined, title: string, off?: boolean): React.JSX.Element => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-hi)', opacity: off ? 0.45 : 1 }}>
      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <input type="range" min={0} max={2} step={0.05} value={weight} disabled={off} onChange={(e) => onWeight(Number(e.target.value))} style={{ width: 60, accentColor: 'var(--amber)' }} />
      <span style={{ color: 'var(--muted)', minWidth: 26, textAlign: 'right' }}>{weight.toFixed(2)}</span>
      {onRemove && (
        <span onClick={onRemove} title="remove" style={{ color: 'var(--dim)', cursor: 'pointer' }}>
          ✕
        </span>
      )}
    </span>
  )

  const takeEngineLine = (t: ImageGenTake): string => `${modelLabel(t.snapshot.model)} · ${new Date(t.createdAt).toLocaleDateString()}`

  return (
    <div className="vd-panel" style={{ display: 'flex', height: '100%', background: 'var(--bg0)' }}>
      {/* ---- left: image big · the section cards · the sticky footer ---- */}
      <div className="vd-inspector" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={imgBoxRef} style={{ flex: '0 0 auto', height: previewH, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', position: 'relative' }}>
          {shown ? <img src={mediaUrl(shown.file)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ color: 'var(--dim)', fontSize: 12 }}>write a prompt and generate</span>}
          <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4 }}>
            {job.name}
            {shown ? ` · T${takeIdx} · seed ${shown.seed}${shown.keptImageId ? ' · ★ in Library' : ''}` : ''}
          </div>
          {shown && (
            <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(0,0,0,.55)', padding: '3px 6px', borderRadius: 5, zIndex: 5 }}>
              <span className="btn vd-hbtn" title="save to Library — this take becomes a new @image (dragging the take card onto the Library works too)" onClick={() => void toLibrary(job.id, shown.id).then((id) => id && toast('★ saved to Library', { kind: 'ok' }))}>
                <Ic i={Star} size={11} /> → library
              </span>
              <span
                className="btn vd-hbtn"
                title="open in the Image Editor — saves to the Library first, then opens the Nano tree on it"
                onClick={() =>
                  void toLibrary(job.id, shown.id).then((id) => {
                    if (!id) return
                    setEditorImage(id)
                    openImageEditor()
                  })
                }
              >
                <Ic i={Pencil} size={11} /> image edit
              </span>
            </div>
          )}
        </div>

        {/* the image height — Clip Gen's resize handle, persisted (one resize app-wide, his order 2026-09-09) */}
        <ResizeHandle value={previewH} maxOf={() => (imgBoxRef.current?.parentElement?.clientHeight ?? 800) - 160} onChange={(h) => setPreviewH('imageGen', h)} title="drag to resize the image" />
        <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 10 }}>
          {/* ---- PROMPT card: refs (A · B in the img-group grammar) · the PNG reader · the prompt ---- */}
          {sec('prompt', <span {...tetherAttr('imagegen', job.id, 'prompt')}>prompt</span>, <>
          <div className="field" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, rowGap: 10, padding: '2px 0 6px' }}>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', alignSelf: 'flex-start', height: 18 }} title="refs on = the identity-edit path runs (ref A grounds the prompt, B rides as the subject) · off = plain text-to-image, refs kept">
              <input type="checkbox" checked={r.refOn} onChange={(e) => patch({ refOn: e.target.checked })} />
              <span className="lb" style={{ margin: 0 }}>refs</span>
            </label>
            {refGroup('a', refA, r.refBoost, (v) => patch({ refBoost: v }))}
            {refGroup('b', refB, r.refBoostB, (v) => patch({ refBoostB: v }))}
            {/* the PNG reader — his words: "drop png here to read", far right of the refs row */}
            <span
              ref={pngBoxRef}
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes('Files')) {
                  e.preventDefault()
                  setPngDrag(true)
                }
              }}
              onDragLeave={() => setPngDrag(false)}
              onDrop={(e) => {
                setPngDrag(false)
                const f = Array.from(e.dataTransfer.files || [])[0]
                if (!f) return
                e.preventDefault()
                const p = dropPath(f)
                if (!p || !/\.png$/i.test(p)) return setErrLine('drop a PNG — that is where Comfy keeps its settings')
                void readPng(p)
              }}
              onClick={() => void vd().imageGenPickPng().then((p) => { if (p) void readPng(p) })}
              title="drop a PNG made in another Comfy (or click to pick one) — reads its prompt and loras"
              style={{ marginLeft: 'auto', width: 148, height: SQ + 8, borderRadius: 5, border: `1px dashed ${pngDrag ? 'var(--amber)' : 'var(--line2)'}`, background: 'var(--field)', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', color: pngDrag ? 'var(--amber)' : 'var(--dim)' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>⎘</span>
              <span style={{ fontSize: 8, textAlign: 'center' }}>{pngBusy ? 'reading…' : 'drop png here to read'}</span>
            </span>
          </div>
          {activeWords.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
              {[...new Set(activeWords)].map((w) => {
                const present = promptDraft.toLowerCase().includes(w.toLowerCase())
                return (
                  <span
                    key={w}
                    onClick={() => !present && onPrompt(promptDraft.trim() ? `${promptDraft.trim()}, ${w}` : w)}
                    title={present ? 'already in the prompt' : 'tap to add — appended at render anyway; the lora barely fires without its word'}
                    style={{ fontFamily: 'var(--mono)', fontSize: 9, border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px', cursor: present ? 'default' : 'pointer', color: present ? 'var(--ok)' : 'var(--amber)' }}
                  >
                    {present ? '✓ ' : '＋ '}
                    {w}
                  </span>
                )
              })}
            </div>
          )}
          <div className="field" style={{ position: 'relative' }}>
            <div className="lb">prompt</div>
            <ResizeHandle value={promptH || 54} min={54} invert maxOf={() => Math.min(320, window.innerHeight * 0.4)} onChange={setPromptH} title="drag up to grow the prompt box" />
            <textarea {...tetherAttr('imagegen', job.id, 'prompt')} value={promptDraft} onChange={(e) => onPrompt(e.target.value)} placeholder="describe the image…" rows={3} style={{ ...ctl, width: '100%', resize: 'none', fontFamily: 'var(--mono)', ...(promptH ? { height: promptH } : {}) }} />
          </div>
          </>)}

          {/* ---- MODEL card: the dials in Clip Gen's .field rows, then the lora stack as picker chips ---- */}
          {sec('model', 'model', <>
          <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">model</div>
              <Dropdown
                value={r.model || '—'}
                options={modelOptions.length ? modelOptions : [{ value: '—', label: 'download Krea 2 in the Models card', disabled: true }]}
                onChange={(v) => patch({ model: v })}
                style={{ minWidth: 150 }}
                title="official builds first, your civit checkpoints under them"
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">aspect</div>
              <Dropdown value={r.aspect} options={ASPECTS.map((a) => ({ value: a, label: aspectLabel(a) }))} onChange={(v) => patch({ aspect: v })} style={{ width: 104 }} title="output aspect ratio" />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">size</div>
              <Dropdown value={String(r.megapixels)} options={SIZES} onChange={(v) => patch({ megapixels: Number(v) })} style={{ width: 78 }} title="megapixels — turbo tops out at 2 MP" />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">renders</div>
              <Dropdown value={String(r.batch)} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => patch({ batch: Number(v) })} style={{ width: 62 }} title="how many images each generate makes — every one is its own take" />
            </div>
            <div title="0 = random every render · any number = the same noise every render">
              <div className="lb">seed</div>
              <NumBox value={r.seed} onChange={(v) => patch({ seed: Math.floor(v) })} width={92} step={1} min={0} max={4294967295} />
            </div>
          </div>
          {/* the lora stack (his order: right of seed = the same card): LORA switch · slot 1 · slot 2 · unleashed */}
          <div className="field" style={{ marginBottom: 2 }}>
            <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', marginBottom: 6 }} title="loras on = the two slots (and unleashed) chain into the model · off = none, picks kept">
              <input type="checkbox" checked={r.loraOn} onChange={(e) => patch({ loraOn: e.target.checked })} />
              <span className="lb" style={{ margin: 0 }}>loras</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, opacity: r.loraOn ? 1 : 0.45 }}>
              {r.loras.map((l, i) => {
                const row = folderRows.find((x) => x.rel === l.name)
                return (
                  <span key={l.name}>
                    {loraChip(row?.name ?? l.name.split('/').pop()?.replace(/\.safetensors$/i, '') ?? l.name, l.weight, (w) => patch({ loras: r.loras.map((x, j) => (j === i ? { ...x, weight: w } : x)) }), () => unuseLora(l.name), row ? `${i + 1} · ${l.name}` : `${l.name} — not in your folders any more`)}
                  </span>
                )
              })}
              {r.loras.length < 2 && (
                <span className="btn koan-hbtn" style={{ fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }} onClick={() => setSideOpen(true)} title={`${2 - r.loras.length} slot${r.loras.length === 1 ? '' : 's'} free — pick from the sidebar`}>
                  ＋ lora
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title={unleashedRow ? 'krea2filterbypass3 — his "unleashed" lora, chained after the slots' : 'unleashed = krea2filterbypass3.safetensors — not in your folders'}>
                <input type="checkbox" checked={r.unleashedOn} disabled={!unleashedRow} onChange={(e) => patch({ unleashedOn: e.target.checked })} />
                {loraChip(`unleashed${unleashedRow ? '' : ' · not in folder'}`, r.unleashedWeight, (w) => patch({ unleashedWeight: w }), undefined, unleashedRow ? 'krea2filterbypass3' : 'not in your folders', !unleashedRow || !r.unleashedOn)}
              </span>
            </div>
          </div>
          </>)}

          {/* ---- TAKES card: Clip Gen's take card, one for one ---- */}
          {sec('takes', <span title="click = keeper · Ctrl/⌘-click = add/remove · Shift-click = range · right-click = library / color / disable / delete · drag a card onto the Library to save it">takes{takeSelection.selectedIds.length > 1 ? ` · ${takeSelection.selectedIds.length} selected` : ''}</span>, <>
          {job.takes.length === 0 && <p className="vd-hint">no takes yet — generate to make some</p>}
          <div className="vd-slots" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
            {job.takes.map((t, i) => {
              const isSel = shown?.id === t.id
              const selected = takeSelection.isSelected(t.id)
              const keeper = t.id === job.keeperTakeId
              const dis = !!t.disabled
              return (
                <span
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME_GENTAKE, JSON.stringify({ imageGenId: job.id, takeId: t.id }))
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={(e) => {
                    if (takeSelection.select(e, t.id)) return
                    setOnScreen(t.id)
                    void setKeeper(job.id, t.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    const takeIds = takeSelection.contextIds(t.id)
                    if (!takeSelection.isSelected(t.id)) takeSelection.selectOnly(t.id)
                    setTakeMenu({ x: e.clientX, y: e.clientY, takeId: t.id, takeIds })
                  }}
                  title={
                    `model: ${modelLabel(t.snapshot.model)} · seed ${t.seed}` +
                    (t.modelFile ? `\nfile: ${t.modelFile} (engine-confirmed)` : '') +
                    (t.snapshot.loraOn && t.snapshot.loras.length ? `\nlora: ${t.snapshot.loras.map((l) => `${l.name.split('/').pop()?.replace(/\.safetensors$/i, '')} ×${l.weight}`).join(' · ')}` : '') +
                    (t.snapshot.unleashedOn ? ` · unleashed ×${t.snapshot.unleashedWeight}` : '') +
                    (t.snapshot.refOn && t.snapshot.refA ? `\nrefs: A boost ${t.snapshot.refBoost}${t.snapshot.refB ? ` · B boost ${t.snapshot.refBoostB}` : ''}` : '') +
                    '\n' +
                    (dis ? 'DISABLED · ' : '') +
                    'click = make keeper · Ctrl/⌘-click = add/remove · Shift-click = range · drag onto the Library = new @image · right-click = library / color / disable / delete'
                  }
                  style={{
                    width: 118,
                    borderRadius: 7,
                    border: `2px solid ${t.color ?? (isSel ? 'var(--amber)' : 'var(--line2)')}`,
                    background: 'var(--bg2)',
                    padding: 4,
                    cursor: 'pointer',
                    opacity: dis ? 0.45 : 1,
                    outline: selected ? '2px solid var(--amber)' : undefined,
                    outlineOffset: 2,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                  }}
                >
                  <Thumbnail file={t.file} w={108} h={61} />
                  {dis && (
                    <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.72)', color: 'var(--bad)', fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, letterSpacing: '.06em' }}>
                      OFF
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 11, color: 'var(--txt-hi)' }}>
                    <b>T{i + 1}</b>
                    {keeper && <span style={{ color: 'var(--amber)' }}>★</span>}
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>
                      {t.width}×{t.height}
                    </span>
                  </span>
                  <span style={{ fontSize: 8.5, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{takeEngineLine(t)}</span>
                </span>
              )
            })}
            {job.takes.length > 0 && (
              <span
                className="vd-slot"
                title="edit the ★ take in the Image Editor — saves it to the Library first, then opens the Nano tree on it"
                onClick={() => {
                  const t = job.takes.find((x) => x.id === job.keeperTakeId) ?? job.takes[job.takes.length - 1]
                  void toLibrary(job.id, t.id).then((id) => {
                    if (!id) return
                    setEditorImage(id)
                    openImageEditor()
                  })
                }}
                style={{ width: 118, minHeight: 96, height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>⑂ edit</span>
                <span style={{ fontSize: 8, color: 'var(--dim)', textAlign: 'center', lineHeight: 1.3 }}>image<br />editor</span>
              </span>
            )}
          </div>
          </>)}

          {/* the blocked reason, LOUD (Clip Gen's ✕ line) */}
          {(!canRender || errLine) && (
            <div style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--bad)' }}>
              ✕ {errLine || renderWhy}
            </div>
          )}
        </div>

        {/* sticky footer — Clip Gen's: the hero + ＋ Queue + the live status line */}
        <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--line)', padding: '8px 10px', background: 'var(--bg2)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span
              className="btn"
              title={canRender ? (busy ? 'rendering — ＋ Queue lines another up behind it' : 'render on your GPU now — every image lands as a take · local render') : renderWhy}
              style={{ flex: 1, textAlign: 'center', opacity: canRender && !busy ? 1 : 0.5 }}
              onClick={() => (canRender && !busy ? void submit('now') : !canRender && renderWhy.includes('Models card') ? openModelsCard() : undefined)}
            >
              {`▶ Generate (adds ${r.batch > 1 ? `${r.batch} takes` : 'a take'}) · ${r.model ? modelLabel(r.model) : 'Krea 2'} · local render`}
            </span>
            <span className="btn" title={canRender ? 'line it up — runs after the current render, in order' : renderWhy} style={{ flex: '0 0 auto', textAlign: 'center', opacity: canRender ? 1 : 0.5 }} onClick={() => canRender && void submit('queue')}>
              ＋ Queue{queued ? ` (${queued})` : ''}
            </span>
          </div>
          <p className="vd-hint" style={{ margin: '5px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: errLine ? 'var(--bad)' : 'var(--muted)' }} title={errLine || progress}>
            {busy ? `${progress}${pct != null ? ` · ${Math.round(pct * 100)}%` : ''}` : errLine ? `✕ ${errLine}` : progress || (canRender ? `${r.batch} render${r.batch > 1 ? 's' : ''} · ${r.aspect} · ${r.megapixels} MP · ${r.refOn && refA ? 'refs on' : 'no refs'} · ${r.loraOn ? r.loras.length : 0} lora${r.loraOn && r.loras.length === 1 ? '' : 's'}${r.unleashedOn && unleashedRow ? ' · unleashed' : ''}` : renderWhy)}
          </p>
        </div>
      </div>

      {/* ---- right: identity + the LoRA sidebar (where Image Edit keeps its tree) ---- */}
      {sideOpen ? (
        <div style={{ width: sideW, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              const x0 = e.clientX
              const w0 = sideW
              const move = (ev: MouseEvent): void => setSideW(Math.max(200, Math.min(520, w0 - (ev.clientX - x0))))
              const up = (): void => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
            title="drag to resize"
            style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 3 }}
          />
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="lb" style={{ display: 'flex', alignItems: 'center' }}>
              image gen
              <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setSideOpen(false)} title="fold the sidebar away">
                ›
              </span>
            </div>
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={commitTitle} onKeyDown={(e) => e.key === 'Enter' && commitTitle()} placeholder="name" style={{ ...ctl, width: '100%' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span className="btn vd-hbtn" onClick={() => void createJob().then((id) => id && setEditor(id))} title="new image gen">
                ＋ new
              </span>
              <span className="btn vd-hbtn" onClick={() => void duplicateJob(job.id).then((id) => id && setEditor(id))} title="duplicate — same recipe, no takes">
                <Ic i={Copy} size={12} />
              </span>
              <span
                className="btn vd-hbtn"
                style={{ color: 'var(--bad)' }}
                onClick={() => {
                  if (window.confirm(`delete "${job.name}" and its ${job.takes.length} take${job.takes.length === 1 ? '' : 's'}? Library copies survive.`)) void deleteJob(job.id)
                }}
                title="delete this image gen AND its takes (★ Library copies survive)"
              >
                <Ic i={Trash2} size={12} />
              </span>
            </div>
          </div>
          <ImageGenSidebar picks={r.loras} onUse={useLora} onUnuse={unuseLora} searchSeed={searchSeed} onSearchSeedUsed={() => setSearchSeed(undefined)} />
        </div>
      ) : (
        <div onClick={() => setSideOpen(true)} title="show the lora sidebar" style={{ width: 22, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--dim)', fontSize: 10, fontFamily: 'var(--mono)', writingMode: 'vertical-rl' }}>
          ‹ loras
        </div>
      )}

      {pngRead && <ContextMenu x={pngRead.x} y={pngRead.y} entries={pngMenu()} onClose={() => setPngRead(null)} />}
      {takeMenu &&
        (() => {
          const t = job.takes.find((x) => x.id === takeMenu.takeId)
          if (!t) return null
          const ids = takeMenu.takeIds.filter((id) => job.takes.some((take) => take.id === id))
          const selected = ids.map((id) => job.takes.find((take) => take.id === id)).filter((take): take is ImageGenTake => !!take)
          const batch = ids.length > 1
          const label = batch ? `${ids.length} selected takes` : 'take'
          const updateSelected = (patch: { color?: string | null; disabled?: boolean }): void => {
            void (async () => {
              for (const id of ids) await setTakeMeta(job.id, id, patch)
            })()
          }
          const saveSelected = (): void => {
            void (async () => {
              let saved = 0
              for (const id of ids) if (await toLibrary(job.id, id)) saved++
              toast(`${saved} ${saved === 1 ? 'take' : 'takes'} saved to Library`, { kind: 'ok' })
            })()
          }
          const entries: MenuEntry[] = [
            { label: <>★ keeper</>, onClick: () => void setKeeper(job.id, t.id) },
            { label: <>→ library{batch ? ` · ${ids.length} takes` : t.keptImageId ? ' (already there)' : ''}</>, onClick: saveSelected },
            {
              label: <>⑂ edit in image editor</>,
              onClick: () =>
                void toLibrary(job.id, t.id).then((id) => {
                  if (!id) return
                  setEditorImage(id)
                  openImageEditor()
                })
            },
            {
              label: <>→ prompt (what ran)</>,
              onClick: () => {
                onPrompt(t.promptSent)
                patch({ prompt: t.promptSent })
              }
            },
            { label: <>reveal file</>, onClick: () => void vd().revealFile(t.file) },
            openInEntry(t.file, `${job.name} T${job.takes.indexOf(t) + 1}`),
            { sep: true, label: '' },
            { label: <>{selected.every((take) => take.disabled) ? `enable ${label}` : `disable ${label}`}</>, onClick: () => updateSelected({ disabled: !selected.every((take) => take.disabled) }) },
            ...TAKE_COLORS.map(
              (c) =>
                ({
                  label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{t.color === c ? 'color ✓' : `color ${batch ? ids.length : ''}`}</span>,
                  onClick: () => updateSelected({ color: t.color === c && !batch ? null : c })
                }) as MenuEntry
            ),
            { sep: true, label: '' },
            {
              label: <>delete {batch ? `${ids.length} selected takes` : 'take'}</>,
              danger: true,
              onClick: () => {
                void (async () => {
                  if (batch && !(await confirmDialog(`Delete ${ids.length} selected image takes? Their Library copies stay.`, { confirmLabel: 'Delete', danger: true }))) return
                  for (const id of ids) await deleteTake(job.id, id)
                })()
              }
            }
          ]
          return <ContextMenu x={takeMenu.x} y={takeMenu.y} entries={entries} onClose={() => setTakeMenu(null)} />
        })()}
    </div>
  )
}
