import type { Project, TimelineItem } from '../shared/types'
import { dissolveAt, transitionSource, transitionUnderlays, type Dissolve } from '../shared/transitions'
import { resolveView, effDur, startOf, sourceTimeAt } from '../lib/timelineUtils'
import { mediaUrl } from '../media'
import { prepareVideoFrame } from '../lib/prepareVideoFrame'
import { createFxChain } from './core/chain'
import { readFx2 } from './fxData'
import { sidecarsOf } from './fxUtils'
import { getEffect } from './core/registry'
import type { FxLayerInput } from './core/types'

export function createTransitionPreview(canvas:HTMLCanvasElement,project:Project,plans:Dissolve[]) {
  const chain=createFxChain(canvas)
  const pool=new Map<string,{video:HTMLVideoElement;url:string;pending:boolean;cancel:()=>void}>()
  const sidecars=new Map<string,{matte?:string;depth?:string}>()
  let shown:string|null=null,disposed=false
  const sync=(key:string,file:string,time:number,playing:boolean,speed:number):HTMLVideoElement|null=>{
    let slot=pool.get(key)
    const url=mediaUrl(file)
    if(!slot){
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto'
      Object.assign(video.style,{position:'absolute',width:'1px',height:'1px',opacity:'0',pointerEvents:'none'})
      canvas.parentElement?.appendChild(video)
      slot={video,url:'',pending:false,cancel:()=>{}};pool.set(key,slot)
    }
    const v=slot.video
    if(slot.url!==url){
      slot.cancel();slot.url=url;slot.pending=true
      const current=slot
      slot.cancel=prepareVideoFrame(v,{url,target:time,sourceChanged:true,gate:true,onReady:()=>{current.pending=false},onError:()=>{current.pending=false}})
    }
    if(slot.pending)return null
    v.playbackRate=speed
    if(!v.seeking && Math.abs(v.currentTime-time)>(playing?.08:.001))try{v.currentTime=time}catch{}
    if(playing){if(v.paused)void v.play().catch(()=>{})}else if(!v.paused)v.pause()
    return v.readyState>=2&&!v.seeking?v:null
  }
  return {
    draw(T:number,playing:boolean):boolean {
      const current=dissolveAt(plans,T)
      const plan=current??plans.find(p=>p.start>T&&p.start-T<2)
      if(!plan){canvas.style.visibility='hidden';for(const slot of pool.values())slot.video.pause();shown=null;return false}
      const at=current?T:plan.start
      const layers:FxLayerInput[]=[]
      let readySources=0
      const tl=project.timelines?.find(t=>t.items.some(it=>it.id===plan.outgoing.id))
      if(tl)for(const [index,item] of transitionUnderlays(project,tl,plan,at).entries()){
        const clip=project.clips.find(c=>c.id===item.clipId),take=clip?resolveView(clip,item).take:undefined
        if(!take)continue
        const video=sync(`under-${index}`,take.file,sourceTimeAt(item,project.clips,at),!!current&&playing,item.speed&&item.speed>0?item.speed:1)
        if(video)layers.push({video,fx:readFx2(item)??undefined,fade:1,progress:Math.max(0,Math.min(1,(at-startOf(item))/effDur(item,project.clips))),time:at,flatDepth:.5})
      }
      const weight=Math.max(0,Math.min(1,(at-plan.start)/(plan.end-plan.start)))
      for(const [index,item] of [plan.incoming,plan.outgoing].entries()){
        const clip=project.clips.find(c=>c.id===item.clipId)!,take=resolveView(clip,item).take!
        const source=transitionSource(project,plan,item,at)
        const running=!!current&&playing&&source.raw>=0&&source.raw<source.duration-1/24
        const video=sync(`clip-${index}`,take.file,source.time,running,item.speed&&item.speed>0?item.speed:1)
        if(!video)continue
        readySources++
        const fx=readFx2(item)
        const needs=fx?.stack.reduce((n,e)=>({matte:n.matte||!!getEffect(e.type)?.needs?.matte,depth:n.depth||!!getEffect(e.type)?.needs?.depth}),{matte:false,depth:false})
        if(needs?.matte||needs?.depth){if(!sidecars.has(take.file)){sidecars.set(take.file,{});void sidecarsOf(take.file).then(s=>{if(!disposed)sidecars.set(take.file,s)})}}
        const sc=sidecars.get(take.file)
        const matte=needs?.matte&&sc?.matte?sync(`matte-${index}`,sc.matte,source.time,running,video.playbackRate):null
        const depth=needs?.depth&&sc?.depth?sync(`depth-${index}`,sc.depth,source.time,running,video.playbackRate):null
        layers.push({video,fx:fx??undefined,matte,depth,fade:index===0?1:1-weight,progress:Math.max(0,Math.min(1,(at-startOf(item))/effDur(item,project.clips))),time:at,flatDepth:.5})
      }
      if(!current){canvas.style.visibility='hidden';shown=null;return false}
      if(readySources!==2){if(shown!==plan.outgoing.id)canvas.style.visibility='hidden';return shown===plan.outgoing.id}
      const W=Math.max(2,Math.round(canvas.clientWidth)),H=Math.max(2,Math.round(canvas.clientHeight))
      if(chain.canvasW()!==W||chain.canvasH()!==H)chain.resize(W,H)
      chain.render(layers);canvas.style.visibility='visible';shown=plan.outgoing.id;return true
    },
    dispose():void{disposed=true;for(const slot of pool.values()){slot.cancel();slot.video.pause();slot.video.removeAttribute('src');slot.video.load();slot.video.remove()}pool.clear();chain.destroy();canvas.style.visibility='hidden'}
  }
}
