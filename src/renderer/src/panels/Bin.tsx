import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { MIME_CLIP, MIME_MOVE, MIME_TAKE } from '../lib/dragDrop'
import { clipSeed } from '../lib/clipMeta'
import { modelFor } from '../../../shared/models'
import { Foldered, type MenuEntry } from './Foldered'
import { textPrompt, confirmDialog, alertDialog } from '../prompt'
import { openTimelineEditor } from '../panelBus'

// ---- Bin: clips as icon tiles — folders + right-click actions; drop a take here to clone ----
export function BinPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const cloneTakeToClip = useStore((s) => s.cloneTakeToClip)
  const createClip = useStore((s) => s.createClip)
  const renameClip = useStore((s) => s.renameClip)
  const duplicateClip = useStore((s) => s.duplicateClip)
  const deleteClip = useStore((s) => s.deleteClip)
  const renameTimeline = useStore((s) => s.renameTimeline)
  const duplicateTimeline = useStore((s) => s.duplicateTimeline)
  const deleteTimeline = useStore((s) => s.deleteTimeline)
  const selectTimeline = useStore((s) => s.selectTimeline)
  const addTimeline = useStore((s) => s.addTimeline)
  const [over, setOver] = useState(false)
  const [tlMenu, setTlMenu] = useState<{ x: number; y: number; id: string } | null>(null)
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
        label: '✎ rename',
        onClick: async () => {
          const n = await textPrompt('Rename clip', c.name)
          if (n && n.trim()) void renameClip(c.id, n.trim())
        }
      },
      { label: '⧉ duplicate', onClick: () => void duplicateClip(c.id) },
      {
        label: '🗑 delete',
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`"${c.name}" is on the timeline (${uses}×). Delete it and remove those instances? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })))
            void deleteClip(c.id)
        }
      }
    ]
  }
  const renderClip = (c: Clip): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_CLIP, c.id)
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'bin', id: c.id }))
      }}
      title="drag onto the timeline · right-click for actions"
      style={{ borderRadius: 7, outline: c.takes.length === 0 ? '1px dashed var(--amber-dim)' : 'none', outlineOffset: 1 }}
    >
      <Thumbnail
        file={firstImage(c)}
        label={`${c.name} · ${c.takes.length ? c.takes.length + 't' : '▦'}`}
        placeholder={c.name}
        w={96}
        h={60}
        active={c.id === selectedClipId}
        onClick={() => selectClip(c.id)}
      />
    </div>
  )

  return (
    <div
      className="vd-panel vd-scroll"
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
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -2 }}
    >
      {project && (
        <>
          <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void createClip()}>
            + New clip
          </span>{' '}
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
            ⇪ Import from project…
          </span>
        </>
      )}
      {!project && <p className="vd-hint">No project open. Use New / Open at the top.</p>}
      {/* ----- timelines: Bin citizens — click = open in the Timeline panel, double-click = Timeline Editor ----- */}
      {project && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            timelines
            <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void addTimeline()} title="create a new empty timeline">
              + timeline
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
                    background: '#101014',
                    padding: '6px 7px',
                    cursor: 'pointer'
                  }}
                >
                  {/* the ▤ badge marks this Bin tile as a TIMELINE, not a clip */}
                  <div style={{ fontSize: 15, color: active ? 'var(--amber)' : 'var(--muted)', lineHeight: 1 }}>▤</div>
                  <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--dim)' }}>
                    {t.aspectRatio} · {t.items.length} clip{t.items.length === 1 ? '' : 's'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {project && clips.length === 0 && <p className="vd-hint">No clips yet — render one or hit “+ New clip”.</p>}
      {project && <Foldered kind="bin" items={clips} renderItem={renderClip} itemMenu={clipMenu} root={rootFolder ?? null} />}
      {(() => {
        const sel = clips.find((c) => c.id === selectedClipId)
        if (!sel) return null
        const titleOfId = (id: string): string | undefined => project?.images.find((i) => i.id === id)?.title
        const refs = (sel.promptData.imageIds ?? []).map(titleOfId).filter(Boolean).join(', ')
        const seed = clipSeed(sel)
        const state = sel.takes.length === 0 ? 'storyboard · no render' : `${sel.takes.length} take${sel.takes.length > 1 ? 's' : ''} · rendered`
        return (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--muted)' }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }}>details</div>
            <div style={{ color: '#e8e8ee', fontWeight: 600 }}>{sel.name}</div>
            <div>
              {modelFor(sel.promptData.engine).label} · {sel.promptData.duration}s · {state}
              {seed != null ? ` · seed ${seed}` : ''}
            </div>
            {refs && <div>refs: {refs}</div>}
          </div>
        )
      })()}
      {tlMenu &&
        createPortal(
          <div onClick={() => setTlMenu(null)} onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: tlMenu.x, top: tlMenu.y, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 130 }}
            >
              {(() => {
                const t = project?.timelines.find((x) => x.id === tlMenu.id)
                if (!t) return null
                const item = (label: string, danger: boolean, onClick: () => void): React.JSX.Element => (
                  <div
                    key={label}
                    onClick={() => {
                      setTlMenu(null)
                      onClick()
                    }}
                    style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 4, color: danger ? 'var(--bad)' : '#cfcfd6' }}
                  >
                    {label}
                  </div>
                )
                return (
                  <>
                    {item('✎ rename', false, async () => {
                      const n = await textPrompt('Rename timeline', t.name)
                      if (n && n.trim()) void renameTimeline(t.id, n.trim())
                    })}
                    {item('▤ edit settings', false, () => {
                      void selectTimeline(t.id)
                      openTimelineEditor()
                    })}
                    {item('⧉ duplicate', false, () => void duplicateTimeline(t.id))}
                    {item('🗑 delete', true, async () => {
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
                      <div style={{ width: '100%', height: 74, background: '#101014', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {c.thumb ? (
                          <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                          <span style={{ color: 'var(--dim)', fontSize: 9 }}>{c.takes ? '▶' : '▦'}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
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
                  {importBusy ? 'importing…' : `⇪ Import ${importSel.size} clip${importSel.size === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
