// Queue — every paid fal job (generation or edit) lines up here and runs one at a time.
// The running row streams the live fal/api messages; pending rows reorder (↑↓) and cancel;
// pause stops the NEXT job from starting (the running one always finishes — it's already billing).
// Cancel on a running job is best-effort remote cancel: if fal completes it anyway, the take
// still lands (the money was spent either way).
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
  const clearFinishedJobs = useStore((s) => s.clearFinishedJobs)
  const selectClip = useStore((s) => s.selectClip)

  const pending = queue.filter((j) => j.status === 'pending')
  const finished = queue.filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
        <span
          className="btn vd-hbtn"
          onClick={() => {
            setQueuePaused(!paused)
            if (!paused) toast('queue paused — the running job finishes, nothing new starts', { kind: 'info' })
          }}
          title={paused ? 'resume — start the next pending job' : 'pause — let the running job finish, hold the rest'}
        >
          {paused ? '▶ resume' : '⏸ pause'}
        </span>
        {paused && <span style={{ fontSize: 10, color: 'var(--amber)' }}>paused</span>}
        <span style={{ fontSize: 11, color: 'var(--dim)', marginLeft: 'auto' }}>
          {pending.length ? `${pending.length} waiting` : ''}
        </span>
        {finished.length > 0 && (
          <span className="btn vd-hbtn" onClick={clearFinishedJobs} title="remove the done / failed / cancelled rows">
            clear finished
          </span>
        )}
      </div>

      <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 6 }}>
        {queue.length === 0 && (
          <div style={{ color: 'var(--dim)', fontSize: 12, padding: 12, lineHeight: 1.6 }}>
            Nothing queued. Every ▶ Render and ▶ Generate edit lands here and runs in order — queue as many as you
            like and walk away.
          </div>
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
            <Thumbnail file={j.thumb} label="" placeholder={j.kind === 'edit' ? '⑂' : '▦'} w={48} h={30} />
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
                {j.estCost != null && <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>~${j.estCost.toFixed(2)}</span>}
              </div>
              <div style={{ fontSize: 10.5, color: STATUS_COLOR[j.status], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.status === 'running' && <span className="vd-spin">◌ </span>}
                {j.status === 'error' ? j.error : j.msg ?? j.status}
              </div>
            </div>
            {j.status === 'pending' && (
              <>
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
