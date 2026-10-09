import { vd } from '../api'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { Thumbnail } from '../Thumbnail'
import { TileZoomSlider, useCtrlWheelZoom, useSectionWheelZoom } from '../lib/tileZoom'
import { MIME_CLIP, MIME_CLIPS, MIME_MOVE, MIME_SCORE, MIME_TAKE, MIME_VEDITNODE, MIME_VOICE, MIME_GENTAKE, MIME_BINCARD, MIME_TIMELINE } from '../lib/dragDrop'
import { clipSeed } from '../lib/clipMeta'
import { activeItems } from '../lib/timelineUtils'
import { modelFor } from '../shared/models'
import { Foldered, type MenuEntry } from './Foldered'
import { ContextMenu, Section } from '@koan/shared'
import { sendEntryFor } from '../lib/sendToProject'
import { exportEntry } from '../lib/exportEntry'
import { multiClick, isPicked, selRing } from '../lib/multiSelect'
import { menuSelection, selectionMenu } from '../lib/selectionMenu'
import { toast } from '../ui/Toast'
import { textPrompt, confirmDialog, alertDialog } from '../prompt'
import { openTimelineEditor, openClipEditor, openVideoEditor, openCharSheetPanel, openScoreCard, openVoicesCard, openProjectStyles, openSheetGen, openImageGen } from '../panelBus'
import { Person, Scene } from '../ui/icons'
import { tetherAttr } from '../lib/tether'
import { Ic, Plus, FolderInput, Pencil, Copy, Trash2, ListVideo, Upload, Wand2, Palette, ScoreIcon } from '../ui/icons'

