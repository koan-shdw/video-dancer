import { useEffect, useRef, useState } from 'react'
import type { Project, Timeline } from '../shared/types'
import { dissolvePlans } from '../shared/transitions'
import { dissolveTargets } from '../lib/dissolves'
import { useStore } from '../store'
import { toast } from '../ui/Toast'

// A separate row overlay keeps the transition above both clips, so its right
// handle remains reachable across the cut without stealing either clip's trim.
export function TimelineTransitions({ project, timeline, track, total, onEdit }: { project:Project; timeline:Timeline; track:number; total:number; onEdit:(id:string)=>void }):React.JSX.Element {
  const [draft,setDraft]=useState<{id:string;start:number;end:number}|null>(null)
  const [selected,setSelected]=useState<string|null>(null)
  const cleanup=useRef<()=>void>(()=>{})
  useEffect(()=>()=>cleanup.current(),[])
  const locked=(timeline.lockedTracks??[]).includes(`v${track}`)
  const plans=dissolvePlans(project,timeline)
  const fps=Number(timeline.exportFps)||24
  const save=async(id:string,start:number,end:number,cut:number):Promise<void>=>{
    const state=useStore.getState(),p=state.project,tl=p?.timelines.find(t=>t.id===timeline.id)
    if(!p||p.dir!==project.dir||!tl||(tl.lockedTracks??[]).includes(`v${track}`))return
    const duration=Math.max(0,end-start)
    try{await state.setTimelineItems(tl.items.map(it=>it.id===id?{...it,transitionOutSec:duration>=1/fps?duration:undefined,transitionAlignment:duration>=1/fps?(end-cut)/duration:undefined}:it),tl.id)}
    catch(e){toast(e instanceof Error?e.message:String(e),{kind:'error'})}
  }
  const drag=(e:React.MouseEvent,id:string,cut:number,start:number,end:number,edge:'start'|'end'|'create',minimum:number,maximum:number):void=>{
    if(e.button!==0||locked)return
    e.preventDefault();e.stopPropagation();cleanup.current();setSelected(id)
    const row=e.currentTarget.closest('[data-transition-row]')!.getBoundingClientRect()
    const scale=total/Math.max(1,row.width),x=e.clientX
    let current={id,start,end},moved=false
    const move=(ev:MouseEvent):void=>{
      const delta=(ev.clientX-x)*scale
      moved ||= Math.abs(ev.clientX-x)>2
      if(!moved)return
      const at=Math.round(((edge==='start'?start:end)+delta)*fps)/fps
      current=edge==='create'?{id,start:Math.max(minimum,cut-Math.abs(Math.round(delta*fps)/fps)),end:Math.min(maximum,cut+Math.abs(Math.round(delta*fps)/fps))}:{id,start:edge==='start'?Math.max(minimum,Math.min(cut,at)):start,end:edge==='end'?Math.min(maximum,Math.max(cut,at)):end}
      setDraft(current)
    }
    const clear=():void=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);setDraft(null)}
    const cancel=():void=>clear()
    const up=():void=>{clear();if(moved)void save(id,current.start,current.end,cut)}
    const key=(ev:KeyboardEvent):void=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();cancel()}}
    cleanup.current=clear
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);window.addEventListener('keydown',key);window.addEventListener('blur',cancel)
  }
  const candidates=dissolveTargets(project,timeline,timeline.items.filter(it=>(it.track??0)===track).map(it=>it.id))
  return <div data-transition-row style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:12}}>
    {candidates.filter(t=>!t.reason||(t.reason==='Track is locked'&&plans.some(p=>p.outgoing.id===t.item.id))).map(t=>{
      const existing=plans.find(p=>p.outgoing.id===t.item.id)
      const test=existing??dissolvePlans(project,{...timeline,items:timeline.items.map(it=>it.id===t.item.id?{...it,transitionOutSec:Math.min(.5,t.max),transitionAlignment:.5}:it)}).find(p=>p.outgoing.id===t.item.id)
      if(!test)return null
      const cut=test.cut,live=draft?.id===t.item.id?draft:existing
      const sameTrack=plans.filter(p=>(p.outgoing.track??0)===track&&p.outgoing.id!==t.item.id)
      const minimum=Math.max(t.item.startSec??0,...sameTrack.filter(p=>p.cut<cut).map(p=>p.end))
      const incomingEnd=(test.incoming.startSec??0)+t.incomingDuration
      const maximum=Math.min(incomingEnd,...sameTrack.filter(p=>p.cut>cut).map(p=>p.start))
      if(!live)return <button key={t.item.id} aria-label={`Add cross dissolve after ${t.name}`} title="Drag to create a centered cross-dissolve · double-click for duration" disabled={locked} onMouseDown={e=>drag(e,t.item.id,cut,cut,cut,'create',minimum,maximum)} onDoubleClick={()=>onEdit(t.item.id)} style={{position:'absolute',left:`${cut/total*100}%`,top:2,transform:'translateX(-50%)',width:12,height:12,padding:0,border:'1px solid var(--amber)',borderRadius:2,background:'var(--bg2)',color:'var(--amber)',fontSize:9,lineHeight:'10px',pointerEvents:'auto',cursor:locked?'default':'ew-resize'}}>◩</button>
      const duration=live.end-live.start,active=selected===t.item.id||draft?.id===t.item.id
      const warning=dissolvePlans(project,{...timeline,items:timeline.items.map(it=>it.id===t.item.id?{...it,transitionOutSec:duration,transitionAlignment:duration?(live.end-cut)/duration:0}:it)}).find(p=>p.outgoing.id===t.item.id)?.repeated
      return <div key={t.item.id} tabIndex={0} role="group" aria-label={`Cross dissolve ${t.name}`} onFocus={()=>setSelected(t.item.id)} onMouseDown={e=>{e.stopPropagation();setSelected(t.item.id);e.currentTarget.focus()}} onDoubleClick={e=>{e.stopPropagation();onEdit(t.item.id)}} onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();void save(t.item.id,cut,cut,cut)}}} title={`Cross Dissolve · ${duration.toFixed(2)}s · ${Math.round(duration*fps)} frames${warning?' · Insufficient media: edge frames repeat':''} · drag either edge · Delete removes transition`} style={{position:'absolute',left:`${live.start/total*100}%`,width:`${duration/total*100}%`,minWidth:3,top:2,height:22,boxSizing:'border-box',border:`1px solid ${active?'#fff':'#d3b68b'}`,borderRadius:2,background:warning?'repeating-linear-gradient(135deg,#705932 0px,#705932 5px,#342e26 5px,#342e26 8px)':'#665235',color:'#fff4da',pointerEvents:'auto',outline:'none',boxShadow:active?'0 0 0 1px #151515':undefined,overflow:'visible'}}>
        <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 20" style={{position:'absolute',inset:0,pointerEvents:'none',opacity:.5}}><path d="M0 20L100 0M0 0L100 20" stroke="#ffe4b1" fill="none"/></svg>
        <span style={{position:'absolute',left:`${duration?(cut-live.start)/duration*100:0}%`,top:0,bottom:0,borderLeft:'1px solid #fff',pointerEvents:'none'}}/>
        <span style={{display:'block',overflow:'hidden',whiteSpace:'nowrap',fontSize:10,lineHeight:'20px',padding:'0 7px',position:'relative',pointerEvents:'none'}}>Cross Dissolve</span>
        {(['start','end'] as const).map(edge=><span key={edge} role="slider" tabIndex={locked?-1:0} aria-label={`Dissolve ${edge} handle`} aria-valuenow={duration} aria-valuemin={0} aria-valuemax={maximum-minimum} onMouseDown={e=>drag(e,t.item.id,cut,live.start,live.end,edge,minimum,maximum)} onKeyDown={e=>{if(locked||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const delta=(e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1)/fps;void save(t.item.id,edge==='start'?Math.max(minimum,Math.min(cut,live.start+delta)):live.start,edge==='end'?Math.min(maximum,Math.max(cut,live.end+delta)):live.end,cut)}} style={{position:'absolute',[edge==='start'?'left':'right']:-3,top:-1,bottom:-1,width:7,background:active?'#ffcf72':'#ceb078',border:'1px solid #382e1e',boxSizing:'border-box',cursor:locked?'default':'ew-resize'}}/>) }
        {draft?.id===t.item.id&&<span style={{position:'absolute',top:-24,left:0,whiteSpace:'nowrap',background:'#181818',border:'1px solid var(--amber)',borderRadius:3,padding:'2px 5px',fontSize:11,pointerEvents:'none'}}>{duration.toFixed(2)}s · {Math.round(duration*fps)} frames{warning?' · repeated frames':''}</span>}
      </div>
    })}
  </div>
}
