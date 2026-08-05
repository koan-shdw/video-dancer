import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { Thumbnail } from '../Thumbnail'
import { TileZoomSlider, useCtrlWheelZoom } from '../lib/tileZoom'
import { MIME_CLIP, MIME_CLIPS, MIME_MOVE, MIME_TAKE } from '../lib/dragDrop'
import { clipSeed } from '../lib/clipMeta'
import { activeItems } from '../lib/timelineUtils'
import { modelFor } from '../../../shared/models'
import { Foldered, type MenuEntry } from './Foldered'
import { toast } from '../ui/Toast'
import { textPrompt, confirmDialog, alertDialog } from '../prompt'
import { openTimelineEditor, openClipEditor, openClipEdit, openCharSheetPanel } from '../panelBus'
import { Ic, Plus, FolderInput, Pencil, Copy, Trash2, ListVideo, Upload, Wand2 } from '../ui/icons'

// ---- Bin: clips as icon tiles — folders + right-click actions; drop a take here to clone ----
export function BinPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const zoom = useStore((s) => s.tileZoom.bin)
  const panelRef = useRef<HTMLDivElement>(null)
  useCtrlWheelZoom(panelRef, 'bin') // ctrl+scroll = thumbnail zoom, Explorer-style
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
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
  const [sheetMenu, setSheetMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  // char sheets edit in the DOCKED Char Sheet panel (same grammar as Clip Gen/Clip Edit)
  const editSheet = (id: string): void => {
    useStore.getState().setEditorSheet(id)
    openCharSheetPanel()
  }
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
      ...(c.takes.length
        ? [
            {
              // send the ★ take into Clip Edit as a v2v draft (for edit clips this forks a FURTHER edit)
              label: <><Ic i={Wand2} size={12} /> edit keeper take with AI (v2v)</>,
              onClick: (): void => {
                const take = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
                useStore.getState().setEditTarget({ source: { clipId: c.id, takeId: take.id } })
                openClipEdit()
              }
            } as MenuEntry,
            {
              label: <><Ic i={FolderInput} size={12} /> export video…</>,
              onClick: async (): Promise<void> => {
                const r = await window.vidancer.clipExport(c.id)
                if (r.ok && r.file) toast('exported ✓ — click to show in Explorer', { kind: 'ok', onClick: () => void window.vidancer.revealFile(r.file!) })
                else if (r.error !== 'cancelled') toast(`export failed: ${r.error ?? 'unknown'}`, { kind: 'error' })
              }
            } as MenuEntry
          ]
        : []),
      {
        // rescue path: a render the app wasn't alive to catch → grab the mp4 from the fal
        // dashboard and attach it here as a real take
        label: <><Ic i={Upload} size={12} /> add take from file…</>,
        onClick: async (): Promise<void> => {
          const r = await window.vidancer.clipAddTakeFile(c.id)
          if (r) {
            useStore.getState().applyDelta(r.delta)
            toast('take added from file ✓ (set as keeper)', { kind: 'ok' })
          }
        }
      },
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
      onDragStart={(e) => {
        // alt-drag = NATIVE file drag: drop the keeper take's mp4 onto the desktop/a folder to copy
        // it out (the file in renders/ stays). A plain drag stays an in-app clip drag.
        if (e.altKey && c.takes.length) {
          const take = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
          e.preventDefault()
          window.vidancer.startFileDrag(take.file)
          return
        }
        // dragging a clip that's part of a multi-selection carries the WHOLE selection
        // (selection order); dragging an unselected one resets the selection to just it
        const st = useStore.getState()
        let ids = st.multiSel?.kind === 'bin' && st.multiSel.ids.includes(c.id) ? st.multiSel.ids : [c.id]
        if (ids.length === 1) {
          ids = [c.id]
          st.setMultiSel('bin', ids)
        }
        e.dataTransfer.setData(MIME_CLIP, c.id)
        e.dataTransfer.setData(MIME_CLIPS, JSON.stringify(ids))
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'bin', id: c.id, ids }))
      }}
      title={`drag onto the timeline (alt-drag = copy the video to a folder) · double-click = ${c.promptData.mode === 'v2v' ? 'Clip Edit' : 'Clip Gen'} · right-click for actions`}
      onDoubleClick={() => {
        selectClip(c.id)
        // edit clips (v2v) live in Clip Edit; generation clips in Clip Gen
        if (c.promptData.mode === 'v2v') {
          useStore.getState().setEditTarget({ clipId: c.id })
          openClipEdit()
        } else {
          openClipEditor()
        }
      }}
      style={{
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
        w={zoom}
        h={Math.round(zoom * 0.625)}
        active={c.id === selectedClipId}
        onClick={() => selectClip(c.id)}
      />
    </div>
  )

  return (
    <div
      ref={panelRef}
      className="vd-panel"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes(MIME_TAKE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
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
              const r = await window.vidancer.importPickProject()
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
      {/* ----- timelines: Bin citizens — click = open in the Timeline panel, double-click = Timeline Editor ----- */}
      {project && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            timelines
            <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void addTimeline()} title="create a new empty timeline">
              <Ic i={Plus} size={11} /> timeline
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {project.timelines.map((t) => {
              const active = t.id === project.activeTimelineId
              return (
                <div
                  key={t.id}
                  onClick={() => void selectTimeline(t.id)}
                  onDoubleClick={() => {
                    void selectTimeline(t.id)
                    openTimelineEditor()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setTlMenu({ x: e.clientX, y: e.clientY, id: t.id })
                  }}
                  title="click = show in Timeline · double-click = Timeline Editor · right-click = actions"
                  style={{
                    width: 96,
                    borderRadius: 7,
                    border: '1px solid ' + (active ? 'var(--amber)' : 'var(--line)'),
                    background: 'var(--field)',
                    padding: '6px 7px',
                    cursor: 'pointer'
                  }}
                >
                  {/* the ▤ badge marks this Bin tile as a TIMELINE, not a clip */}
                  <div style={{ fontSize: 15, color: active ? 'var(--amber)' : 'var(--muted)', lineHeight: 1 }}>▤</div>
                  <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--dim)' }}>
                    {t.aspectRatio} · {t.items.length} clip{t.items.length === 1 ? '' : 's'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {/* ----- char sheets: characters as first-class citizens — image + universal description ----- */}
      {project && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            char sheets
            <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void createCharSheet().then((id) => id && editSheet(id))} title="create a char sheet — the character's single home; link it into clips from the characters section">
              <Ic i={Plus} size={11} /> char sheet
            </span>
          </div>
          {(project.charSheets ?? []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(project.charSheets ?? []).map((sh) => {
                const im = sh.imageId ? project.images.find((i) => i.id === sh.imageId) : undefined
                return (
                  <div
                    key={sh.id}
                    onDoubleClick={() => editSheet(sh.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSheetMenu({ x: e.clientX, y: e.clientY, id: sh.id })
                    }}
                    title="⛉ char sheet · double-click = edit · right-click = actions · link into clips via the characters “from clip” picker"
                    style={{ width: 96, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 5, cursor: 'pointer' }}
                  >
                    <div style={{ width: '100%', height: 56, background: 'var(--raised)', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {im ? <img src={mediaUrl(im.file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--dim)', fontSize: 15 }}>⛉</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sh.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sh.character.name || '—'}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {project && (
        <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          clips
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void createClip()} title="create a new empty clip">
            <Ic i={Plus} size={11} /> clip
          </span>
        </div>
      )}
      {project && clips.length === 0 && <p className="vd-hint">No clips yet — render one or hit “+ clip”.</p>}
      {project && <Foldered kind="bin" items={clips} renderItem={renderClip} itemMenu={clipMenu} bulkMenu={clipsBulkMenu} root={rootFolder ?? null} />}
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
      {sheetMenu &&
        createPortal(
          <div onClick={() => setSheetMenu(null)} onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: sheetMenu.x, top: sheetMenu.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 130 }}>
              <div
                onClick={() => {
                  setSheetMenu(null)
                  editSheet(sheetMenu.id)
                }}
                style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: 'var(--body)' }}
              >
                <Ic i={Pencil} size={11} /> edit
              </div>
              <div
                onClick={async () => {
                  const id = sheetMenu.id
                  setSheetMenu(null)
                  const sh = project?.charSheets.find((x) => x.id === id)
                  if (!sh) return
                  const uses = (project?.clips ?? []).filter((c) => (c.promptData.characterLinks ?? []).some((l) => l.clipId === id)).length
                  if (uses === 0 || (await confirmDialog(`"${sh.name}" is linked into ${uses} clip(s) — delete it and let those links resolve to nothing? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                    void deleteCharSheet(id)
                }}
                style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: 'var(--bad)' }}
              >
                <Ic i={Trash2} size={11} /> delete
              </div>
            </div>
          </div>,
          document.body
        )}
      {tlMenu &&
        createPortal(
          <div onClick={() => setTlMenu(null)} onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: tlMenu.x, top: tlMenu.y, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 130 }}
            >
              {(() => {
                const t = project?.timelines.find((x) => x.id === tlMenu.id)
                if (!t) return null
                const item = (key: string, label: React.ReactNode, danger: boolean, onClick: () => void): React.JSX.Element => (
                  <div
                    key={key}
                    onClick={() => {
                      setTlMenu(null)
                      onClick()
                    }}
                    style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: danger ? 'var(--bad)' : 'var(--body)' }}
                  >
                    {label}
                  </div>
                )
                return (
                  <>
                    {item('rename', <><Ic i={Pencil} size={11} /> rename</>, false, async () => {
                      const n = await textPrompt('Rename timeline', t.name)
                      if (n && n.trim()) void renameTimeline(t.id, n.trim())
                    })}
                    {item('settings', <><Ic i={ListVideo} size={11} /> edit settings</>, false, () => {
                      void selectTimeline(t.id)
                      openTimelineEditor()
                    })}
                    {item('duplicate', <><Ic i={Copy} size={11} /> duplicate</>, false, () => void duplicateTimeline(t.id))}
                    {item('delete', <><Ic i={Trash2} size={11} /> delete</>, true, async () => {
                      if (t.items.length === 0 || (await confirmDialog(`Delete "${t.name}" (${t.items.length} clips on it)? Clips in the Bin are untouched. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
                        void deleteTimeline(t.id)
                    })}
                  </>
                )
              })()}
            </div>
          </div>,
          document.body
        )}
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
                      <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
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
                    const res = await window.vidancer.importClips(importing.dir, [...importSel])
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
