import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { focusAudio } from '../audioBus'
import { beatRanges } from '../emitYaml'
import { beatAtTime, beatRefImageUrl } from '../lib/beatUtils'
import { buildSegs, resolveView, activeItems, activeTimeline } from '../lib/timelineUtils'
import { clipModelLine, clipSeed } from '../lib/clipMeta'
import { framePngBytes } from '../lib/frameGrab'
import { smpte } from '../lib/time'
import { TimeReadout } from './shared/playback'

// ---- Timeline Monitor: program player — plays the timeline, honours scrub seeks ----
export function MonitorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const tlIndex = useStore((s) => s.tlIndex)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const seekTick = useStore((s) => s.seekTick)
  const tlNext = useStore((s) => s.tlNext)
  const tlSetProgress = useStore((s) => s.tlSetProgress)
  const vidRef = useRef<HTMLVideoElement>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [curBeat, setCurBeat] = useState(0)
  const [rawGrab, setRawGrab] = useState(false) // grab the full frame vs the canvas-cropped frame
  const [grabMsg, setGrabMsg] = useState('')
  // the STAGE: a canvas with the active timeline's aspect ratio, fitted inside the panel. Clips
  // render INTO it with cover-centered fill (mismatched aspects crop equally on both sides).
  const stageBoxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stageBoxRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      const w = Math.round(r?.width ?? 0)
      const h = Math.round(r?.height ?? 0)
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const timeline = activeItems(project)
  const clips = project?.clips ?? []
  const item = timeline[tlIndex]
  const clip = item ? clips.find((c) => c.id === item.clipId) : undefined
  // what this item SHOWS: a take's frozen view (its real length + snapshot beats), or the live
  // recipe when the instance is set to "C" / the clip is an unrendered storyboard
  const view = clip ? resolveView(clip, item) : undefined
  const take = view?.take
  const recipe = view?.recipe ?? clip?.promptData
  const takeFile = take?.file
  const srcDur = view?.durationSec ?? 5 // source length of the active view (always finite)
  // C (useRecipe) ignores trims — it always plays the full live recipe span (same rule as effDur)
  const inSec = item?.useRecipe ? 0 : item?.inSec ?? 0
  const outSec = item?.useRecipe ? srcDur : Math.min(item?.outSec ?? srcDur, srcDur)
  const url = takeFile ? mediaUrl(takeFile) : null // streams via media:// — no IPC/Blob
  // recipe view (C / storyboard): show its keyframe still instead
  const stillFile = recipe ? project?.images.find((i) => i.id === recipe.imageIds?.[0])?.file : undefined
  const stillUrl = !url && stillFile ? mediaUrl(stillFile) : null
  // per-beat overlay: take views show ONLY frozen beats (pre-snapshot takes: none); recipe views show live beats
  const beats = view?.beats ?? []
  const refImg = (b: BeatField): string | undefined => beatRefImageUrl(b, view?.beatFreeform ?? '', project?.images ?? [])
  // details overlay describes WHAT'S SHOWING: the take's frozen recipe, or the live one
  const metaClip = clip && recipe ? { ...clip, promptData: recipe } : clip
  // storyboard (no render): show the CURRENT beat's reference image (changes per beat), else the clip still
  const storyImg = !url ? (beats[curBeat] ? refImg(beats[curBeat]) : undefined) ?? stillUrl : null
  const overlayOn = showDetails || (!url && beats.length > 0) // auto-show beat details for unrendered clips

  // cumulative sequence segments for the live program timecode (same math as the Timeline panel)
  const { segs: segsAll, total: totalAll } = buildSegs(timeline, clips)

  // ---- the audio lane: a hidden <audio> kept in sync with the program position ----
  const tlObj = activeTimeline(project)
  const vMuted = !!tlObj?.videoMuted || !!item?.muted // layer mute OR this instance's own mute
  const music = tlObj?.music
  const musicTrack = music ? project?.audio.find((a) => a.id === music.audioId) : undefined
  const musicUrl = musicTrack ? mediaUrl(musicTrack.file) : undefined
  const musRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const m = musRef.current
    if (m) m.muted = !!tlObj?.musicMuted
  }, [tlObj?.musicMuted, musicUrl])
  // video-layer mute: force the program video silent; unmuting hands audio back via focusAudio
  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (vMuted) v.muted = true
    else if (useStore.getState().tlPlaying) focusAudio(v)
  }, [vMuted, url])
  useEffect(() => {
    const m = musRef.current
    if (!m || !music || !musicUrl) return
    if (!tlPlaying) {
      m.pause()
      return
    }
    // while playing: every frame, position the music against the sequence time (start offset + trims);
    // free-runs between checks, hard-corrects only on >0.35s drift so it never stutters
    let raf = 0
    const tick = (): void => {
      const st = useStore.getState()
      const seg = segsAll[Math.min(st.tlIndex, segsAll.length - 1)] ?? { start: 0, dur: 0 }
      const T = seg.start + st.tlProgress * seg.dur
      const inS = music.inSec ?? 0
      const srcDur = musicTrack?.durationSec ?? (isFinite(m.duration) ? m.duration : 0)
      const outS = Math.min(music.outSec ?? (srcDur || Infinity), srcDur || Infinity)
      const end = music.startSec + (isFinite(outS) ? Math.max(0, outS - inS) : totalAll)
      if (T >= music.startSec && T < Math.min(end, totalAll)) {
        const target = inS + (T - music.startSec)
        if (m.paused) {
          try {
            m.currentTime = target
          } catch {
            /* not seekable yet */
          }
          m.play().catch(() => undefined)
        } else if (Math.abs(m.currentTime - target) > 0.35) {
          try {
            m.currentTime = target
          } catch {
            /* ignore */
          }
        }
      } else if (!m.paused) m.pause()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      m.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlPlaying, music?.audioId, music?.startSec, music?.inSec, music?.outSec, musicUrl, totalAll])

  // stage geometry: largest box of the timeline's aspect that fits the panel
  const tlAspect = activeTimeline(project)?.aspectRatio ?? '16:9'
  const [aw, ah] = tlAspect.split(':').map(Number)
  const ar = aw > 0 && ah > 0 ? aw / ah : 16 / 9
  const fitW = box.h > 0 && box.w / box.h > ar ? Math.round(box.h * ar) : box.w
  const fitH = box.h > 0 && box.w / box.h > ar ? box.h : ar > 0 ? Math.round(box.w / ar) : box.h

  // seek to the desired offset when the clip/position changes — but only AFTER metadata is ready
  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    const apply = (): void => {
      try {
        v.currentTime = inSec + useStore.getState().seekOffset
      } catch {
        /* ignore */
      }
      if (useStore.getState().tlPlaying) v.play().catch(() => undefined)
    }
    if (v.readyState >= 1) {
      apply()
      return undefined
    }
    v.addEventListener('loadedmetadata', apply, { once: true })
    return () => v.removeEventListener('loadedmetadata', apply)
  }, [seekTick, url, inSec])

  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (tlPlaying) v.play().catch(() => undefined)
    else v.pause()
  }, [tlPlaying])

  // storyboard hold: no video → advance the playhead over the clip's duration via a timer
  useEffect(() => {
    if (url || !tlPlaying) return
    const span = Math.max(0.25, outSec - inSec)
    let raf = 0
    const startWall = performance.now()
    const startOffset = useStore.getState().tlProgress * span // resume from the paused / scrubbed point
    const tick = (): void => {
      const elapsed = startOffset + (performance.now() - startWall) / 1000
      const p = Math.min(1, elapsed / span)
      tlSetProgress(p)
      setCurBeat((c) => {
        const bi = beatAtTime(beats, inSec + p * span)
        return c === bi ? c : bi
      })
      if (p >= 1) {
        tlNext()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tlPlaying, seekTick, inSec, outSec, srcDur, tlNext, tlSetProgress])

  // SCRUBBING a beat-only (storyboard) clip: no video fires onTimeUpdate and the hold-clock only runs during
  // playback, so update the active beat from tlProgress on each seek → the thumb + details follow the playhead
  useEffect(() => {
    if (url || tlPlaying || beats.length === 0) return
    const span = Math.max(0.25, outSec - inSec)
    const p = useStore.getState().tlProgress
    setCurBeat((c) => {
      const bi = beatAtTime(beats, inSec + p * span)
      return c === bi ? c : bi
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTick, url, tlPlaying, inSec, outSec, srcDur, beats.length])

  // reset the active beat when the clip under the playhead changes
  useEffect(() => setCurBeat(0), [clip?.id])

  // 📷 grab the current program frame → Library (as-shown = cropped to the timeline canvas, or raw)
  const grabFrame = async (): Promise<void> => {
    const v = vidRef.current
    if (!v || !url) return
    const bytes = await framePngBytes(v, rawGrab ? undefined : tlAspect)
    if (!bytes) {
      setGrabMsg('no frame')
      return
    }
    const note = `frame · ${clip?.name ?? 'clip'} · ${smpte(v.currentTime)}`
    const id = await useStore.getState().saveFrame(bytes, note)
    const title = id ? useStore.getState().project?.images.find((i) => i.id === id)?.title : null
    setGrabMsg(title ? `✓ ${title} → Library` : 'saved ✓')
    window.setTimeout(() => setGrabMsg(''), 2500)
  }

  return (
    <div className="vd-panel vd-monitor" style={{ position: 'relative' }}>
      {/* the timeline's music lane — synced to the program position, never visible */}
      {musicUrl && <audio ref={musRef} src={musicUrl} preload="auto" style={{ display: 'none' }} />}
      {clip && (
        <span
          className="btn vd-hbtn"
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 6 }}
          onClick={() => setShowDetails((v) => !v)}
          title="show / hide this clip's recipe over the video"
        >
          {showDetails ? 'details ▴' : 'details ▾'}
        </span>
      )}
      {overlayOn &&
        clip &&
        (() => {
          const b = beats[curBeat]
          const bg = b ? refImg(b) : undefined
          const r = beatRanges(beats)[curBeat]
          return (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                maxWidth: '64%',
                maxHeight: '82%',
                overflow: 'hidden',
                zIndex: 6,
                border: '1px solid var(--line)',
                borderRadius: 6,
                fontFamily: 'var(--mono)'
              }}
            >
              {bg && (
                <div
                  style={{ position: 'absolute', inset: 0, backgroundImage: `url("${bg}")`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.5 }}
                />
              )}
              <div style={{ position: 'relative', background: 'linear-gradient(180deg, rgba(0,0,0,.74), rgba(0,0,0,.52))', padding: '7px 9px', maxHeight: '100%', overflow: 'auto' }}>
                <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', marginBottom: 4 }}>
                  {metaClip ? clipModelLine(metaClip) : ''}
                  {take ? '' : ' · C — live recipe'}
                  {clipSeed(clip) != null ? ` · seed ${clipSeed(clip)}` : ''}
                </div>
                {b ? (
                  <>
                    <div style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 11, marginBottom: 2 }}>
                      {clip.name} · beat {curBeat + 1}/{beats.length} — {b.name || 'shot'}
                    </div>
                    {r && (
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>
                        {Math.round(r.start * 100) / 100}s – {Math.round(r.end * 100) / 100}s
                      </div>
                    )}
                    {b.camera && <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 2 }}>camera: {b.camera}</div>}
                    {b.action && <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 2 }}>action: {b.action}</div>}
                    {b.lighting && <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 2 }}>lighting: {b.lighting}</div>}
                    {(['dialogue', 'vfx', 'reaction', 'sfx'] as const).map((k) =>
                      b[k] ? (
                        <div key={k} style={{ fontSize: 10, color: 'var(--body)', marginTop: 2 }}>
                          {k}: {b[k]}
                        </div>
                      ) : null
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 11, marginBottom: 3 }}>{clip.name}</div>
                    {recipe?.scene.style && <div style={{ fontSize: 10 }}>style: {recipe.scene.style}</div>}
                    {recipe?.scene.visualFeel && <div style={{ fontSize: 10 }}>feel: {recipe.scene.visualFeel}</div>}
                    {recipe?.freeform && <div style={{ fontSize: 10, color: 'var(--body)', marginTop: 2 }}>{recipe.freeform.slice(0, 240)}</div>}
                  </>
                )}
              </div>
            </div>
          )
        })()}
      {/* the stage: the timeline's canvas — clips auto-FILL it centered (cover crops mismatched aspects) */}
      <div ref={stageBoxRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {fitW > 0 && fitH > 0 && (
          <div style={{ width: fitW, height: fitH, background: '#000', overflow: 'hidden', position: 'relative', outline: '1px solid var(--line)' }}>
            {url ? (
              <video
                ref={vidRef}
                src={url}
                crossOrigin="anonymous"
                onPlay={(e) => {
                  if (vMuted) e.currentTarget.muted = true
                  else focusAudio(e.currentTarget)
                }}
                onEnded={() => tlNext()}
                onLoadedMetadata={(e) => {
                  // backfill the take's ACTUAL length the first time we learn it (drives timeline block length)
                  const d = e.currentTarget.duration
                  if (clip && take && d > 0) useStore.getState().reportTakeDuration(clip.id, take.id, d)
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget
                  // end at the trim out-point, but never past the real video length (declared duration can be wrong)
                  const realEnd = Math.min(outSec, v.duration || outSec)
                  const span = realEnd - inSec
                  if (span > 0) tlSetProgress(Math.min(1, Math.max(0, (v.currentTime - inSec) / span)))
                  setCurBeat((c) => {
                    const bi = beatAtTime(beats, v.currentTime)
                    return c === bi ? c : bi
                  })
                  if (useStore.getState().tlPlaying && realEnd > 0 && v.currentTime >= realEnd - 0.05) tlNext()
                }}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : storyImg ? (
              <img src={storyImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: 12, textAlign: 'center', padding: 10 }}>
                {timeline.length ? 'press ▶ on the timeline' : 'drag clips from the Bin onto the timeline'}
              </span>
            )}
          </div>
        )}
      </div>
      {timeline.length > 0 && (
        <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', zIndex: 6 }}>
          <TimeReadout segs={segsAll} total={totalAll} style={{ fontSize: 12, color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 8px', borderRadius: 4 }} />
        </div>
      )}
      {/* 📷 grab the playhead frame → Library (only over a real rendered frame) */}
      {url && (
        <div style={{ position: 'absolute', bottom: 6, left: 8, zIndex: 7, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="btn vd-hbtn" onClick={() => void grabFrame()} title="save the current frame to the Library">📷 frame</span>
          <span className="btn vd-hbtn" style={{ opacity: 0.8 }} onClick={() => setRawGrab((v) => !v)} title="as-shown = cropped to the timeline aspect · raw = full clip frame">
            {rawGrab ? 'raw' : 'as-shown'}
          </span>
          {grabMsg && <span style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)', textShadow: '0 1px 2px #000' }}>{grabMsg}</span>}
        </div>
      )}
    </div>
  )
}
