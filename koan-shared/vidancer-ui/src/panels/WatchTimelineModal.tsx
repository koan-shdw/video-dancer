import { useEffect, useRef, useState } from 'react'
import { vd } from '../api'
import { Modal } from '../ui/Modal'
import { ctl } from '../ui/controls'
import type { WatchTimelineResult } from '../shared/watch'

export function WatchTimelineModal({ timeline, onClose }: { timeline: Timeline; onClose: () => void }): React.JSX.Element {
  const [question, setQuestion] = useState('Describe the story so far, what happens at the end, and any continuity or pacing problems.')
  const [range, setRange] = useState<'full' | 'selection'>('full')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<WatchTimelineResult | null>(null)
  const busyRef = useRef(false)
  const alive = useRef(true)
  const hasRange = timeline.rangeInSec != null && timeline.rangeOutSec != null && timeline.rangeOutSec > timeline.rangeInSec
  useEffect(() => {
    alive.current = true
    const off = vd().onWatchProgress?.(msg => { if (busyRef.current) setStatus(msg) })
    return () => { alive.current = false; off?.(); if (busyRef.current) void vd().watchCancel?.() }
  }, [])
  const run = async (): Promise<void> => {
    if (busyRef.current || !vd().watchTimeline) return
    busyRef.current = true; setBusy(true); setResult(null); setStatus('Preparing the cut…')
    try {
      const r = await vd().watchTimeline!({ timelineId: timeline.id, question, range })
      if (alive.current) setResult(r)
    } catch (e) { if (alive.current) setResult({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setStatus('') } }
  }
  return <Modal title={`Watch timeline · ${timeline.name}`} width={640} onClose={onClose}>
    <p>A temporary video of this cut is prepared and sent to your configured reader. Supplier usage may be billed. This reviews the edited video; it does not record playback glitches.</p>
    <label style={{ display: 'block', marginBottom: 10 }}>Watch
      <select aria-label="Watch scope" disabled={busy} value={range} onChange={e => setRange(e.target.value as 'full' | 'selection')} style={{ ...ctl, marginLeft: 8 }}>
        <option value="full">Entire timeline</option>
        <option value="selection" disabled={!hasRange}>Marked in/out range{!hasRange ? ' (not set)' : ''}</option>
      </select>
    </label>
    <label style={{ display: 'block' }}>What should it look for?
      <textarea aria-label="Watch question" disabled={busy} value={question} onChange={e => setQuestion(e.target.value)} rows={3} style={{ ...ctl, width: '100%', marginTop: 6, boxSizing: 'border-box', resize: 'vertical' }} />
    </label>
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button type="button" className="btn" disabled={busy || !vd().watchTimeline} onClick={() => void run()}>Watch cut</button>
      {busy && <button type="button" className="btn vd-hbtn" onClick={() => { setStatus('Cancelling…'); void vd().watchCancel?.() }}>Cancel</button>}
    </div>
    {status && <p role="status">{status}</p>}
    {result && <div style={{ marginTop: 14 }}>
      {!result.ok ? <p role="alert" style={{ color: 'var(--bad)' }}>{result.error}</p> : <>
        <b>{result.via === 'frames' ? 'Still-frame review — no motion or sound' : `Video and audio review · ${result.model ?? 'Gemini'}`}</b>
        {result.warning && <p role="status">{result.warning}</p>}
        <p style={{ color: 'var(--muted)', fontSize: 11 }}>Timeline starts at {(result.startSec ?? 0).toFixed(2)}s · {(result.durationSec ?? 0).toFixed(2)}s reviewed{result.tokens ? ` · ${result.tokens} tokens` : ''}</p>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, userSelect: 'text', overflowWrap: 'anywhere' }}>{result.text}</div>
      </>}
    </div>}
  </Modal>
}
