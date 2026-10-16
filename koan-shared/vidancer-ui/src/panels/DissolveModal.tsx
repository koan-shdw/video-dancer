import { useState } from 'react'
import type { Project, Timeline } from '../shared/types'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { ctl } from '../ui/controls'
import { dissolveTargets, applyDissolves } from '../lib/dissolves'

export function DissolveModal({project,timeline,itemIds,onClose}:{project:Project;timeline:Timeline;itemIds:string[];onClose:()=>void}):React.JSX.Element {
  const targets=dissolveTargets(project,timeline,itemIds)
  const [seconds,setSeconds]=useState(String(targets.find(t=>t.item.transitionOutSec)?.item.transitionOutSec??0.5))
  const [alignment,setAlignment]=useState(targets.find(t=>t.item.transitionOutSec)?.item.transitionAlignment??(targets.some(t=>t.item.transitionOutSec)?0:0.5))
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const eligible=targets.filter(t=>!t.reason).length
  const run=async(value:number|null):Promise<void>=>{
    setError('');setBusy(true)
    try{
      const st=useStore.getState(),p=st.project,tl=p?.timelines.find(t=>t.id===timeline.id)
      if(!p||p.dir!==project.dir||!tl)throw Error('The project or timeline changed.')
      const result=applyDissolves(p,tl,itemIds,value,alignment)
      if(!result.changed){setError('No eligible transitions changed.');return}
      await st.setTimelineItems(result.items,tl.id)
      onClose()
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <Modal title="Cross-dissolve" width={460} onClose={onClose}>
    <p>Blend moving footage from both sides of the cut. Trim clips to leave extra footage for the overlap; when handles run out, edge frames repeat. Clip positions and audio stay in place.</p>
    <label>Alignment <select aria-label="Dissolve alignment" value={alignment} onChange={e=>setAlignment(Number(e.target.value))} style={ctl}><option value={0.5}>Center at cut</option><option value={0}>End at cut</option><option value={1}>Start at cut</option></select></label>
    <label>Duration (seconds) <input aria-label="Dissolve duration" type="number" min="0.01" step="0.05" value={seconds} onChange={e=>setSeconds(e.target.value)} style={{...ctl,width:78,marginLeft:8}} disabled={busy}/></label>
    <div style={{display:'flex',gap:6,marginTop:10}}>{[0.25,0.5,1,2].map(n=><button type="button" className="btn vd-hbtn" key={n} disabled={busy} onClick={()=>setSeconds(String(n))}>{n}s</button>)}</div>
    <p style={{color:'var(--muted)'}}>{eligible} of {targets.length} selected clips can dissolve. Short clips limit the duration to their length.</p>
    {targets.filter(t=>t.reason).map(t=><p key={t.item.id} style={{fontSize:11,color:'var(--muted)'}}>{t.name}: {t.reason}.</p>)}
    {error&&<p role="alert" style={{color:'var(--bad)'}}>{error}</p>}
    <div style={{display:'flex',gap:8,marginTop:14}}>
      <button type="button" className="btn" disabled={busy||!eligible||!Number.isFinite(Number(seconds))||Number(seconds)<=0} onClick={()=>void run(Number(seconds))}>Apply dissolve{eligible>1?'s':''}</button>
      <button type="button" className="btn vd-hbtn" disabled={busy||!targets.some(t=>t.item.transitionOutSec)} onClick={()=>void run(null)}>Remove dissolves</button>
    </div>
  </Modal>
}
