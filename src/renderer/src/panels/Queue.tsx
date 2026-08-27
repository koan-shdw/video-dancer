import { EmptyState } from '../ui/EmptyState'
// Queue — every paid job lands here, in one of two lanes (spec: CONCURRENT-RENDERS-2026-08-11):
// ＋ Queue rows run one at a time in order; ▶ Render now rows run immediately, several at once
// (capped per provider). Running rows stream the live fal/api messages; pending rows reorder
// (↑↓) and cancel; pause stops the NEXT queue-lane job from starting (running jobs always
// finish — they're already billing). Cancel on a running job is best-effort remote cancel: if
// the provider completes it anyway, the take still lands (the money was spent either way).
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { toast } from '../ui/Toast'

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--muted)',
  running: 'var(--amber)',
  done: 'var(--ok)',
  error: 'var(--bad)',
  cancelled: 'var(--dim)'
}

export function QueuePanel(): React.JSX.Element {
  const queue = useStore((s) => s.queue)
  const paused = useStore((s) => s.queuePaused)
  const setQueuePaused = useStore((s) => s.setQueuePaused)
  const cancelJob = useStore((s) => s.cancelJob)
  const moveJob = useStore((s) => s.moveJob)
  const promoteJob = useStore((s) => s.promoteJob)
  const clearFinishedJobs = useStore((s) => s.clearFinishedJobs)
  const selectClip = useStore((s) => s.selectClip)

  const pending = queue.filter((j) => j.status === 'pending')
  const finished = queue.filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')
  const running = queue.filter((j) => j.status === 'running') // several possible — the now lane runs alongside

  // the ETA bars need a clock — tick once a second, only while something runs
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running.length) return
    const iv = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(iv)
  }, [running.length])

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span
          className="btn vd-hbtn"
          onClick={() => {
            setQueuePaused(!paused)
            if (!paused) toast('queue paused — running jobs finish, nothing new starts from the queue', { kind: 'info' })
          }}
          title={paused ? 'resume — start the next pending queue job' : 'pause — hold the queue lane (running jobs and ▶ Render now always finish)'}
        >
          {paused ? '▶ resume' : '⏸ pause'}
        </span>
        {paused && <span style={{ fontSize: 10, color: 'var(--amber)' }}>paused</span>}
        <span style={{ fontSize: 11, color: 'var(--dim)', marginLeft: 'auto' }}>
          {[running.length ? `${running.length} running` : '', pending.length ? `${pending.length} waiting` : ''].filter(Boolean).join(' · ')}
        </span>
        {finished.length > 0 && (
          <span className="btn vd-hbtn" onClick={clearFinishedJobs} title="remove the done / failed / cancelled rows">
            clear finished
          </span>
        )}
      </div>

      <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 6 }}>
        {queue.length === 0 && (
          <EmptyState bare>
            Nothing here yet. ▶ Render now starts immediately (several can run at once) — ＋ Queue lines them up
            to run one at a time, in order. Every paid job lands here either way; queue as many as you like and
            walk away.
          </EmptyState>
        )}
        {queue.map((j) => (
          <div
            key={j.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 6,
              marginBottom: 4,
              borderRadius: 6,
              background: j.status === 'running' ? 'color-mix(in srgb, var(--amber) 8%, var(--raised))' : 'var(--raised)',
              border: `1px solid ${j.status === 'running' ? 'var(--amber-dim)' : 'var(--line)'}`,
              opacity: j.status === 'cancelled' ? 0.55 : 1
            }}
          >
            <Thumbnail file={j.thumb} videoFile={j.thumbVideo} videoSeek={j.thumbSeek} label="" placeholder={j.kind === 'edit' ? '⑂' : '▦'} w={48} h={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  style={{ fontSize: 12, color: 'var(--txt-hi)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: j.resultClipId ? 'pointer' : undefined }}
                  onClick={() => j.resultClipId && selectClip(j.resultClipId)}
                  title={j.resultClipId ? 'select this clip in the Bin' : undefined}
                >
                  {j.kind === 'edit' ? '⑂ ' : ''}
                  {j.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{j.engineLabel}</span>
                {j.lane === 'now' && (
                  <span
                    style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--amber)', border: '1px solid var(--amber-dim)', borderRadius: 3, padding: '0 3px' }}
                    title="▶ Render now — runs alongside the queue"
                  >
                    now
                  </span>
                )}
                {j.estCost != null && <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>~${j.estCost.toFixed(2)}</span>}
              </div>
              <div style={{ fontSize: 10.5, color: STATUS_COLOR[j.status], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' }}>
                {j.status === 'running' && <span className="vd-spin">◌ </span>}
                {j.status === 'error' ? j.error : j.msg ?? j.status}
                {j.status === 'running' && j.pct == null && j.etaSec == null && <span style={{ color: 'var(--dim)' }}> · the bar learns from this first run</span>}
                {j.status === 'running' && j.etaSec != null && j.startedAt != null && (
                  <span style={{ color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                    {' '}
                    · ~{Math.max(0, j.etaSec - Math.round((now - j.startedAt) / 1000))}s left
                  </span>
                )}
              </div>
              {j.status === 'running' && j.startedAt != null && (
                // bar precedence (bible 12.6): REAL engine pct (the sampler's own step counter)
                // beats the honest time estimate beats indeterminate motion — never a fake fill
                j.pct != null ? (
                  <div style={{ height: 3, background: 'var(--bg0)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, j.pct * 100))}%`, background: 'var(--amber)', borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                ) : j.etaSec != null ? (
                  // an HONEST estimate bar: fills toward this machine's average for similar jobs and
                  // parks at 92% until fal actually says done. No history yet = no bar, phases only.
                  <div style={{ height: 3, background: 'var(--bg0)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(92, ((now - j.startedAt) / 1000 / Math.max(1, j.etaSec)) * 100)}%`,
                        background: 'var(--amber)',
                        borderRadius: 2,
                        transition: 'width .9s linear'
                      }}
                    />
                  </div>
                ) : (
                  // no history yet — honest MOTION without a fake number, labeled so people
                  // know the real bar arrives once this run teaches it the timing
                  <div className="vd-indet" title="first run of this kind — the bar learns its timing from this render" />
                )
              )}
            </div>
            {j.status === 'pending' && j.lane !== 'now' && (
              <>
                <span className="btn vd-hbtn" style={{ color: 'var(--amber)' }} onClick={() => promoteJob(j.id)} title="run now — starts immediately alongside the queue">▶</span>
                <span className="btn vd-hbtn" onClick={() => moveJob(j.id, -1)} title="run sooner">↑</span>
                <span className="btn vd-hbtn" onClick={() => moveJob(j.id, 1)} title="run later">↓</span>
              </>
            )}
            <span
              className="btn vd-hbtn"
              style={{ color: j.status === 'pending' || j.status === 'running' ? 'var(--bad)' : undefined }}
              onClick={() => cancelJob(j.id)}
              title={
                j.status === 'running'
                  ? 'cancel (best effort — if fal already finished it, the take still lands and the cost stands)'
                  : j.status === 'pending'
                    ? 'cancel this job'
                    : 'remove this row'
              }
            >
              ✕
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
