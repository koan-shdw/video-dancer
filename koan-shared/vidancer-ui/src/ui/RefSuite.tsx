// The re-gen REF SUITE — Clip Gen slot grammar (drag in / + add pickers / yellow = not
// @mentioned), extracted from Video Editor so every v2v surface runs ONE implementation (law 3).
// Three strips: image refs (@refs), extra video refs (@video2… when the source rides as @video1),
// audio refs (@audio1…, 15s window clamps). Parked (visible, greyed, not sent) when the active
// engine takes no refs — law 4: parked fields never vanish, they grey with a reason.
import { useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { openLibraryPanel } from '../panelBus'
import { Thumbnail } from '../Thumbnail'
import { ctl } from './controls'
import { MIME_IMAGE, MIME_VIDEO, MIME_TAKE, MIME_AUDIO } from '../lib/dragDrop'
import { Ic, Film, Music } from './icons'
import type { ModelDescriptor } from '../shared/models'

// seconds a video ref will send — its window when set, else the source's natural length.
// Exported: the owners' validation blocks (videos ≤15s combined etc.) need the same math.
export const vrefSecOf = (project: Project | null | undefined, r: VideoRef): number | undefined => {
  if (r.inSec != null && r.outSec != null && r.outSec > r.inSec) return r.outSec - r.inSec
  if (r.videoId) return project?.videos.find((v) => v.id === r.videoId)?.durationSec
  const c = project?.clips.find((x) => x.id === r.takeRef?.clipId)
  return c?.takes.find((t) => t.id === r.takeRef?.takeId)?.durationSec
}
export const vrefNameOf = (project: Project | null | undefined, r: VideoRef): { name: string; file?: string; natSec?: number } => {
  if (r.videoId) {
    const v = project?.videos.find((x) => x.id === r.videoId)
    return { name: v?.title ?? '(deleted video)', file: v?.file, natSec: v?.durationSec }
  }
  const c = project?.clips.find((x) => x.id === r.takeRef?.clipId)
  const t = c?.takes.find((x) => x.id === r.takeRef?.takeId)
  const tn = c && t ? c.takes.findIndex((x) => x.id === t.id) + 1 : 0
  return { name: c && t ? `${c.name} · T${tn}` : '(deleted take)', file: t?.file, natSec: t?.durationSec }
}

interface RefSuiteProps {
  model: ModelDescriptor // caps: maxRefImages / maxRefVideos / maxRefAudios
  parked: boolean // active engine takes no refs → grey, keep, don't send
  parkedReason: string
  sourceIsVideo1: boolean // the edited source occupies @video1 — extras start at @video2 and eat one video slot
  prompt: string // for the @mention warn set
  imageRefIds: string[]
  setImageRefIds: React.Dispatch<React.SetStateAction<string[]>>
  videoRefs: VideoRef[]
  setVideoRefs: React.Dispatch<React.SetStateAction<VideoRef[]>>
  audioRefs: AudioRef[]
  setAudioRefs: React.Dispatch<React.SetStateAction<AudioRef[]>>
}

export function RefSuite(p: RefSuiteProps): React.JSX.Element | null {
  const project = useStore((s) => s.project)
  const [imgPicker, setImgPicker] = useState(false)
  const [vidPicker, setVidPicker] = useState(false)
  const [audPicker, setAudPicker] = useState(false)
  const [dragOver, setDragOver] = useState<'img' | 'vid' | 'aud' | null>(null) // dashed outline on the hovered slot strip
  const [trimSlot, setTrimSlot] = useState<number | null>(null) // ✂ window editor open on this extra-video slot
  const trimInRef = useRef<HTMLInputElement>(null)
  const trimOutRef = useRef<HTMLInputElement>(null)

  const libImages = project?.images ?? []
  const libVideos = project?.videos ?? []
  const libAudio = project?.audio ?? []
  // every @mention actually used in the prompt — slots NOT in here get the yellow warn (Clip Gen grammar)
  const mentioned = new Set((p.prompt.match(/@\w+/g) ?? []).map((s) => s.toLowerCase()))

  const firstVideoTag = p.sourceIsVideo1 ? 2 : 1
  const maxExtraVideos = Math.max(0, p.model.maxRefVideos - (p.sourceIsVideo1 ? 1 : 0))
  const audioSecs = p.audioRefs.map((r) =>
    r.inSec != null && r.outSec != null && r.outSec > r.inSec ? r.outSec - r.inSec : libAudio.find((a) => a.id === r.audioId)?.durationSec
  )

  // parked AND empty = nothing to show or grey — the suite only appears when it can act or holds kept inputs
  if (p.parked && p.imageRefIds.length === 0 && p.videoRefs.length === 0 && p.audioRefs.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...(p.parked ? { opacity: 0.55 } : {}) }} title={p.parked ? p.parkedReason : undefined}>
      {/* image refs */}
      <div className="field">
        <div className="lb">
          image refs (@refs, ≤{p.parked ? '—' : p.model.maxRefImages}) <span style={{ color: 'var(--dim)' }}>— drag Library images in · yellow = not @mentioned</span>
        </div>
        <div
          onDragOver={(e) => {
            if (p.parked) return
            if (Array.from(e.dataTransfer.types).includes(MIME_IMAGE)) {
              e.preventDefault()
              setDragOver('img')
            }
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            setDragOver(null)
            if (p.parked) return
            const f = e.dataTransfer.getData(MIME_IMAGE)
            if (!f) return
            e.preventDefault()
            const hit = libImages.find((i) => i.file === f)
            if (hit && !p.imageRefIds.includes(hit.id)) p.setImageRefIds((a) => [...a, hit.id])
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: dragOver === 'img' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
        >
          {p.imageRefIds.map((id) => {
            const im = libImages.find((i) => i.id === id)
            return (
              <Thumbnail
                key={id}
                file={im?.file}
                label={im ? `${im.title} — mention it in the prompt to bind it` : '(deleted image)'}
                w={64}
                h={40}
                warn={!!im && !mentioned.has(im.title.toLowerCase())}
                onClear={() => p.setImageRefIds((a) => a.filter((x) => x !== id))}
              />
            )
          })}
          {!p.parked && p.imageRefIds.length < p.model.maxRefImages && (
            <span style={{ position: 'relative' }}>
              <span className="vd-slot" onClick={() => (libImages.length ? setImgPicker((v) => !v) : openLibraryPanel())} title={libImages.length ? 'add an image reference — pick a Library image (or drag one in)' : 'no Library images yet — click opens the Library'}>+ add</span>
              {imgPicker && libImages.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 230, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                  {libImages.filter((i) => !p.imageRefIds.includes(i.id)).map((i) => (
                    <div key={i.id} onMouseDown={(e) => { e.preventDefault(); p.setImageRefIds((a) => [...a, i.id]); setImgPicker(false) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
                      <img src={mediaUrl(i.file)} alt="" style={{ width: 34, height: 22, objectFit: 'cover', borderRadius: 2, flex: '0 0 auto' }} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
      </div>
      {/* extra video refs */}
      <div className="field">
        <div className="lb">
          extra video refs (@video{firstVideoTag}…, ≤{p.parked ? '—' : maxExtraVideos}) <span style={{ color: 'var(--dim)' }}>— drag Library videos or T-chips in · yellow = not @mentioned</span>
        </div>
        <div
          onDragOver={(e) => {
            if (p.parked) return
            const t = Array.from(e.dataTransfer.types)
            if (t.includes(MIME_VIDEO) || t.includes(MIME_TAKE)) {
              e.preventDefault()
              setDragOver('vid')
            }
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            setDragOver(null)
            if (p.parked) return
            const vid = e.dataTransfer.getData(MIME_VIDEO)
            if (vid) {
              e.preventDefault()
              p.setVideoRefs((a) => [...a, { videoId: vid }])
              return
            }
            const tk = e.dataTransfer.getData(MIME_TAKE)
            if (tk) {
              e.preventDefault()
              try {
                const o = JSON.parse(tk) as { clipId?: string; takeId?: string }
                if (o.clipId && o.takeId) p.setVideoRefs((a) => [...a, { takeRef: { clipId: o.clipId!, takeId: o.takeId! } }])
              } catch { /* malformed drag payload — ignore */ }
            }
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', padding: 4, borderRadius: 6, outline: dragOver === 'vid' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
        >
          {p.videoRefs.map((r, i) => {
            const info = vrefNameOf(project, r)
            const sec = vrefSecOf(project, r)
            const tag = `@video${i + firstVideoTag}`
            const windowed = r.inSec != null && r.outSec != null
            const trimOpen = trimSlot === i
            return (
              <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                <Thumbnail
                  videoFile={info.file}
                  videoSeek={r.inSec}
                  scrubVideo={info.file}
                  label={`${tag} = ${info.name}${sec != null ? ` · sends ${sec.toFixed(1)}s` : ''} — mention ${tag} in the prompt to bind it`}
                  w={64}
                  h={40}
                  warn={!mentioned.has(tag)}
                  onClear={() => {
                    p.setVideoRefs((a) => a.filter((_, j) => j !== i))
                    setTrimSlot(null)
                  }}
                />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: info.file ? 'var(--gold)' : 'var(--bad)', maxWidth: 70, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag}</span>
                <span
                  className="btn vd-hbtn"
                  style={{ fontSize: 9, ...(windowed ? { color: 'var(--amber)' } : {}) }}
                  title={windowed ? `sends ${r.inSec!.toFixed(1)}–${r.outSec!.toFixed(1)}s of the source — click to change` : 'send only a window of this video (fal caps refs at 15s combined)'}
                  onClick={() => setTrimSlot(trimOpen ? null : i)}
                >
                  ✂ {windowed ? `${(r.outSec! - r.inSec!).toFixed(1)}s` : sec != null ? `${sec.toFixed(1)}s` : '…'}
                </span>
                {trimOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, padding: 6, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, display: 'flex', gap: 4, alignItems: 'center', fontSize: 10 }}>
                    <input ref={trimInRef} type="number" min={0} step={0.1} defaultValue={r.inSec ?? 0} style={{ ...ctl, width: 52 }} title="window start (seconds into the source)" />
                    <span style={{ color: 'var(--dim)' }}>→</span>
                    <input ref={trimOutRef} type="number" min={0} step={0.1} defaultValue={r.outSec ?? (info.natSec != null ? Math.min(info.natSec, (r.inSec ?? 0) + 15) : 5)} style={{ ...ctl, width: 52 }} title="window end (seconds into the source)" />
                    <span
                      className="btn vd-hbtn"
                      onClick={() => {
                        const a = parseFloat(trimInRef.current?.value ?? '')
                        let b = parseFloat(trimOutRef.current?.value ?? '')
                        if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) {
                          if (b - a > 15) b = a + 15 // fal's video-ref cap — the popover can't exceed it either
                          p.setVideoRefs((arr) => arr.map((x, j) => (j === i ? { ...x, inSec: Math.max(0, a), outSec: b } : x)))
                        }
                        setTrimSlot(null)
                      }}
                    >
                      set
                    </span>
                    <span className="btn vd-hbtn" title="send the whole video" onClick={() => { p.setVideoRefs((arr) => arr.map((x, j) => (j === i ? { ...x, inSec: undefined, outSec: undefined } : x))); setTrimSlot(null) }}>full</span>
                  </div>
                )}
              </div>
            )
          })}
          {!p.parked && p.videoRefs.length < maxExtraVideos && (
            <span style={{ position: 'relative' }}>
              <span className="vd-slot" onClick={() => setVidPicker((v) => !v)} title="add a video reference — pick a Library video or a keeper take (or drag either in; drag a specific T-chip for another take)">+ add</span>
              {vidPicker && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 230, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                  {libVideos.map((v) => (
                    <div key={v.id} onMouseDown={(e) => { e.preventDefault(); p.setVideoRefs((a) => [...a, { videoId: v.id }]); setVidPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                      <Ic i={Film} size={11} /> {v.title}{v.durationSec ? ` · ${v.durationSec.toFixed(1)}s` : ''}
                    </div>
                  ))}
                  {(project?.clips ?? []).filter((c) => c.takes.length > 0).map((c) => {
                    const t = c.takes.find((x) => x.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
                    return (
                      <div key={c.id} onMouseDown={(e) => { e.preventDefault(); p.setVideoRefs((a) => [...a, { takeRef: { clipId: c.id, takeId: t.id } }]); setVidPicker(false) }} title="the clip's keeper take — drag a specific T-chip from its takes row for another" style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                        ▶ {c.name} · keeper{t.durationSec ? ` · ${t.durationSec.toFixed(1)}s` : ''}
                      </div>
                    )
                  })}
                </div>
              )}
            </span>
          )}
        </div>
      </div>
      {/* audio refs */}
      <div className="field">
        <div className="lb">
          audio refs (@audio1…, ≤{p.parked ? '—' : p.model.maxRefAudios} · ≤15s combined) <span style={{ color: 'var(--dim)' }}>— drag Library music in · needs ≥1 visual ref</span>
        </div>
        <div
          onDragOver={(e) => {
            if (p.parked) return
            if (Array.from(e.dataTransfer.types).includes(MIME_AUDIO)) {
              e.preventDefault()
              setDragOver('aud')
            }
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            setDragOver(null)
            if (p.parked) return
            const id = e.dataTransfer.getData(MIME_AUDIO)
            if (!id) return
            e.preventDefault()
            p.setAudioRefs((a) => [...a, { audioId: id }])
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, outline: dragOver === 'aud' ? '1px dashed var(--amber)' : '1px dashed transparent' }}
        >
          {p.audioRefs.map((r, i) => {
            const a = libAudio.find((x) => x.id === r.audioId)
            const sec = audioSecs[i]
            const tag = `@audio${i + 1}`
            const windowed = r.inSec != null && r.outSec != null
            const tooLong = !windowed && sec != null && sec > 15
            return (
              <span
                key={i}
                title={`${tag} = ${a?.title ?? '(deleted track)'}${sec != null ? ` · sends ${sec.toFixed(1)}s` : ''} — mention ${tag} in the prompt to bind it`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: 5, border: '1px solid', borderColor: !mentioned.has(tag) ? 'var(--amber)' : 'var(--line2)', background: 'var(--raised2)', fontSize: 10.5 }}
              >
                <span style={{ color: a ? 'var(--amber)' : 'var(--bad)' }}><Ic i={Music} size={10} /></span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>{tag}</span>
                <span style={{ maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: a ? 'var(--body)' : 'var(--bad)' }}>{a?.title ?? '(deleted track)'}</span>
                <span style={{ fontFamily: 'var(--mono)', color: tooLong ? 'var(--bad)' : 'var(--dim)', fontSize: 9.5 }} title={tooLong ? `whole track is ${sec!.toFixed(0)}s — set a ≤15s window or the render is blocked` : undefined}>
                  {sec != null ? `${sec.toFixed(1)}s` : '…'}
                </span>
                <input
                  type="number" min={0} step={0.1} value={r.inSec ?? ''} placeholder="in"
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    p.setAudioRefs((arr) => arr.map((x, j) => {
                      if (j !== i) return x
                      const ni = Number.isNaN(v) ? undefined : Math.max(0, v)
                      // the window can never exceed fal's 15s audio cap — moving IN drags OUT along
                      const no = ni != null && x.outSec != null && x.outSec - ni > 15 ? ni + 15 : x.outSec
                      return { ...x, inSec: ni, outSec: no }
                    }))
                  }}
                  style={{ ...ctl, width: 44, padding: '1px 4px', fontSize: 10 }} title="window start (seconds into the track)"
                />
                <input
                  type="number" min={0} step={0.1} value={r.outSec ?? ''} placeholder="out"
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    p.setAudioRefs((arr) => arr.map((x, j) => {
                      if (j !== i) return x
                      if (Number.isNaN(v)) return { ...x, outSec: undefined }
                      const base = x.inSec ?? 0
                      return { ...x, outSec: v - base > 15 ? base + 15 : v } // fal caps audio refs at 15s
                    }))
                  }}
                  style={{ ...ctl, width: 44, padding: '1px 4px', fontSize: 10 }} title="window end (seconds into the track) — capped at 15s span"
                />
                <span style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 2px' }} title="remove" onClick={() => p.setAudioRefs((a2) => a2.filter((_, j) => j !== i))}>✕</span>
              </span>
            )
          })}
          {!p.parked && p.audioRefs.length < p.model.maxRefAudios && (
            <span style={{ position: 'relative' }}>
              <span className="vd-slot" onClick={() => (libAudio.length ? setAudPicker((v) => !v) : openLibraryPanel())} title={libAudio.length ? 'add an audio reference — pick a Library music track (or drag one in)' : 'no Library music yet — click opens the Library'}>+ add</span>
              {audPicker && libAudio.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 200, maxHeight: 200, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                  {libAudio.map((a) => (
                    <div key={a.id} onMouseDown={(e) => { e.preventDefault(); p.setAudioRefs((x) => [...x, { audioId: a.id }]); setAudPicker(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                      <Ic i={Music} size={11} /> {a.title}{a.durationSec ? ` · ${a.durationSec.toFixed(0)}s` : ''}
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
