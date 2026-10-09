import { useEffect, useState } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { Section } from '@koan/shared'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { EmptyState } from '../ui/EmptyState'
import { MonitorPanel } from './Monitor'
import { openTimelineEditor, raiseTimelineMonitor } from '../panelBus'

// ---- ASSEMBLY (docs/archive/ASSEMBLY-SPEC-2026-09-09): the Co-Director's first cut. Monitor on top ·
// Assembly Concept writes the outline from the conversation + storyboard · a correction box, back
// and forth · lock · Assemble watches every take and cuts a NEW timeline you refine. ----

export function AssemblyPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const assembly = useStore((s) => s.project?.assembly)
  const applyDelta = useStore((s) => s.applyDelta)
  const monitorDocked = useStore((s) => s.monitorDocked)
  const [correction, setCorrection] = useState('')
  const [busy, setBusy] = useState<'concept' | 'assemble' | null>(null)
  const [status, setStatus] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())

  // progress rides the render status channel ("assembly · watching KATA T1…")
  useEffect(() => vd().onRenderProgress((p) => {
    if (p.msg.startsWith('assembly')) setStatus(p.msg)
  }), [])

  if (!project) return <EmptyState>open a project</EmptyState>
  const tl = project.timelines.find((t) => t.id === project.activeTimelineId)
  const shots = tl?.items.length ?? 0
  const outline = assembly?.outline?.trim() ?? ''
  const locked = !!assembly?.locked
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode, right?: React.ReactNode): React.JSX.Element => (
    <Section
      title={title}
      right={right}
      collapsible
      open={!closed.has(id)}
      onToggle={() =>
        setClosed((s) => {
          const n = new Set(s)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        })
      }
    >
      {body}
    </Section>
  )

  const concept = async (): Promise<void> => {
    if (busy) return
    setBusy('concept')
    setStatus('assembly · writing the outline…')
    try {
      const r = await vd().assemblyConcept(correction.trim() || undefined)
      if (!r.ok) return void toast(`concept: ${r.error ?? 'failed'}`, { kind: 'error' })
      if (r.delta) applyDelta(r.delta)
      setCorrection('')
      setStatus('')
    } finally {
      setBusy(null)
    }
  }
  const lock = async (v: boolean): Promise<void> => {
    const d = await vd().assemblyLock(v)
    if (d) applyDelta(d)
  }
  const assemble = async (): Promise<void> => {
    if (busy || !locked) return
    setBusy('assemble')
    setStatus('assembly · reading the storyboard…')
    try {
      const r = await vd().assemblyAssemble()
      if (!r.ok) return void toast(`assemble: ${r.error ?? 'failed'}`, { kind: 'error' })
      if (r.delta) applyDelta(r.delta)
      setStatus('')
      toast(`assembled ${r.placed} shot${r.placed === 1 ? '' : 's'} onto a new timeline${r.holes?.length ? ` · ${r.holes.length} hole${r.holes.length > 1 ? 's' : ''} left open` : ''}`, { kind: 'ok' })
    } finally {
      setBusy(null)
    }
  }

  const assembleWhy = !outline ? 'run Assembly Concept first' : !locked ? 'lock the outline first' : shots === 0 ? 'the storyboard is empty' : ''

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* the monitor — the program Monitor, playing the active timeline (assemble makes the cut active) */}
      {/* ONE Monitor engine plays: a second one doubled every sound and ran gaps at 2× (audit 2026-10-09
          M32). With the Timeline Monitor in the dock, Assembly points to it instead of embedding its own. */}
      {monitorDocked ? (
        <div style={{ flex: '0 0 auto', padding: 8, borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          the cut plays in the Timeline Monitor
          <span className="btn vd-hbtn" onClick={() => raiseTimelineMonitor()}>show it</span>
        </div>
      ) : (
        <div style={{ flex: '0 0 auto', height: 240, borderBottom: '1px solid var(--line)' }}>
          <MonitorPanel />
        </div>
      )}
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}>
        {sec(
          'concept',
          'assembly concept',
          <>
            <div className="field">
              <div className="lb" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>outline</span>
                <span style={{ color: 'var(--dim)' }}>{tl ? `${tl.name} · ${shots} shot${shots === 1 ? '' : 's'}` : 'no timeline'}</span>
                <span className="btn vd-hbtn" style={{ marginLeft: 'auto', ...(busy ? { opacity: 0.5, cursor: 'default' } : {}) }} onClick={() => void concept()} title="read the conversation and the storyboard, write the assembly outline (re-run with a correction below)">
                  {busy === 'concept' ? '⏳ thinking…' : outline ? '↻ concept' : '✎ assembly concept'}
                </span>
                <span
                  className="btn vd-hbtn"
                  style={{ ...(locked ? { background: 'var(--amber)', borderColor: 'var(--amber)', color: 'var(--on-accent)' } : {}), ...(outline ? {} : { opacity: 0.4, cursor: 'default' }) }}
                  onClick={() => outline && void lock(!locked)}
                  title={locked ? 'locked — click to unlock and keep correcting' : 'lock the outline — assemble needs a locked outline'}
                >
                  {locked ? '🔒 locked' : '🔓 lock'}
                </span>
              </div>
              {outline ? (
                <pre className="vd-copy" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11.5, color: 'var(--body)', background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, maxHeight: 360, overflow: 'auto' }}>
                  {outline}
                </pre>
              ) : (
                <p className="vd-hint">no outline yet — press assembly concept. It reads the Co-Director conversation and the storyboard and writes what the cut should be.</p>
              )}
            </div>
            <div className="field">
              <div className="lb">correct it</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <textarea
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void concept()
                    }
                  }}
                  rows={2}
                  disabled={locked}
                  placeholder={locked ? 'unlock to keep correcting' : 'e.g. swap shots 2 and 3 · the alley shot is too long · open on the face — Enter re-runs the concept'}
                  style={{ ...ctl, flex: 1, resize: 'vertical', fontSize: 11.5 }}
                />
              </div>
            </div>
          </>
        )}
        {sec(
          'assemble',
          'assemble',
          <>
            <p className="vd-hint">watches every take of every shot (keeper + two), picks the take and the window that serve each outline shot, and cuts them in story order onto a NEW timeline. Each block's tooltip names its shot. You refine from there.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="btn"
                style={assembleWhy || busy ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                onClick={() => !assembleWhy && void assemble()}
                title={assembleWhy ? `assemble is off — ${assembleWhy}` : 'assemble the first cut onto a new timeline'}
              >
                {busy === 'assemble' ? '⏳ assembling…' : '▶ assemble'}
              </span>
              {assembly?.timelineId && (
                <span className="btn vd-hbtn" onClick={() => openTimelineEditor()} title="open the Timeline panel on the assembled cut">
                  open timeline
                </span>
              )}
              <span style={{ fontSize: 10.5, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{status}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
