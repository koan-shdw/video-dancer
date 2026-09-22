import { vd } from '../api'
import { useStore, type MultiKind } from '../store'
import { confirmDialog } from '../prompt'
import { toast } from '../ui/Toast'
import { sendEntryFor } from './sendToProject'
import { disableEntryFor } from './disableEntry' // a cycle by design: both sides only call each other inside functions
import type { MenuEntry } from '@koan/shared'

export const fields = { bin:'clipIds', lib:'imageIds', audio:'audioIds', video:'videoIds', sheet:'sheetIds', score:'scoreIds', voice:'voiceIds', style:'styleIds', imagegen:'imageGenIds', tl:'timelineIds' } as const
export const collections = { bin:'clips', lib:'images', audio:'audio', video:'videos', sheet:'charSheets', score:'scoreClips', voice:'voiceClips', style:'styles', imagegen:'imageGens', tl:'timelines' } as const
export function menuSelection(kind: MultiKind, id: string): { sets: Partial<Record<MultiKind,string[]>>; selection: SendSelection; count: number; mixed: boolean } {
  const s=useStore.getState(), raw=s.multiSel?.sets[kind]?.includes(id) ? s.multiSel.sets : {[kind]:[id]}
  const sets: Partial<Record<MultiKind,string[]>>={}, selection: SendSelection={}
  for (const k of Object.keys(fields) as MultiKind[]) {
    const valid=new Set((s.project?.[collections[k]]??[]).map(x=>x.id))
    const ids=[...new Set(raw[k]??[])].filter(x=>valid.has(x))
    if (ids.length) { sets[k]=ids; selection[fields[k]]=ids }
  }
  return {sets,selection,count:Object.values(sets).reduce((n,ids)=>n+(ids?.length??0),0),mixed:Object.keys(sets).length>1}
}

// Single-item tools (rename, open editor, etc.) never pretend to act on a multi-selection.
export function selectionMenu(kind: MultiKind, id: string, single: MenuEntry[], bulk?: MenuEntry[]): MenuEntry[] {
  const {sets,selection,count,mixed}=menuSelection(kind,id)
  if (count<=1) return single
  const s=useStore.getState(), owner=s.project?.dir
  const duplicates: Partial<Record<MultiKind,(id:string)=>Promise<unknown>>>={bin:s.duplicateClip,lib:s.duplicateImage,score:s.duplicateScoreClip,imagegen:s.duplicateImageGen,tl:s.duplicateTimeline}
  return [
    ...(!mixed && bulk ? bulk.filter(e=>!e.danger) : [sendEntryFor(kind,id)]),
    ...disableEntryFor(kind,id), // ⃠ disable N selected / ✓ enable N selected — the whole cross-card selection (DISABLE-ITEMS-SPEC)
    ...(Object.keys(sets).every(k=>!!duplicates[k as MultiKind]) ? [{label:`duplicate ${count} selected`,onClick:async()=>{
      try { for (const k of Object.keys(sets) as MultiKind[]) for (const selectedId of sets[k]!) { if(useStore.getState().project?.dir!==owner) throw Error('The open project changed.'); await duplicates[k]!(selectedId) } }
      catch(e){toast(e instanceof Error?e.message:String(e),{kind:'error'})}
    }}] : []),
    {label:`delete ${count} selected`,danger:true,disabled:!vd().assetsDelete,onClick:async()=>{
      if(!await confirmDialog(`Delete all ${count} selected items? Their timeline instances and live references are removed. Files stay on disk. Undo restores the whole deletion.`,{confirmLabel:`Delete ${count}`,danger:true}))return
      if(useStore.getState().project?.dir!==owner)return void toast('The open project changed; nothing was deleted.',{kind:'error'})
      try { const delta=await vd().assetsDelete!(selection); if(useStore.getState().project?.dir!==owner)return; useStore.getState().applyDelta(delta); useStore.getState().clearMultiSel() }
      catch(e){toast(e instanceof Error?e.message:String(e),{kind:'error'})}
    }}
  ]
}
