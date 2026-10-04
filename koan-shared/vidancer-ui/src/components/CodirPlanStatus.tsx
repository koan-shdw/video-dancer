import { useStore } from '../store'
import { vd } from '../api'

export function CodirPlanStatus({ showDetails = true }: { showDetails?: boolean }): JSX.Element | null {
  const state = useStore(s => s.codirJobs)
  const p = state?.plan
  if (!p) return null
  const jobs = state.jobs.filter(j => j.planId === p.id)
  const finished = jobs.filter(j => j.status === 'done').length
  const running = ['active', 'waiting', 'blocked'].includes(p.status)
  return <div style={{ padding: '6px 8px', fontSize: 11, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <strong>Co-Di plan: {p.status}</strong>
      <span>{finished}/{jobs.length} jobs done</span>
      {running && <button className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void vd().codirStopPlan?.()}>stop plan</button>}
    </div>
    {p.reason && <p role="status" style={{ color: 'var(--bad)', margin: '4px 0' }}>{p.reason}</p>}
    {showDetails && <details open={p.status === 'draft'}>
      <summary>{p.status === 'draft' ? 'Review the plan, then send GO' : 'Plan, progress and results'}</summary>
      <div style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', paddingTop: 6 }}>
        <div>{p.text}</div>
        <p>Scope: this project. Up to {p.maxExchanges} continuation exchanges using {p.aiRoute}. {p.aiCost}</p>
        {p.renders.map(r => <p key={r.kind + r.engine}>{r.kind} · {r.engine} · up to {r.maxJobs} calls including retries · {r.cost}<br />{JSON.stringify(r.settings)}</p>)}
        <p>App tools: {p.tools.join(', ')}</p>
        {p.progress && <p>{p.progress}</p>}
        {jobs.map(j => <div key={j.id} style={{ margin: '4px 0' }}>{j.label} · {j.engine} · {j.status}{j.late ? ' (late result kept)' : ''}{j.error ? `: ${j.error}` : ''}
          {j.outputs.map(o => <div key={o.file} style={{ overflowWrap: 'anywhere', color: 'var(--dim)' }}>{o.file}</div>)}
        </div>)}
      </div>
    </details>}
  </div>
}
