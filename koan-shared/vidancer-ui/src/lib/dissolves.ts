import type { Project, Timeline, TimelineItem } from '../shared/types'
import { extentOf, startOf, itemAt, resolveView, audioEndOf } from './timelineUtils'
import { hiddenVideoTracks } from '../fx/fxUtils'

export function dissolveTargets(project: Project, tl: Timeline, ids: string[]): {item:TimelineItem;name:string;max:number;reason?:string}[] {
  const hidden=hiddenVideoTracks(tl), musicEnd=audioEndOf(tl,project.audio??[])
  return [...new Set(ids)].flatMap(id=>{
    const item=tl.items.find(x=>x.id===id)
    if(!item)return []
    const clip=project.clips.find(c=>c.id===item.clipId), end=extentOf(item,tl.items,project.clips,musicEnd)
    const incoming=itemAt(tl.items,project.clips,end+0.0001,hidden,musicEnd)
    const nextClip=project.clips.find(c=>c.id===incoming?.clipId)
    const reason=(tl.lockedTracks??[]).includes(`v${item.track??0}`)?'Track is locked':item.disabled||hidden.has(item.track??0)?'Clip is hidden':
      !clip||!resolveView(clip,item).take?'Render or choose a take first':
      !incoming||incoming.id===id||!nextClip||!resolveView(nextClip,incoming).take?'No rendered clip immediately after this cut':
      itemAt(tl.items,project.clips,end-0.0001,hidden,musicEnd)?.id!==id?'Another track covers this cut':undefined
    return [{item,name:clip?.name??'Clip',max:Math.max(0,end-startOf(item)),reason}]
  })
}

export function applyDissolves(project: Project, tl: Timeline, ids: string[], seconds: number|null): {items:TimelineItem[];changed:number} {
  if(seconds!==null&&(!Number.isFinite(seconds)||seconds<=0))throw Error('Enter a duration greater than zero.')
  const targets=new Map(dissolveTargets(project,tl,ids).map(t=>[t.item.id,t]))
  let changed=0
  const items=tl.items.map(item=>{
    const t=targets.get(item.id)
    if(!t||(tl.lockedTracks??[]).includes(`v${item.track??0}`))return item
    if(seconds===null){if(!item.transitionOutSec)return item;changed++;return {...item,transitionOutSec:undefined}}
    if(t.reason||t.max<=0)return item
    const length=Math.min(seconds,t.max)
    if(item.transitionOutSec===length)return item
    changed++;return {...item,transitionOutSec:length}
  })
  return {items,changed}
}
