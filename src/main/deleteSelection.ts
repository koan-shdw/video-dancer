import { randomUUID } from 'crypto'
import type { Project, ProjectDelta, SendSelection } from '@koan/vidancer-ui/shared/types'

// One metadata mutation for mixed Bin/Library selections. The caller saves once, so Undo
// restores the entire selection together. Source files and frozen take recipes stay intact.
export function removeSelectedAssets(p: Project, selection: SendSelection): ProjectDelta {
  const ids = (key: keyof SendSelection): Set<string> => new Set(Array.isArray(selection[key]) ? selection[key]!.filter(id => typeof id === 'string') : [])
  const clips=ids('clipIds'), images=ids('imageIds'), audio=ids('audioIds'), videos=ids('videoIds'), sheets=ids('sheetIds'), scores=ids('scoreIds'), voices=ids('voiceIds'), styles=ids('styleIds'), gens=ids('imageGenIds'), timelines=ids('timelineIds')
  p.clips=p.clips.filter(x=>!clips.has(x.id)); p.images=p.images.filter(x=>!images.has(x.id))
  p.audio=p.audio.filter(x=>!audio.has(x.id)); p.videos=p.videos.filter(x=>!videos.has(x.id))
  p.charSheets=p.charSheets.filter(x=>!sheets.has(x.id)); p.scoreClips=p.scoreClips.filter(x=>!scores.has(x.id))
  p.voiceClips=p.voiceClips.filter(x=>!voices.has(x.id)); p.styles=p.styles.filter(x=>!styles.has(x.id))
  p.imageGens=(p.imageGens??[]).filter(x=>!gens.has(x.id)); p.timelines=p.timelines.filter(x=>!timelines.has(x.id))
  if (!p.timelines.length) p.timelines.push({id:randomUUID(),name:'Timeline 1',aspectRatio:'16:9',items:[]})
  if (!p.timelines.some(x=>x.id===p.activeTimelineId)) p.activeTimelineId=p.timelines[0].id
  for (const c of p.clips) {
    const r=c.promptData
    if (r.imageIds) r.imageIds=r.imageIds.filter(id=>!images.has(id))
    if (r.endImageId && images.has(r.endImageId)) delete r.endImageId
    if (r.audioRefs) r.audioRefs=r.audioRefs.filter(x=>!audio.has(x.audioId??'')&&!voices.has(x.voiceId??''))
    if (r.videoRefs) r.videoRefs=r.videoRefs.filter(x=>!videos.has(x.videoId??''))
  }
  for (const t of p.timelines) {
    t.items=t.items.filter(x=>!clips.has(x.clipId)&&!(x.nestId&&timelines.has(x.nestId))) // a deleted timeline's nest blocks go with it (list 3)
    if (t.audioItems) t.audioItems=t.audioItems.filter(x=>'clipId' in x.source ? !clips.has(x.source.clipId) : 'audioId' in x.source ? !audio.has(x.source.audioId) : !timelines.has(x.source.nestId))
    if (t.scoreItems) t.scoreItems=t.scoreItems.filter(x=>!scores.has(x.scoreClipId))
    if (t.music && audio.has(t.music.audioId)) delete t.music
    t.rev=(t.rev??0)+1
  }
  return {clips:p.clips,images:p.images,audio:p.audio,videos:p.videos,charSheets:p.charSheets,scoreClips:p.scoreClips,voiceClips:p.voiceClips,styles:p.styles,imageGens:p.imageGens,timelines:p.timelines,activeTimelineId:p.activeTimelineId,
    removedClipIds:[...clips],removedImageIds:[...images],removedAudioIds:[...audio],removedVideoIds:[...videos],removedCharSheetIds:[...sheets],removedScoreClipIds:[...scores],removedVoiceClipIds:[...voices],removedStyleIds:[...styles],removedImageGenIds:[...gens],removedTimelineIds:[...timelines]}
}
