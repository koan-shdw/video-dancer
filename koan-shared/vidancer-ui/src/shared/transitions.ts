import type { Project, Timeline, TimelineItem } from './types'
import { audioEndOf, effDur, extentOf, itemAt, resolveView, startOf } from '../lib/timelineUtils'

export interface Dissolve {
  outgoing: TimelineItem
  incoming: TimelineItem
  cut: number
  start: number
  end: number
  repeated: boolean
  covered?: {start:number;end:number}[]
}

// One timing rule for the timeline, preview and export. The optional alignment
// preserves old end-at-cut transitions; newly authored ones default to centered.
export function dissolvePlans(project: Project, tl: Timeline): Dissolve[] {
  const hidden = new Set<number>()
  const solo = (tl.soloTracks ?? []).filter(t => t.startsWith('v'))
  for (const x of tl.items) if (solo.length ? !solo.includes(`v${x.track ?? 0}`) : (tl.mutedTracks ?? []).includes(`v${x.track ?? 0}`)) hidden.add(x.track ?? 0)
  const musicEnd = audioEndOf(tl, project.audio ?? [])
  const plans: Dissolve[] = []
  for (const outgoing of tl.items) {
    const duration = outgoing.transitionOutSec ?? 0
    if (!Number.isFinite(duration) || duration <= 0 || outgoing.disabled || hidden.has(outgoing.track ?? 0)) continue
    const cut = extentOf(outgoing, tl.items, project.clips, musicEnd)
    const incoming = itemAt(tl.items, project.clips, cut + 0.00001, hidden, musicEnd)
    if (!incoming || incoming.id === outgoing.id || itemAt(tl.items, project.clips, cut - 0.00001, hidden, musicEnd)?.id !== outgoing.id) continue
    if (![outgoing, incoming].every(it => { const c = project.clips.find(c => c.id === it.clipId); return c && resolveView(c, it).take?.file })) continue
    const after = Math.max(0, Math.min(1, outgoing.transitionAlignment ?? 0))
    const start = Math.max(startOf(outgoing), cut - duration * (1 - after))
    const end = Math.min(extentOf(incoming, tl.items, project.clips, musicEnd), cut + duration * after)
    if (end - start < 0.001) continue
    const plan: Dissolve = { outgoing, incoming, cut, start, end, repeated: false }
    plan.repeated = [outgoing,incoming].some(it => transitionSource(project,plan,it,start).repeated || transitionSource(project,plan,it,end-0.00001).repeated)
    const edges=[...new Set([start,end,...tl.items.flatMap(it=>[startOf(it),extentOf(it,tl.items,project.clips,musicEnd)]).filter(t=>t>start&&t<end)])].sort((a,b)=>a-b)
    plan.covered=[]
    for(let i=0;i<edges.length-1;i++){
      const visible=itemAt(tl.items,project.clips,(edges[i]+edges[i+1])/2,hidden,musicEnd)
      if(visible?.id!==outgoing.id&&visible?.id!==incoming.id)plan.covered.push({start:edges[i],end:edges[i+1]})
    }
    plans.push(plan)
  }
  return plans.sort((a,b)=>a.start-b.start)
}

export function dissolveAt(plans: Dissolve[], time: number): Dissolve | undefined {
  return plans.find(p => time >= p.start && time < p.end && !p.covered?.some(w=>time>=w.start&&time<w.end))
}

export function transitionUnderlays(project:Project,tl:Timeline,plan:Dissolve,time:number):TimelineItem[] {
  const track=Math.min(plan.outgoing.track??0,plan.incoming.track??0)
  const solos=(tl.soloTracks??[]).filter(t=>t.startsWith('v'))
  const musicEnd=audioEndOf(tl,project.audio??[])
  return tl.items.filter(it=>!it.disabled&&(it.track??0)<track&&!(solos.length?!solos.includes(`v${it.track??0}`):(tl.mutedTracks??[]).includes(`v${it.track??0}`))&&startOf(it)<=time&&time<extentOf(it,tl.items,project.clips,musicEnd)).sort((a,b)=>(a.track??0)-(b.track??0)).slice(-2)
}

export function transitionSource(project: Project, plan: Dissolve, item: TimelineItem, time: number, fps = 24): {time:number;raw:number;duration:number;repeated:boolean} {
  const clip = project.clips.find(c => c.id === item.clipId)!
  const view = resolveView(clip,item), speed = item.speed && item.speed > 0 ? item.speed : 1
  let offset = time - startOf(item)
  if (item.loop) {
    const cycle = effDur(item,project.clips)
    // Use the final loop's source handle after the cut, rather than wrapping
    // the outgoing picture back to its first frame halfway through a dissolve.
    const reference = item.id === plan.outgoing.id ? Math.min(time,plan.cut-0.000001) : Math.max(time,startOf(item))
    offset -= Math.max(0,Math.floor((reference-startOf(item))/cycle))*cycle
  }
  const raw = (item.inSec ?? 0) + offset*speed
  const last = Math.max(0,view.durationSec-1/fps)
  return {raw,time:Math.max(0,Math.min(last,raw)),duration:view.durationSec,repeated:raw < -0.00001 || raw > view.durationSec+0.00001}
}
