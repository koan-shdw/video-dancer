import { useStore } from '../store'
import { MIME_IMAGE, MIME_GENTAKE } from './dragDrop'

export function acceptsImageGenReference(types: readonly string[]): boolean {
  return types.includes(MIME_IMAGE) || types.includes(MIME_GENTAKE)
}

export async function dropImageGenReference(targetId: string, slot: 'refA'|'refB', data: Pick<DataTransfer,'getData'>): Promise<boolean> {
  const st=useStore.getState(), owner=st.project?.dir
  if(!owner || !st.project?.imageGens?.some(g=>g.id===targetId))return false
  let imageId: string|null|undefined
  const take=data.getData(MIME_GENTAKE)
  if(take){
    let ref: {imageGenId?:string;takeId?:string}
    try{ref=JSON.parse(take)}catch{throw Error('This image take could not be read.')}
    if(typeof ref?.imageGenId!=='string'||typeof ref.takeId!=='string')throw Error('This image take could not be read.')
    if(!st.project.imageGens.some(g=>g.id===ref.imageGenId&&g.takes.some(t=>t.id===ref.takeId)))throw Error('That image take is no longer available.')
    imageId=await st.imageGenToLibrary(ref.imageGenId,ref.takeId)
  }else{
    const file=data.getData(MIME_IMAGE)
    imageId=st.project.images.find(i=>i.file===file)?.id
  }
  const now=useStore.getState()
  if(now.project?.dir!==owner)throw Error('The project changed; the reference was not assigned.')
  if(!imageId || !now.project?.imageGens?.some(g=>g.id===targetId))return false
  await now.saveImageGen(targetId,{recipe:{[slot]:imageId}})
  return true
}
