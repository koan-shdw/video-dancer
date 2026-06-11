import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { focusAudio } from '../audioBus'
import { beatRanges } from '../emitYaml'
import { beatAtTime, beatRefImageUrl } from '../lib/beatUtils'
import { buildSegs, resolveView } from '../lib/timelineUtils'
import { clipModelLine, clipSeed } from '../lib/clipMeta'
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

  const timeline = project?.timeline ?? []
  const clips = project?.clips ?? []
  const item = timeline[tlIndex]
  const clip = item ? clips.find((c) => c.id === item.clipId) : undefined
  // what this item SHOWS: a take's frozen view (its real length + snapshot beats), or the live
  // recipe when the instance is set to "C" / the clip is an unrendered storyboard
  const view = clip ? resolveView(clip, item) : undefined
  const take = view?.take
  const recipe = view?.recipe ?? clip?.promptData
  const takeFile = take?.file
  const inSec = item?.inSec ?? 0
  const srcDur = view?.durationSec ?? 5 // source length of the active view (always finite)
  const outSec = Math.min(item?.outSec ?? srcDur, srcDur)
  const url = takeFile ? mediaUrl(takeFile) : null // streams via media:// — no IPC/Blob
  // recipe view (C / storyboard): show its keyframe still instead
  const stillFile = recipe ? project?.images.find((i) => i.id === recipe.imageIds?.[0])?.file : undefined
  const stillUrl = !url && stillFile ? mediaUrl(stillFile) : null
  // per-beat overlay: which beat the playhead is currently inside, + its @referenced image (if any)
  const beats = recipe?.beats ?? []
  const refImg = (b: BeatField): string | undefined => beatRefImageUrl(b, recipe?.freeform ?? '', project?.images ?? [])
  // details overlay describes WHAT'S SHOWING: the take's frozen recipe, or the live one
  const metaClip = clip && recipe ? { ...clip, promptData: recipe } : clip
  // storyboard (no render): show the CURRENT beat's reference image (changes per beat), else the clip still
  const storyImg = !url ? (beats[curBeat] ? refImg(beats[curBeat]) : undefined) ?? stillUrl : null
  const overlayOn = showDetails || (!url && beats.length > 0) // auto-show beat details for unrendered clips

  // cumulative sequence segments for the live program timecode (same math as the Timeline panel)
  const { segs: segsAll, total: totalAll } = buildSegs(timeline, clips)

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

  return (
    <div className="vd-panel vd-monitor" style={{ position: 'relative' }}>
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
                  {take ? '' : ' · C (live recipe)'}
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
                    {b.camera && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 2 }}>camera: {b.camera}</div>}
                    {b.action && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 2 }}>action: {b.action}</div>}
                    {b.lighting && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 2 }}>lighting: {b.lighting}</div>}
                    {(['dialogue', 'vfx', 'reaction', 'sfx'] as const).map((k) =>
                      b[k] ? (
                        <div key={k} style={{ fontSize: 10, color: '#cfcfd6', marginTop: 2 }}>
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
                    {recipe?.freeform && <div style={{ fontSize: 10, color: '#cfcfd6', marginTop: 2 }}>{recipe.freeform.slice(0, 240)}</div>}
                  </>
                )}
              </div>
            </div>
          )
        })()}
      {url ? (
        <video
          ref={vidRef}
          src={url}
          onPlay={(e) => focusAudio(e.currentTarget)}
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
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#000' }}
        />
      ) : storyImg ? (
        <img src={storyImg} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#000' }} />
      ) : (
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>
          {timeline.length ? 'press ▶ on the timeline' : 'drag clips from the Bin onto the timeline'}
        </span>
      )}
      {timeline.length > 0 && (
        <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', zIndex: 6 }}>
          <TimeReadout segs={segsAll} total={totalAll} style={{ fontSize: 12, color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 8px', borderRadius: 4 }} />
        </div>
      )}
    </div>
  )
}