// ---- Bin: clips as icon tiles — folders + right-click actions; drop a take here to clone ----
export function BinPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  // per-section effective zooms: an unset override follows bin (the master)
  const zClips = useStore((s) => s.tileZoom.clips ?? s.tileZoom.bin)
  const zTl = useStore((s) => s.tileZoom.tl ?? s.tileZoom.bin)
  const zSheet = useStore((s) => s.tileZoom.sheet ?? s.tileZoom.bin)
  const zStyle = useStore((s) => s.tileZoom.style ?? s.tileZoom.bin)
  const zScore = useStore((s) => s.tileZoom.score ?? s.tileZoom.bin)
  const zVoice = useStore((s) => s.tileZoom.voice ?? s.tileZoom.bin)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'bin') // ctrl+scroll OUTSIDE a section = all sections together
  // ctrl+scroll INSIDE a section = just that section (stopPropagation beats the panel listener)
  const tlSecRef = useRef<HTMLDivElement>(null)
  const sheetSecRef = useRef<HTMLDivElement>(null)
  const styleSecRef = useRef<HTMLDivElement>(null)
  const scoreSecRef = useRef<HTMLDivElement>(null)
  const sfxSecRef = useRef<HTMLDivElement>(null)
  const voiceSecRef = useRef<HTMLDivElement>(null)
  const clipsSecRef = useRef<HTMLDivElement>(null)
  const imageGenSecRef = useRef<HTMLDivElement>(null)
  useSectionWheelZoom(tlSecRef, 'tl')
  useSectionWheelZoom(sheetSecRef, 'sheet')
  useSectionWheelZoom(styleSecRef, 'style')
  useSectionWheelZoom(scoreSecRef, 'score')
  useSectionWheelZoom(sfxSecRef, 'score') // sound fx tiles share the scores' size
  useSectionWheelZoom(voiceSecRef, 'voice')
  useSectionWheelZoom(clipsSecRef, 'clips')
  useSectionWheelZoom(imageGenSecRef, 'imagegen')
  const binOrder = useStore((s) => s.binOrder)
  // an order saved before the sound fx card (10-02) gets it after scores
  const order = binOrder.includes('sfx') ? binOrder : binOrder.flatMap((k) => (k === 'scores' ? [k, 'sfx'] : [k]))
  const binCollapsed = useStore((s) => s.binCollapsed)
  const setBinOrder = useStore((s) => s.setBinOrder)
  const toggleBinCard = useStore((s) => s.toggleBinCard)
  const [cardOver, setCardOver] = useState<string | null>(null)
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const multiSel = useStore((s) => s.multiSel) // timeline tiles draw their pick ring here (Foldered draws its own)
  const selectClip = useStore((s) => s.selectClip)
  const cloneTakeToClip = useStore((s) => s.cloneTakeToClip)
  const createClip = useStore((s) => s.createClip)
  const renameClip = useStore((s) => s.renameClip)
  const duplicateClip = useStore((s) => s.duplicateClip)
  const deleteClip = useStore((s) => s.deleteClip)
  const deleteClips = useStore((s) => s.deleteClips)
  const renameTimeline = useStore((s) => s.renameTimeline)
  const duplicateTimeline = useStore((s) => s.duplicateTimeline)
  const deleteTimeline = useStore((s) => s.deleteTimeline)
  const selectTimeline = useStore((s) => s.selectTimeline)
  const addTimeline = useStore((s) => s.addTimeline)
  const [over, setOver] = useState(false)
  const [tlMenu, setTlMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const createCharSheet = useStore((s) => s.createCharSheet)
  const deleteCharSheet = useStore((s) => s.deleteCharSheet)
  const createStyle = useStore((s) => s.createStyle)
  const saveStyle = useStore((s) => s.saveStyle)
  const deleteStyle = useStore((s) => s.deleteStyle)
  const createScoreClip = useStore((s) => s.createScoreClip)
  const saveScoreClip = useStore((s) => s.saveScoreClip)
  const duplicateScoreClip = useStore((s) => s.duplicateScoreClip)
  const deleteScoreClip = useStore((s) => s.deleteScoreClip)
  const createVoiceClip = useStore((s) => s.createVoiceClip)
  const saveVoiceClip = useStore((s) => s.saveVoiceClip)
  const deleteVoiceClip = useStore((s) => s.deleteVoiceClip)
  const createImageGen = useStore((s) => s.createImageGen)
  const saveImageGen = useStore((s) => s.saveImageGen)
  const duplicateImageGen = useStore((s) => s.duplicateImageGen)
  const deleteImageGen = useStore((s) => s.deleteImageGen)
  const zImageGen = useStore((s) => s.tileZoom.imagegen ?? s.tileZoom.bin)
  // char sheets edit in the DOCKED Char Sheet panel (same grammar as Clip Gen)
  const editSheet = (id: string): void => {
    useStore.getState().setEditorSheet(id)
    openCharSheetPanel()
  }
  // sheet tiles ride the same Foldered machinery as clips (kind 'sheet') — folders, drag-to-folder,
  // multi-select, stretch grid. The tile itself sets MIME_MOVE so folder drops + reorder work.
  const renderSheet = (sh: CharSheet): React.ReactNode => {
    const im = sh.imageId ? project?.images.find((i) => i.id === sh.imageId) : undefined
    return (
      <div
        draggable
        onDragStart={(e) => {
          const st = useStore.getState()
          let ids = st.selectionOf('sheet', sh.id)
          if (ids.length === 1) {
            ids = [sh.id]
            st.setMultiSel('sheet', ids)
          }
          e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'sheet', id: sh.id, ids }))
        }}
        onDoubleClick={() => editSheet(sh.id)}
        title="⛉ char sheet · double-click = edit · right-click = actions · link into clips via the characters “from clip” picker"
        style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 5, cursor: 'pointer' }}
      >
        {/* aspect-ratio thumb (not fixed-height) so tile HEIGHT rides the zoom exactly like clip tiles */}
        <div style={{ width: '100%', aspectRatio: '16 / 10', background: 'var(--raised)', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {im ? <img src={mediaUrl(im.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--dim)', fontSize: Math.max(15, Math.round(zSheet * 0.2)) }}>⛉</span>}
        </div>
        <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sh.name}</div>
        <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sh.character.name || '—'}</div>
      </div>
    )
  }
  const sheetMenuEntries = (sh: CharSheet): MenuEntry[] => {
    // sheets have no bulkMenu — the send entry carries the whole selection itself (sendEntryFor)
    return [
      { label: <><Ic i={Pencil} size={12} /> edit</>, onClick: () => editSheet(sh.id) },
      sendEntryFor('sheet', sh.id),
      {
        label: <><Ic i={Trash2} size={12} /> delete</>,
        danger: true,
        onClick: () => {
          void (async () => {
            const uses = (project?.clips ?? []).filter((c) => (c.promptData.characterLinks ?? []).some((l) => l.clipId === sh.id)).length
            if (uses === 0 || (await confirmDialog(`"${sh.name}" is linked into ${uses} clip(s) — delete it and let those links resolve to nothing? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
              void deleteCharSheet(sh.id)
          })()
        }
      }
    ]
  }
  // style sheet tiles: 🎨 universal field bundles — double-click opens the Style Sheet panel
  // (same "double-click opens its editor" grammar as char sheets)
  const editStyle = (id: string): void => {
    useStore.getState().setEditorStyle(id)
    openProjectStyles()
  }
  const renderStyle = (st: ProjectStyle): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        const s = useStore.getState()
        let ids = s.selectionOf('style', st.id)
        if (ids.length === 1) {
          ids = [st.id]
          s.setMultiSel('style', ids)
        }
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'style', id: st.id, ids }))
      }}
      onDoubleClick={() => editStyle(st.id)}
      title="🎨 style sheet · double-click = edit · right-click = actions · link into clips via a field's ⛓ picker"
      style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 5, cursor: 'pointer' }}
    >
      <div style={{ width: '100%', aspectRatio: '16 / 10', background: 'var(--raised)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ic i={Palette} size={Math.max(15, Math.round(zStyle * 0.2))} />
      </div>
      <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</div>
      <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.scene.style || st.scene.visualFeel || '—'}</div>
    </div>
  )
  const styleMenuEntries = (st: ProjectStyle): MenuEntry[] => [
    { label: <><Ic i={Pencil} size={12} /> edit</>, onClick: () => editStyle(st.id) },
    {
      label: <><Ic i={Pencil} size={12} /> rename</>,
      onClick: () => {
        void (async () => {
          const n = await textPrompt('Rename style sheet', st.name)
          if (n && n !== st.name) void saveStyle(st.id, { name: n })
        })()
      }
    },
    sendEntryFor('style', st.id),
    {
      label: <><Ic i={Trash2} size={12} /> delete</>,
      danger: true,
      onClick: () => {
        void (async () => {
          const uses = (project?.clips ?? []).filter((c) => Object.values(c.promptData.fieldLinks ?? {}).some((ids) => ids.includes(st.id))).length
          if (uses === 0 || (await confirmDialog(`"${st.name}" is linked into ${uses} clip(s) — delete it and let those links resolve to nothing? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteStyle(st.id)
        })()
      }
    }
  ]

  // score tiles: ♪ music citizens of the Bin — double-click opens the Score card (same
  // "double-click opens its editor" grammar as sheets/clips)
  const editScore = (id: string): void => {
    useStore.getState().setEditorScore(id)
    openScoreCard()
  }
  // the same tile in the scores card and the sound fx card (list 22: his "needs to be added as a caragoty to
  // the bin", 10-02); `kind` keeps each card's selection and folders its own
  const renderScoreOf = (kind: 'score' | 'sfx') => (sc: ScoreClip): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        const st = useStore.getState()
        let ids = st.selectionOf(kind, sc.id)
        if (ids.length === 1) {
          ids = [sc.id]
          st.setMultiSel(kind, ids)
        }
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind, id: sc.id, ids }))
        e.dataTransfer.setData(MIME_SCORE, sc.id) // → the timeline audio lanes (v19 lane merge)
      }}
      onDoubleClick={() => editScore(sc.id)}
      title={sc.kind === 'sfx' ? 'sound fx · double-click = SFX card · right-click = actions' : '♪ score clip · double-click = Score card · right-click = actions'}
      style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 5, cursor: 'pointer' }}
    >
      <div style={{ width: '100%', aspectRatio: '16 / 10', background: 'var(--raised)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--dim)', display: 'inline-flex' }}><Ic i={ScoreIcon} size={Math.max(15, Math.round(zScore * 0.2))} /></span>
      </div>
      <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sc.name}</div>
      <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sc.kind === 'sfx' ? 'sound fx' : sc.beats.length ? `${sc.beats.length} beat${sc.beats.length === 1 ? '' : 's'}` : 'no beats'} · {sc.takes.length ? `${sc.takes.length} take${sc.takes.length === 1 ? '' : 's'}` : 'no takes'}
      </div>
    </div>
  )
  const renderScore = renderScoreOf('score')
  const renderSfx = renderScoreOf('sfx')
  const scoreMenuEntries = (sc: ScoreClip): MenuEntry[] => [
    { label: <><Ic i={Pencil} size={12} /> edit</>, onClick: () => editScore(sc.id) },
    {
      label: <><Ic i={Pencil} size={12} /> rename</>,
      onClick: async () => {
        const n = await textPrompt('Rename score', sc.name)
        if (n && n.trim()) void saveScoreClip(sc.id, { name: n.trim() })
      }
    },
    { label: <><Ic i={Copy} size={12} /> duplicate</>, onClick: () => void duplicateScoreClip(sc.id) },
    sendEntryFor('score', sc.id),
    {
      label: <><Ic i={Trash2} size={12} /> delete</>,
      danger: true,
      onClick: () => {
        void (async () => {
          const uses = (project?.timelines ?? []).reduce((n, t) => n + (t.scoreItems ?? []).filter((s) => s.scoreClipId === sc.id).length, 0)
          if (uses === 0 || (await confirmDialog(`"${sc.name}" is stretched on the timeline (${uses}×). Delete it and remove those spans? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteScoreClip(sc.id)
        })()
      }
    }
  ]
  // voice tiles: 🎤 character voices — double-click opens the Voices card (same grammar).
  // The ★ keeper take IS the voice: sheets bind it, prompts carry it.
  const editVoice = (id: string): void => {
    useStore.getState().setEditorVoice(id)
    openVoicesCard()
  }
  const renderVoice = (vc: VoiceClip): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        const st = useStore.getState()
        let ids = st.selectionOf('voice', vc.id)
        if (ids.length === 1) {
          ids = [vc.id]
          st.setMultiSel('voice', ids)
        }
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'voice', id: vc.id, ids }))
        e.dataTransfer.setData(MIME_VOICE, vc.id) // → a char sheet's voice slot
      }}
      onDoubleClick={() => editVoice(vc.id)}
      title="🎤 voice · double-click = Voices card · drag onto a char sheet · right-click = actions"
      style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 5, cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: 'var(--raised)', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {(() => {
          const im = vc.recipe.imageId ? project?.images.find((i) => i.id === vc.recipe.imageId) : undefined
          return im ? <img src={mediaUrl(im.file)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} /> : null
        })()}
        <span style={{ position: 'relative', color: 'var(--dim)', fontSize: Math.max(15, Math.round(zVoice * 0.2)), textShadow: '0 1px 2px #000' }}>🎤</span>
      </div>
      <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vc.name}</div>
      <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {vc.takes.length ? `${vc.takes.length} take${vc.takes.length === 1 ? '' : 's'}` : 'no takes'}
        {vc.keeperTakeId && vc.takes.some((t) => t.id === vc.keeperTakeId) ? ' · ★' : ''}
        {(project?.charSheets ?? []).some((sh) => sh.voiceId === vc.id) ? ' · ⛉ bound' : ''}
      </div>
    </div>
  )
  const voiceMenuEntries = (vc: VoiceClip): MenuEntry[] => [
    { label: <><Ic i={Pencil} size={12} /> edit</>, onClick: () => editVoice(vc.id) },
    {
      label: <><Ic i={Pencil} size={12} /> rename</>,
      onClick: async () => {
        const n = await textPrompt('Rename voice', vc.name)
        if (n && n.trim()) void saveVoiceClip(vc.id, { name: n.trim() })
      }
    },
    sendEntryFor('voice', vc.id),
    {
      label: <><Ic i={Trash2} size={12} /> delete</>,
      danger: true,
      onClick: () => {
        void (async () => {
          const uses = (project?.charSheets ?? []).filter((sh) => sh.voiceId === vc.id).length
          if (uses === 0 || (await confirmDialog(`"${vc.name}" is bound to ${uses} char sheet(s). Delete it and clear those bindings? Files stay on disk. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteVoiceClip(vc.id)
        })()
      }
    }
  ]
  // cross-project import picker (every project folder is a browsable clip library)
  const [importing, setImporting] = useState<PeekProject | null>(null)
  const [importSel, setImportSel] = useState<Set<string>>(new Set())
  const [importBusy, setImportBusy] = useState(false)
  const clips = project?.clips ?? []
  const firstImage = (c: Clip): string | undefined => {
    const id = c.promptData.imageIds?.[0]
    return id ? project?.images.find((i) => i.id === id)?.file : undefined
  }

  const clipMenu = (c: Clip): MenuEntry[] => {
    const uses = (project?.timelines ?? []).reduce((n, t) => n + t.items.filter((it) => it.clipId === c.id).length, 0)
    return [
      {
        label: <><Ic i={Pencil} size={12} /> rename</>,
        onClick: async () => {
          const n = await textPrompt('Rename clip', c.name)
          if (n && n.trim()) void renameClip(c.id, n.trim())
        }
      },
      { label: <><Ic i={Copy} size={12} /> duplicate</>, onClick: () => void duplicateClip(c.id) },
      // a sheet clip is an ordinary clip underneath — the full card is one right-click away
      ...(c.sheet
        ? [
            {
              label: <><Ic i={Pencil} size={12} /> open in Clip Gen</>,
              onClick: () => {
                selectClip(c.id)
                openClipEditor()
              }
            }
          ]
        : []),
      ...(c.takes.length
        ? [
            {
              // open the ★ take in the Video Editor tree — keep a result by dragging it out
              label: <><Ic i={Wand2} size={12} /> ⑂ edit keeper take v2v</>,
              onClick: (): void => {
                const take = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
                useStore.getState().setEditorVideo({ takeRef: { clipId: c.id, takeId: take.id } })
                openVideoEditor()
              }
            } as MenuEntry,
            // the ★ take (or the last one) through the shared save box — TODO-2026-09-22 §21
            exportEntry((c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]).file, 'video', c.name, 'export keeper as…')
          ]
        : []),
      {
        // rescue path: a render the app wasn't alive to catch → grab the mp4 from the fal
        // dashboard and attach it here as a real take
        label: <><Ic i={Upload} size={12} /> add take from file…</>,
        onClick: async (): Promise<void> => {
          const r = await vd().clipAddTakeFile(c.id)
          if (r) {
            useStore.getState().applyDelta(r.delta)
            toast('take added from file ✓ (set as keeper)', { kind: 'ok' })
          }
        }
      },
      sendEntryFor('bin', c.id),
      {
        label: <><Ic i={Trash2} size={12} /> delete</>,
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`"${c.name}" is on the timeline (${uses}×). Delete it and remove those instances? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteClip(c.id)
        }
      }
    ]
  }
  // right-click with several clips selected — acts on the WHOLE selection (selection order)
  const clipsBulkMenu = (sel: Clip[]): MenuEntry[] => {
    const ids = sel.map((c) => c.id)
    const uses = (project?.timelines ?? []).reduce((n, t) => n + t.items.filter((it) => ids.includes(it.clipId)).length, 0)
    return [
      {
        label: <><Ic i={ListVideo} size={12} /> add {sel.length} to timeline</>,
        onClick: () => {
          const p = useStore.getState().project
          if (!p) return
          const mk = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
          void useStore.getState().setTimelineItems([...activeItems(p), ...ids.map((clipId) => ({ id: mk(), clipId }))])
          toast(`${sel.length} clips → timeline`, { kind: 'ok' })
        }
      },
      sendEntryFor('bin', ids[0]),
      {
        label: <><Ic i={Trash2} size={12} /> delete {sel.length}</>,
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`These ${sel.length} clips are on the timeline (${uses}×). Delete them and remove those instances? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteClips(ids)
        }
      }
    ]
  }
  // an edit clip's tile shows VIDEO: its own keeper/latest take once one lands, else the source
  // it's editing (seeked to the window start, so the thumb shows the actual bit being changed)
  const editThumb = (c: Clip): { file?: string; seek?: number } => {
    const own = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
    if (own) return { file: own.file }
    const sv = c.promptData.sourceVideo
    if (!sv) return {}
    const srcTake = project?.clips.find((x) => x.id === sv.clipId)?.takes.find((t) => t.id === sv.takeId)
    const file = srcTake?.file ?? (sv.file && project ? `${project.dir}/${sv.file}` : undefined)
    return { file, seek: sv.inSec }
  }

  const renderClip = (c: Clip): React.ReactNode => (
    <div
      draggable
      onDragOver={(e) => {
        // a Video Editor node dropped ON a card = new take on THAT clip
        if (Array.from(e.dataTransfer.types || []).includes(MIME_VEDITNODE)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={(e) => {
        const vn = e.dataTransfer.getData(MIME_VEDITNODE)
        if (!vn) return
        e.preventDefault()
        e.stopPropagation() // the panel background would otherwise bake a SECOND copy as a new clip
        try {
          const o = JSON.parse(vn) as { sessionId?: string; nodeId?: string }
          if (o.sessionId && o.nodeId)
            void vd().veditBakeClip(o.sessionId, o.nodeId, { clipId: c.id }).then((r) => {
              if (!r) return void toast('bake failed', { kind: 'error' })
              useStore.getState().applyDelta(r.delta)
              useStore.getState().selectClip(c.id)
              toast(`node baked → new take on "${c.name}" ✓`, { kind: 'ok' })
            })
        } catch {
          /* malformed drag payload — ignore */
        }
      }}
      onDragStart={(e) => {
        // alt-drag = NATIVE file drag: drop the keeper take's mp4 onto the desktop/a folder to copy
        // it out (the file in renders/ stays). A plain drag stays an in-app clip drag.
        if (e.altKey && c.takes.length) {
          const take = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
          e.preventDefault()
          vd().startFileDrag(take.file)
          return
        }
        // dragging a clip that's part of a multi-selection carries the WHOLE selection
        // (selection order); dragging an unselected one resets the selection to just it
        const st = useStore.getState()
        let ids = st.selectionOf('bin', c.id)
        if (ids.length === 1) {
          ids = [c.id]
          st.setMultiSel('bin', ids)
        }
        e.dataTransfer.setData(MIME_CLIP, c.id)
        e.dataTransfer.setData(MIME_CLIPS, JSON.stringify(ids))
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'bin', id: c.id, ids }))
      }}
      {...tetherAttr('clip', c.id)}
      title={`drag onto the timeline (alt-drag = copy the video to a folder) · double-click = ${c.sheet ? 'Sheet Gen' : 'Clip Gen'} · right-click for actions`}
      onDoubleClick={() => {
        // one editor: every clip opens in Clip Gen (edit clips are ordinary clips since the merge)
        // — except a sheet-tagged capture clip, which opens in Sheet Gen (right-click = open in Clip Gen)
        selectClip(c.id)
        if (c.sheet) openSheetGen()
        else openClipEditor()
      }}
      style={{
        position: 'relative',
        borderRadius: 7,
        // edit clips (v2v) read differently at a glance: a THICKER amber outline — dashed until
        // their first take lands, solid after. Normal clips keep the thin dashed no-render hint.
        outline:
          c.promptData.mode === 'v2v'
            ? `2px ${c.takes.length === 0 ? 'dashed' : 'solid'} var(--amber-dim)`
            : c.takes.length === 0
              ? '1px dashed var(--amber-dim)'
              : 'none',
        outlineOffset: 1
      }}
    >
      <Thumbnail
        file={c.promptData.mode === 'v2v' ? undefined : firstImage(c)}
        videoFile={c.promptData.mode === 'v2v' ? editThumb(c).file : undefined}
        videoSeek={c.promptData.mode === 'v2v' ? editThumb(c).seek : undefined}
        scrubVideo={(c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1])?.file}
        label={`${c.promptData.mode === 'v2v' ? '⑂ ' : ''}${c.name} · ${c.takes.length ? c.takes.length + 't' : '▦'}`}
        placeholder={c.name}
        fill
        w={zClips}
        h={Math.round(zClips * 0.625)}
        active={c.id === selectedClipId}
        onClick={() => selectClip(c.id)}
      />
      {/* sheet clips wear the drawn plate glyph (bible ch. 03: person = char plate, scene = scene plate) */}
      {c.sheet && (
        <span style={{ position: 'absolute', top: 4, left: 4, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none', display: 'inline-flex' }} title={`${c.sheet.mode} plate — Sheet Gen clip`}>
          {c.sheet.mode === 'scene' ? <Scene size={13} strokeWidth={1.75} /> : <Person size={13} strokeWidth={1.75} />}
        </span>
      )}
    </div>
  )

  // image gen tiles (KREA2-LOCAL-SPEC §4 — Bin citizens, his call 2026-09-09): the ★ keeper take is
  // the face; double-click opens Image Gen; drag onto the Library = the keeper as a new @image
  const editImageGen = (id: string): void => {
    useStore.getState().setEditorImageGen(id)
    openImageGen()
  }
  const renderImageGen = (g: ImageGenJob): React.ReactNode => {
    const keeper = g.takes.find((t) => t.id === g.keeperTakeId) ?? g.takes[g.takes.length - 1]
    return (
      <div
        draggable
        onDragStart={(e) => {
          const st = useStore.getState()
          let ids = st.selectionOf('imagegen', g.id)
          if (ids.length === 1) {
            ids = [g.id]
            st.setMultiSel('imagegen', ids)
          }
          e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'imagegen', id: g.id, ids }))
          if (keeper) e.dataTransfer.setData(MIME_GENTAKE, JSON.stringify({ imageGenId: g.id, takeId: keeper.id })) // → the Library
        }}
        onDoubleClick={() => editImageGen(g.id)}
        title="▦ image gen · double-click = Image Gen · drag onto the Library = its ★ take as a new @image · right-click = actions"
        style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 5, cursor: 'pointer' }}
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: 'var(--raised)', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {keeper ? <img src={mediaUrl(keeper.file)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--dim)', fontSize: Math.max(15, Math.round(zImageGen * 0.2)) }}>▦</span>}
        </div>
        <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</div>
        <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {g.takes.length ? `${g.takes.length} take${g.takes.length === 1 ? '' : 's'}` : 'no takes'}
          {keeper && g.keeperTakeId ? ' · ★' : ''}
        </div>
      </div>
    )
  }
  const imageGenMenuEntries = (g: ImageGenJob): MenuEntry[] => [
    { label: <><Ic i={Pencil} size={12} /> edit</>, onClick: () => editImageGen(g.id) },
    {
      label: <><Ic i={Pencil} size={12} /> rename</>,
      onClick: async () => {
        const n = await textPrompt('Rename image gen', g.name)
        if (n && n.trim()) void saveImageGen(g.id, { name: n.trim() })
      }
    },
    { label: <><Ic i={Copy} size={12} /> duplicate</>, onClick: () => void duplicateImageGen(g.id).then((id) => id && editImageGen(id)) },
    sendEntryFor('imagegen', g.id),
    {
      label: <><Ic i={Trash2} size={12} /> delete</>,
      danger: true,
      onClick: () => {
        void confirmDialog(`Delete "${g.name}" and its ${g.takes.length} take${g.takes.length === 1 ? '' : 's'}? Library copies survive. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true }).then((ok) => {
          if (ok) void deleteImageGen(g.id)
        })
      }
    }
  ]

  // ---- the Bin's CARDS (his order 2026-09-09): one bordered, collapsible, draggable card per
  // citizen type; collapsed = title · count · the ＋ button; order + folds persist ----
  const musicClips = (project?.scoreClips ?? []).filter((x) => x.kind !== 'sfx')
  const sfxClips = (project?.scoreClips ?? []).filter((x) => x.kind === 'sfx')
  // a take dragged out of the Score or SFX card lands as its own Bin item (a sound fx stays one)
  const takeDrop = {
    onDragOver: (e: React.DragEvent): void => {
      if (e.dataTransfer.types.includes('vd/score-take')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    onDrop: (e: React.DragEvent): void => {
      const raw = e.dataTransfer.getData('vd/score-take')
      if (!raw) return
      e.preventDefault()
      try {
        const { scoreClipId, takeId } = JSON.parse(raw) as { scoreClipId: string; takeId: string }
        void vd().scoreFromTake(scoreClipId, takeId).then((r) => {
          if (r) {
            useStore.getState().applyDelta(r.delta)
            useStore.getState().setEditorScore(r.newScoreClipId)
          }
        })
      } catch {
        /* malformed payload — ignore */
      }
    }
  }
  const cardDefs: Record<string, { title: string; count: number; add: React.ReactNode; body: React.ReactNode }> = project ? {
    timelines: {
      title: 'timelines',
      count: project.timelines.length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void addTimeline() }} title="create a new empty timeline">
              <Ic i={Plus} size={11} /> timeline
            </span>,
      body: (
        <div ref={tlSecRef} style={{ marginBottom: 10 }}>
          {/* same stretch grid as every other Bin section — zoom = MIN tile width, tiles fill their cell */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${zTl}px, 100%), 1fr))`, gap: 6 }}>
            {project.timelines.map((t) => {
              const active = t.id === project.activeTimelineId
              return (
                <div
                  key={t.id}
                  // NEST (list 3): drag a timeline into another timeline = a nest block (Premiere)
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation() // the tile, not its card
                    e.dataTransfer.setData(MIME_TIMELINE, t.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={(e) => {
                    multiClick(e, 'tl', t.id, () => project.timelines.map((x) => x.id))
                    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) void selectTimeline(t.id)
                  }}
                  onDoubleClick={() => {
                    void selectTimeline(t.id)
                    openTimelineEditor()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!isPicked(multiSel, 'tl', t.id)) useStore.getState().setMultiSel('tl', [t.id]) // outside the selection re-selects (Foldered's rule)
                    setTlMenu({ x: e.clientX, y: e.clientY, id: t.id })
                  }}
                  title="click = show in Timeline · ctrl/shift-click = multi-select · double-click = Timeline Editor · right-click = actions"
                  style={{
                    borderRadius: 7,
                    border: '1px solid ' + (active ? 'var(--amber)' : 'var(--line)'),
                    background: 'var(--field)',
                    padding: 5,
                    cursor: 'pointer',
                    userSelect: 'none',
                    ...selRing(isPicked(multiSel, 'tl', t.id))
                  }}
                >
                  {/* the ▤ badge marks this Bin tile as a TIMELINE, not a clip — same thumb/title/meta
                      anatomy as sheet + score tiles so all four sections zoom together */}
                  <div style={{ width: '100%', aspectRatio: '16 / 10', background: 'var(--raised)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: Math.max(15, Math.round(zTl * 0.2)), color: active ? 'var(--amber)' : 'var(--muted)', lineHeight: 1 }}>▤</span>
                  </div>
                  <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--dim)' }}>
                    {t.aspectRatio} · {t.items.length} clip{t.items.length === 1 ? '' : 's'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    },
    sheets: {
      title: 'char sheets',
      count: (project.charSheets ?? []).length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createCharSheet().then((id) => id && editSheet(id)) }} title="create a char sheet — the character's single home; link it into clips from the characters section">
              <Ic i={Plus} size={11} /> char sheet
            </span>,
      body: (
        <div ref={sheetSecRef} style={{ marginBottom: 10 }}>
          <Foldered kind="sheet" items={project.charSheets ?? []} renderItem={renderSheet} itemMenu={sheetMenuEntries} root={null} />
        </div>
      )
    },
    styles: {
      title: 'style sheets',
      count: project.styles.length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createStyle().then((id) => id && editStyle(id)) }} title="create a style sheet — universal field values any clip can link via a field's ⛓ picker">
              <Ic i={Plus} size={11} /> style sheet
            </span>,
      body: (
        <div ref={styleSecRef} style={{ marginBottom: 10 }}>
          <Foldered kind="style" items={project.styles} renderItem={renderStyle} itemMenu={styleMenuEntries} root={null} />
        </div>
      )
    },
    scores: {
      title: 'scores',
      count: musicClips.length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createScoreClip().then((id) => id && editScore(id)) }} title="create a score clip — timestamped music directions render as takes">
              <Ic i={Plus} size={11} /> score
            </span>,
      body: (
        <div ref={scoreSecRef} style={{ marginBottom: 10 }} {...takeDrop}>
          <Foldered kind="score" items={musicClips} renderItem={renderScore} itemMenu={scoreMenuEntries} root={null} />
        </div>
      )
    },
    sfx: {
      title: 'sound fx',
      count: sfxClips.length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createScoreClip(undefined, 'sfx').then((id) => id && editScore(id)) }} title="create a sound fx — the SFX card renders it from words or from the footage under it">
              <Ic i={Plus} size={11} /> sound fx
            </span>,
      body: (
        <div ref={sfxSecRef} style={{ marginBottom: 10 }} {...takeDrop}>
          <Foldered kind="sfx" items={sfxClips} renderItem={renderSfx} itemMenu={scoreMenuEntries} root={null} />
        </div>
      )
    },
    voices: {
      title: 'voices',
      count: (project.voiceClips ?? []).length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createVoiceClip().then((id) => id && editVoice(id)) }} title="create a voice — sound files from a description + the character's image; the ★ keeper binds to a char sheet">
              <Ic i={Plus} size={11} /> voice
            </span>,
      body: (
        <div
          ref={voiceSecRef}
          style={{ marginBottom: 10 }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('vd/voice-take')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData('vd/voice-take')
            if (!raw) return
            e.preventDefault()
            try {
              const { voiceClipId, takeId } = JSON.parse(raw) as { voiceClipId: string; takeId: string }
              void vd().voiceFromTake(voiceClipId, takeId).then((r) => {
                if (r) {
                  useStore.getState().applyDelta(r.delta)
                  useStore.getState().setEditorVoice(r.newVoiceClipId)
                }
              })
            } catch {
              /* malformed payload — ignore */
            }
          }}
        >
          <Foldered kind="voice" items={project.voiceClips ?? []} renderItem={renderVoice} itemMenu={voiceMenuEntries} root={null} />
        </div>
      )
    },
    clips: {
      title: 'clips',
      count: clips.length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createClip() }} title="create a new empty clip">
              <Ic i={Plus} size={11} /> clip
            </span>,
      body: (
        <div ref={clipsSecRef}>
          {clips.length === 0 && <p className="vd-hint">No clips yet — render one or hit “+ clip”.</p>}
          <Foldered kind="bin" items={clips} renderItem={renderClip} itemMenu={clipMenu} bulkMenu={clipsBulkMenu} root={rootFolder ?? null} onLand={(c) => selectClip(c.id)} />
        </div>
      )
    },
    imagegens: {
      title: 'image gens',
      count: (project.imageGens ?? []).length,
      add: <span className="btn vd-hbtn" style={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); void createImageGen().then((id) => id && editImageGen(id)) }} title="create an image gen — Krea 2 on your GPU; the ★ keeper take is its face"><Ic i={Plus} size={11} /> image gen</span>,
      body: (
        <div ref={imageGenSecRef}>
          <Foldered kind="imagegen" items={project.imageGens ?? []} renderItem={renderImageGen} itemMenu={imageGenMenuEntries} root={null} />
        </div>
      )
    },
  } : {}
  return (
    <div
      ref={panelRef}
      className="vd-panel"
      onDragOver={(e) => {
        const t = Array.from(e.dataTransfer.types || [])
        if (t.includes(MIME_TAKE) || t.includes(MIME_VEDITNODE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        // a Video Editor node on EMPTY Bin space = bake → brand-new clip (node = take 1)
        const vn = e.dataTransfer.getData(MIME_VEDITNODE)
        if (vn) {
          e.preventDefault()
          setOver(false)
          try {
            const o = JSON.parse(vn) as { sessionId?: string; nodeId?: string }
            if (o.sessionId && o.nodeId)
              void vd().veditBakeClip(o.sessionId, o.nodeId, {}).then((r) => {
                if (!r) return void toast('bake failed', { kind: 'error' })
                useStore.getState().applyDelta(r.delta)
                useStore.getState().selectClip(r.clipId)
                toast('node baked → new clip in the Bin ✓', { kind: 'ok' })
              })
          } catch {
            /* malformed drag payload — ignore */
          }
          return
        }
        const d = e.dataTransfer.getData(MIME_TAKE)
        if (!d) return
        e.preventDefault()
        setOver(false)
        try {
          const o = JSON.parse(d) as { clipId?: string; takeId?: string }
          if (o.clipId && o.takeId) void cloneTakeToClip(o.clipId, o.takeId)
        } catch (err) {
          console.error('[bin drop] parse failed', err)
        }
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -2, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
      {project && (
        <>
          <span
            className="btn vd-hbtn"
            style={{ display: 'inline-block', marginBottom: 8 }}
            title="browse another project folder and copy clips (with their renders + refs) into this one"
            onClick={async () => {
              const r = await vd().importPickProject()
              if (!r) {
                await alertDialog('No readable Video Dancer project (project.json) found in that folder.')
                return
              }
              setImportSel(new Set(r.clips.map((c) => c.id))) // preselect everything
              setImporting(r)
            }}
          >
            <Ic i={FolderInput} /> Import from project…
          </span>{' '}
          <TileZoomSlider kind="bin" />
        </>
      )}
      {!project && <p className="vd-hint">No project open. Use New / Open at the top.</p>}
      {project &&
        order
          .filter((k) => cardDefs[k])
          .map((k) => {
            const c = cardDefs[k]
            const open = !binCollapsed.includes(k)
            return (
              <div
                key={k}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(MIME_BINCARD, k)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (Array.from(e.dataTransfer.types).includes(MIME_BINCARD)) {
                    e.preventDefault()
                    setCardOver(k)
                  }
                }}
                onDragLeave={() => setCardOver((v) => (v === k ? null : v))}
                onDrop={(e) => {
                  const from = e.dataTransfer.getData(MIME_BINCARD)
                  setCardOver(null)
                  if (!from || from === k) return
                  e.preventDefault()
                  e.stopPropagation()
                  const next = order.filter((x) => x !== from)
                  next.splice(next.indexOf(k), 0, from)
                  setBinOrder(next)
                }}
                style={{ outline: cardOver === k ? '1px dashed var(--amber)' : 'none', outlineOffset: 2, borderRadius: 6 }}
                title="drag the card to reorder · click the title to fold"
              >
                <Section
                  title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {c.title}
                      <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--mono)', fontSize: 10 }}>{c.count}</span>
                    </span>
                  }
                  right={<span style={{ display: 'inline-flex', width: 108 }}>{c.add}</span>} // one width for every ＋ (his call 2026-09-09)
                  collapsible
                  open={open}
                  onToggle={() => toggleBinCard(k)}
                >
                  {c.body}
                </Section>
              </div>
            )
          })}
      </div>
      {/* details footer — pinned to the panel BOTTOM (icons/folders scroll above it) */}
      {(() => {
        const sel = clips.find((c) => c.id === selectedClipId)
        if (!sel) return null
        const titleOfId = (id: string): string | undefined => project?.images.find((i) => i.id === id)?.title
        const refs = (sel.promptData.imageIds ?? []).map(titleOfId).filter(Boolean).join(', ')
        const seed = clipSeed(sel)
        const state = sel.takes.length === 0 ? 'storyboard · no render' : `${sel.takes.length} take${sel.takes.length > 1 ? 's' : ''} · rendered`
        return (
          <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--line)', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', background: 'var(--bg2)' }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }}>details</div>
            <div style={{ color: 'var(--txt-hi)', fontWeight: 600 }}>{sel.name}</div>
            <div>
              {modelFor(sel.promptData.engine).label} · {sel.promptData.duration}s · {state}
              {seed != null ? ` · seed ${seed}` : ''}
            </div>
            {refs && <div>refs: {refs}</div>}
          </div>
        )
      })()}
      {tlMenu &&
        (() => {
          // the shared ContextMenu (submenu-capable) — the old hand-rolled portal predates it
          const t = project?.timelines.find((x) => x.id === tlMenu.id)
          if (!t) return null
          const entries: MenuEntry[] = [
            {
              label: <><Ic i={Pencil} size={12} /> rename</>,
              onClick: async () => {
                const n = await textPrompt('Rename timeline', t.name)
                if (n && n.trim()) void renameTimeline(t.id, n.trim())
              }
            },
            {
              label: <><Ic i={ListVideo} size={12} /> edit settings</>,
              onClick: () => {
                void selectTimeline(t.id)
                openTimelineEditor()
              }
            },
            {
              label: <><Ic i={FolderInput} size={12} /> export video…</>,
              onClick: () => {
                if (t.items.length === 0) {
                  toast('this timeline is empty — nothing to export', { kind: 'error' })
                  return
                }
                void useStore.getState().startExport(t.id) // full pipeline; progress shows in the Timeline panels
              }
            },
            { label: <><Ic i={Copy} size={12} /> duplicate</>, onClick: () => void duplicateTimeline(t.id) },
            sendEntryFor('tl', t.id),
            {
              label: <><Ic i={Trash2} size={12} /> delete</>,
              danger: true,
              onClick: async () => {
                // NEST (list 3): its nest blocks leave every other timeline too — say so first
                const uses = (project?.timelines ?? []).reduce((n, x) => n + x.items.filter((it) => it.nestId === t.id).length, 0)
                const nestLine = uses ? ` It plays as a nest in ${uses} place${uses === 1 ? '' : 's'}: those nest blocks go too.` : ''
                // empty = no blocks, no sound, no scores, no markers: a sound-only timeline asked nothing before (audit 2026-10-09 L26)
                const sounds = (t.audioItems?.length ?? 0) + (t.scoreItems?.length ?? 0) + (t.markers?.length ?? 0)
                if ((t.items.length === 0 && sounds === 0 && !uses) || (await confirmDialog(`Delete "${t.name}" (${t.items.length} clips${sounds ? `, ${sounds} sound / marker item${sounds === 1 ? '' : 's'}` : ''} on it)?${nestLine} Clips in the Bin are untouched. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                  void deleteTimeline(t.id)
              }
            }
          ]
          // list 5: several timelines picked → export them all, one file each, into one folder
          const picked = menuSelection('tl', t.id).sets.tl ?? []
          const bulk: MenuEntry[] = [
            { label: <><Ic i={FolderInput} size={12} /> export {picked.length} timelines…</>, onClick: () => void useStore.getState().startExportMany(picked) },
            sendEntryFor('tl', t.id)
          ]
          return <ContextMenu x={tlMenu.x} y={tlMenu.y} entries={selectionMenu('tl', t.id, entries, bulk)} onClose={() => setTlMenu(null)} />
        })()}
      {importing &&
        createPortal(
          <div
            onClick={() => !importBusy && setImporting(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, padding: 16, width: 'min(720px, 88vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <span className="lb" style={{ margin: 0 }}>
                  import clips from “{importing.name}” <span style={{ color: 'var(--dim)' }}>— renders + refs are COPIED in; the source project is untouched</span>
                </span>
                <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => setImportSel(new Set(importing.clips.map((c) => c.id)))}>all</span>
                <span className="btn vd-hbtn" onClick={() => setImportSel(new Set())}>none</span>
                <span style={{ cursor: 'pointer', color: 'var(--dim)' }} onClick={() => !importBusy && setImporting(null)}>✕</span>
              </div>
              <div className="vd-scroll" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, overflowY: 'auto', flex: 1 }}>
                {importing.clips.length === 0 && <p className="vd-hint">That project has no clips.</p>}
                {importing.clips.map((c) => {
                  const on = importSel.has(c.id)
                  return (
                    <div
                      key={c.id}
                      onClick={() =>
                        setImportSel((s) => {
                          const n = new Set(s)
                          if (n.has(c.id)) n.delete(c.id)
                          else n.add(c.id)
                          return n
                        })
                      }
                      title={c.name}
                      style={{ width: 132, cursor: 'pointer', borderRadius: 7, outline: on ? '2px solid var(--amber)' : '1px solid var(--line)', outlineOffset: -1, padding: 4, opacity: on ? 1 : 0.6 }}
                    >
                      <div style={{ width: '100%', height: 74, background: 'var(--field)', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {c.thumb ? (
                          <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                          <span style={{ color: 'var(--dim)', fontSize: 9 }}>{c.takes ? '▶' : '▦'}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--tile-title)', color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                        {c.takes ? `${c.takes} take${c.takes > 1 ? 's' : ''}` : 'storyboard'} · {c.duration}s{c.beats ? ` · ${c.beats} beats` : ''}
                        {c.engine ? ` · ${modelFor(c.engine).label}` : ''}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{importSel.size} of {importing.clips.length} selected</span>
                <span
                  className="btn"
                  style={{ marginLeft: 'auto', opacity: importBusy || importSel.size === 0 ? 0.5 : 1, pointerEvents: importBusy || importSel.size === 0 ? 'none' : 'auto' }}
                  onClick={async () => {
                    setImportBusy(true)
                    const res = await vd().importClips(importing.dir, [...importSel])
                    setImportBusy(false)
                    if (res) useStore.getState().applyDelta(res.delta)
                    setImporting(null)
                  }}
                >
                  {importBusy ? (
                    'importing…'
                  ) : (
                    <>
                      <Ic i={FolderInput} /> Import {importSel.size} clip{importSel.size === 1 ? '' : 's'}
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
