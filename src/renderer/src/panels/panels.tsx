import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { Thumbnail, useThumbUrl, useMediaUrl } from '../Thumbnail'
import { mediaUrl } from '../media'
import { focusAudio, subAudio } from '../audioBus'
import { BEAT_COLORS, beatRanges, beatRefFile } from '../emitYaml'
import { Beats } from './Beats'
import { Foldered, type MenuEntry } from './Foldered'
import { textPrompt, confirmDialog } from '../prompt'

// model / render details shown in the details overlays
function clipModelLine(c: Clip): string {
  const pd = c.promptData
  const parts: string[] = ['Seedance 2', pd.mode, `${pd.duration}s`, pd.resolution, pd.aspectRatio]
  if (pd.generateAudio) parts.push('audio')
  return parts.join(' · ')
}
function clipSeed(c: Clip): number | undefined {
  const keeper = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
  return keeper?.seed ?? c.promptData.seed
}

// ---- Library: the project's images, by @title — folders + right-click actions ----
export function LibraryPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const importToLibrary = useStore((s) => s.importToLibrary)
  const importPaths = useStore((s) => s.importPaths)
  const duplicateImage = useStore((s) => s.duplicateImage)
  const deleteImage = useStore((s) => s.deleteImage)
  const renameImage = useStore((s) => s.renameImage)
  const [over, setOver] = useState(false)
  const images = project?.images ?? []

  const imageMenu = (im: ProjImage): MenuEntry[] => {
    const uses = (project?.clips ?? []).filter(
      (c) => (c.promptData.imageIds ?? []).includes(im.id) || c.promptData.endImageId === im.id
    ).length
    return [
      {
        label: '✎ rename @title',
        onClick: async () => {
          const n = await textPrompt('Rename (@title)', im.title)
          if (n && n.trim()) void renameImage(im.id, n.trim())
        }
      },
      { label: '⧉ duplicate', onClick: () => void duplicateImage(im.id) },
      {
        label: '🗑 delete',
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`${im.title} is referenced by ${uses} clip(s). Delete it and drop those refs? (file stays on disk)`)))
            void deleteImage(im.id)
        }
      }
    ]
  }
  const renderImage = (im: ProjImage): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-vd-image', im.file)
        e.dataTransfer.setData('application/x-vd-move', JSON.stringify({ kind: 'lib', id: im.id }))
      }}
      title="drag into a clip slot · right-click for actions"
    >
      <Thumbnail file={im.file} label={im.title} w={84} h={54} />
    </div>
  )

  return (
    <div
      className="vd-panel vd-scroll"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files || [])
        if (files.length === 0) return // internal drag, not an OS file drop
        e.preventDefault()
        setOver(false)
        const paths = files
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => !!p && /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(p))
        if (paths.length) void importPaths(paths)
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -3 }}
    >
      <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void importToLibrary()}>
        ⬆ import image
      </span>
      {!project && <p className="vd-hint">Open or create a project first.</p>}
      {project && images.length === 0 && (
        <p className="vd-hint">Import images, drag them in from your desktop, or render — they live here as @titles.</p>
      )}
      {project && <Foldered kind="lib" items={images} renderItem={renderImage} itemMenu={imageMenu} root={rootFolder ?? null} />}
    </div>
  )
}

// ---- Bin: clips as icon tiles — folders + right-click actions; drop a take here to clone ----
export function BinPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const cloneTakeToClip = useStore((s) => s.cloneTakeToClip)
  const createClip = useStore((s) => s.createClip)
  const renameClip = useStore((s) => s.renameClip)
  const duplicateClip = useStore((s) => s.duplicateClip)
  const deleteClip = useStore((s) => s.deleteClip)
  const [over, setOver] = useState(false)
  const clips = project?.clips ?? []
  const firstImage = (c: Clip): string | undefined => {
    const id = c.promptData.imageIds?.[0]
    return id ? project?.images.find((i) => i.id === id)?.file : undefined
  }

  const clipMenu = (c: Clip): MenuEntry[] => {
    const uses = (project?.timeline ?? []).filter((it) => it.clipId === c.id).length
    return [
      {
        label: '✎ rename',
        onClick: async () => {
          const n = await textPrompt('Rename clip', c.name)
          if (n && n.trim()) void renameClip(c.id, n.trim())
        }
      },
      { label: '⧉ duplicate', onClick: () => void duplicateClip(c.id) },
      {
        label: '🗑 delete',
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`"${c.name}" is on the timeline (${uses}×). Delete it and remove those instances?`)))
            void deleteClip(c.id)
        }
      }
    ]
  }
  const renderClip = (c: Clip): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', c.id)
        e.dataTransfer.setData('application/x-vd-move', JSON.stringify({ kind: 'bin', id: c.id }))
      }}
      title="drag onto the timeline · right-click for actions"
      style={{ borderRadius: 7, outline: c.takes.length === 0 ? '1px dashed var(--amber-dim)' : 'none', outlineOffset: 1 }}
    >
      <Thumbnail
        file={firstImage(c)}
        label={`${c.name} · ${c.takes.length ? c.takes.length + 't' : '▦'}`}
        placeholder={c.name}
        w={96}
        h={60}
        active={c.id === selectedClipId}
        onClick={() => selectClip(c.id)}
      />
    </div>
  )

  return (
    <div
      className="vd-panel vd-scroll"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes('application/x-vd-take')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const d = e.dataTransfer.getData('application/x-vd-take')
        if (!d) return
        e.preventDefault()
        setOver(false)
        try {
          const o = JSON.parse(d) as { clipId?: string; takeId?: string }
          if (o.clipId && o.takeId) void cloneTakeToClip(o.clipId, o.takeId)
        } catch (err) {
          console.error('[bin drop] parse failed', err)
        }
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -2 }}
    >
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void createClip()}>
          + New clip
        </span>
      )}
      {!project && <p className="vd-hint">No project open. Use New / Open at the top.</p>}
      {project && clips.length === 0 && <p className="vd-hint">No clips yet — render one or hit “+ New clip”.</p>}
      {project && <Foldered kind="bin" items={clips} renderItem={renderClip} itemMenu={clipMenu} root={rootFolder ?? null} />}
      {(() => {
        const sel = clips.find((c) => c.id === selectedClipId)
        if (!sel) return null
        const titleOfId = (id: string): string | undefined => project?.images.find((i) => i.id === id)?.title
        const refs = (sel.promptData.imageIds ?? []).map(titleOfId).filter(Boolean).join(', ')
        const keeper = sel.takes.find((t) => t.id === sel.keeperTakeId) ?? sel.takes[sel.takes.length - 1]
        const seed = keeper?.seed ?? sel.promptData.seed
        const state = sel.takes.length === 0 ? 'storyboard · no render' : `${sel.takes.length} take${sel.takes.length > 1 ? 's' : ''} · rendered`
        return (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--muted)' }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }}>details</div>
            <div style={{ color: '#e8e8ee', fontWeight: 600 }}>{sel.name}</div>
            <div>
              Seedance 2 · {sel.promptData.duration}s · {state}
              {seed != null ? ` · seed ${seed}` : ''}
            </div>
            {refs && <div>refs: {refs}</div>}
          </div>
        )
      })()}
    </div>
  )
}

// SMPTE timecode HH:MM:SS:FF. Clips don't store real fps yet, so the frame field assumes TC_FPS.
const TC_FPS = 24
function smpte(t: number, fps = TC_FPS): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const f = Math.floor(t * fps) % fps
  const s = Math.floor(t) % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`
}

// ---- Monitor: program player — plays the timeline, honours scrub seeks ----
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
  const take = clip
    ? (item?.takeId ? clip.takes.find((t) => t.id === item.takeId) : undefined) ??
      clip.takes.find((t) => t.id === clip.keeperTakeId) ??
      clip.takes[clip.takes.length - 1]
    : undefined
  const takeFile = take?.file
  const inSec = item?.inSec ?? 0
  const clipDur = clip ? parseFloat(clip.promptData.duration) : NaN
  const outSec = item?.outSec ?? (Number.isFinite(clipDur) && clipDur > 0 ? clipDur : Infinity)
  const url = takeFile ? mediaUrl(takeFile) : null // streams via media:// — no IPC/Blob
  // storyboard clip (no rendered take): show its keyframe still instead
  const stillFile = clip ? project?.images.find((i) => i.id === clip.promptData.imageIds?.[0])?.file : undefined
  const stillUrl = !url && stillFile ? mediaUrl(stillFile) : null
  // per-beat overlay: which beat the playhead is currently inside, + its @referenced image (if any)
  const beats = clip?.promptData.beats ?? []
  const beatAtTime = (t: number): number => {
    if (beats.length === 0) return 0
    const ranges = beatRanges(beats)
    for (let i = 0; i < ranges.length; i++) if (t >= ranges[i].start && t < ranges[i].end) return i
    return ranges.length - 1
  }
  const beatRefImage = (b: BeatField): string | undefined => {
    const f = beatRefFile(b, clip?.promptData.freeform ?? '', project?.images ?? [])
    return f ? mediaUrl(f) : undefined
  }
  // storyboard (no render): show the CURRENT beat's reference image (changes per beat), else the clip still
  const storyImg = !url ? (beats[curBeat] ? beatRefImage(beats[curBeat]) : undefined) ?? stillUrl : null
  const overlayOn = showDetails || (!url && beats.length > 0) // auto-show beat details for unrendered clips

  // cumulative sequence segments for the live program timecode (mirrors TimelinePanel's effDur math)
  let segAcc = 0
  const segsAll = timeline.map((it) => {
    const c = clips.find((x) => x.id === it.clipId)
    const d = c ? parseFloat(c.promptData.duration) : NaN
    const cd = Number.isFinite(d) && d > 0 ? d : 5
    const o = it.outSec
    const eff = Math.max(0.25, (typeof o === 'number' && Number.isFinite(o) ? o : cd) - (it.inSec ?? 0))
    const seg = { start: segAcc, dur: eff }
    segAcc += eff
    return seg
  })
  const totalAll = segsAll.reduce((s, x) => s + x.dur, 0) || 1

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
    const span = Math.max(0.25, (Number.isFinite(outSec) ? outSec : Number.isFinite(clipDur) && clipDur > 0 ? clipDur : 5) - inSec)
    let raf = 0
    const startWall = performance.now()
    const startOffset = useStore.getState().tlProgress * span // resume from the paused / scrubbed point
    const tick = (): void => {
      const elapsed = startOffset + (performance.now() - startWall) / 1000
      const p = Math.min(1, elapsed / span)
      tlSetProgress(p)
      setCurBeat((c) => {
        const bi = beatAtTime(inSec + p * span)
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
  }, [url, tlPlaying, seekTick, inSec, outSec, clipDur, tlNext, tlSetProgress])

  // SCRUBBING a beat-only (storyboard) clip: no video fires onTimeUpdate and the hold-clock only runs during
  // playback, so update the active beat from tlProgress on each seek → the thumb + details follow the playhead
  useEffect(() => {
    if (url || tlPlaying || beats.length === 0) return
    const span = Math.max(0.25, (Number.isFinite(outSec) ? outSec : Number.isFinite(clipDur) && clipDur > 0 ? clipDur : 5) - inSec)
    const p = useStore.getState().tlProgress
    setCurBeat((c) => {
      const bi = beatAtTime(inSec + p * span)
      return c === bi ? c : bi
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTick, url, tlPlaying, inSec, outSec, clipDur, beats.length])

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
          const bg = b ? beatRefImage(b) : undefined
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
                  {clipModelLine(clip)}
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
                    {clip.promptData.scene.style && <div style={{ fontSize: 10 }}>style: {clip.promptData.scene.style}</div>}
                    {clip.promptData.scene.visualFeel && <div style={{ fontSize: 10 }}>feel: {clip.promptData.scene.visualFeel}</div>}
                    {clip.promptData.freeform && <div style={{ fontSize: 10, color: '#cfcfd6', marginTop: 2 }}>{clip.promptData.freeform.slice(0, 240)}</div>}
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
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            // end at the trim out-point, but never past the real video length (declared duration can be wrong)
            const realEnd = Number.isFinite(outSec) ? Math.min(outSec, v.duration || outSec) : v.duration || 0
            const span = realEnd - inSec
            if (span > 0) tlSetProgress(Math.min(1, Math.max(0, (v.currentTime - inSec) / span)))
            setCurBeat((c) => {
              const bi = beatAtTime(v.currentTime)
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

// ---- Source monitor: the double-clicked timeline clip + an in/out source timeline ----
export function SourceMonitor(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const editTimelineIndex = useStore((s) => s.editTimelineIndex)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const setTimelineItems = useStore((s) => s.setTimelineItems)
  const saveClipPromptData = useStore((s) => s.saveClipPromptData)
  const vidRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const winRef = useRef(false) // true while playing only the in→out window
  const [vdur, setVdur] = useState(0)
  const [drag, setDrag] = useState<{ inSec: number; outSec: number } | null>(null)
  const [smMuted, setSmMuted] = useState(true)
  const [smPlaying, setSmPlaying] = useState(false)
  const [smDetails, setSmDetails] = useState(false)
  const [curBeat, setCurBeat] = useState(0)
  const sphRef = useRef<HTMLDivElement>(null)
  const beatPhRef = useRef<HTMLDivElement>(null) // scrubber line on the beats editor bar (set imperatively)
  const tcRef = useRef<HTMLSpanElement>(null) // live SMPTE timecode (set imperatively, no per-frame re-render)
  const posRef = useRef(0) // current preview time (seconds) — drives the playhead + active beat

  // preview target: a double-clicked timeline slot (with in/out trim) OR the clip selected in the Bin
  const slot = editTimelineIndex != null ? project?.timeline?.[editTimelineIndex] : undefined
  const slotMode = !!slot
  const clip = slot
    ? project?.clips.find((c) => c.id === slot.clipId)
    : selectedClipId
      ? project?.clips.find((c) => c.id === selectedClipId)
      : undefined
  const take = clip
    ? (slot?.takeId ? clip.takes.find((t) => t.id === slot.takeId) : undefined) ??
      clip.takes.find((t) => t.id === clip.keeperTakeId) ??
      clip.takes[clip.takes.length - 1]
    : undefined
  const url = useMediaUrl(take?.file)

  // `beats` = our local edit draft IF it belongs to THIS clip, else the clip's stored beats. The draft check
  // is per-render, so switching clips can NEVER show the previous clip's beats (the leak the user hit).
  const [beatsDraft, setBeatsDraft] = useState<BeatField[]>([])
  const draftClipRef = useRef<string | null>(null) // which clip beatsDraft belongs to
  const pendingBeatsRef = useRef<{ id: string; beats: BeatField[] } | null>(null)
  const beatTimerRef = useRef<number | undefined>(undefined)
  const beats = draftClipRef.current === clip?.id ? beatsDraft : (clip?.promptData.beats ?? [])
  const fullDur = vdur || (clip ? parseFloat(clip.promptData.duration) || 0 : 0) || 5
  // the editable beats bar spans this duration (matches Beats.tsx: declared duration → beats sum → 5)
  const beatsSum = beats.reduce((s, b) => s + (b.length || 0), 0)
  const declForBar = clip ? parseFloat(clip.promptData.duration) || 0 : 0
  const beatsBarDur = declForBar > 0 ? declForBar : beatsSum > 0 ? beatsSum : 5
  const beatAtTime = (t: number): number => {
    if (beats.length === 0) return 0
    const rg = beatRanges(beats)
    for (let i = 0; i < rg.length; i++) if (t >= rg[i].start && t < rg[i].end) return i
    return rg.length - 1
  }
  const beatRefImage = (b: BeatField): string | undefined => {
    const f = beatRefFile(b, clip?.promptData.freeform ?? '', project?.images ?? [])
    return f ? mediaUrl(f) : undefined
  }
  // move the playhead + active beat (imperative playhead + timecode so playback doesn't re-render per frame)
  const setPos = (t: number): void => {
    posRef.current = t
    if (sphRef.current) sphRef.current.style.left = `${(t / fullDur) * 100}%`
    if (beatPhRef.current) beatPhRef.current.style.left = `${Math.min(100, Math.max(0, (t / beatsBarDur) * 100))}%`
    if (tcRef.current) tcRef.current.textContent = smpte(t)
    setCurBeat((c) => {
      const bi = beatAtTime(t)
      return c === bi ? c : bi
    })
  }
  // the Clip Monitor owns ONLY beats. It must NOT write imageIds: the Clip Editor owns the reference list, and
  // a concurrent imageIds write here would race its shallow-merge save and drop refs. saveClipPromptData merges,
  // so sending just {beats} preserves the Editor's prompt/refs/seed. (@ref→ref linkage stays in the Editor.)
  const saveBeats = (id: string, next: BeatField[]): Promise<void> => saveClipPromptData(id, { beats: next })
  // edit a beat → instant local draft + debounced merge-save; on settle, drop the draft so external (Clip
  // Editor) edits get adopted again
  const persistBeats = (next: BeatField[]): void => {
    if (!clip) return
    const id = clip.id
    draftClipRef.current = id
    pendingBeatsRef.current = { id, beats: next }
    setBeatsDraft(next)
    window.clearTimeout(beatTimerRef.current)
    beatTimerRef.current = window.setTimeout(() => {
      const p = pendingBeatsRef.current
      pendingBeatsRef.current = null
      if (!p) return
      void saveBeats(p.id, p.beats).then(() => {
        if (draftClipRef.current === p.id && !pendingBeatsRef.current) draftClipRef.current = null
      })
    }, 500)
  }
  const flushBeats = (): void => {
    window.clearTimeout(beatTimerRef.current)
    const p = pendingBeatsRef.current
    pendingBeatsRef.current = null
    if (p) void saveBeats(p.id, p.beats)
  }
  // memoized so per-frame playback re-renders (setCurBeat) don't recompute beat ranges / resolve ref images
  const ranges = useMemo(() => beatRanges(beats), [beats])
  const beatImgs = useMemo(
    () => beats.map((b) => beatRefImage(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beats, project?.images, clip?.promptData.freeform]
  )

  // source preview defaults to MUTED per clip; keep the 🔊 icon synced if another player grabs audio
  useEffect(() => {
    if (vidRef.current) vidRef.current.muted = true
    setSmMuted(true)
  }, [url])
  useEffect(
    () =>
      subAudio(() => {
        if (vidRef.current) setSmMuted(vidRef.current.muted)
      }),
    []
  )
  // storyboard (no take video): "play" by walking a clock through the clip's beats
  useEffect(() => {
    if (url || !smPlaying) return
    let raf = 0
    const startWall = performance.now()
    const startPos = posRef.current
    const tick = (): void => {
      const t = startPos + (performance.now() - startWall) / 1000
      if (t >= fullDur) {
        setPos(fullDur)
        setSmPlaying(false)
        return
      }
      setPos(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, smPlaying, fullDur])
  // reset playhead + active beat when the previewed clip changes; commit any pending beat edit to the OLD
  // clip and DROP the draft so the new clip shows its OWN stored beats (never the previous clip's)
  useEffect(() => {
    flushBeats()
    draftClipRef.current = null
    posRef.current = 0
    if (sphRef.current) sphRef.current.style.left = '0%'
    if (beatPhRef.current) beatPhRef.current.style.left = '0%'
    if (tcRef.current) tcRef.current.textContent = smpte(0)
    setCurBeat(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id])
  // flush on unmount so a just-made beat edit isn't lost when the panel closes
  useEffect(() => () => flushBeats(), [])

  if (!clip || !project) {
    return (
      <div className="vd-panel vd-monitor">
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>double-click a timeline clip — or pick one in the Bin — to preview it here</span>
      </div>
    )
  }

  const declared = parseFloat(clip.promptData.duration) || 0
  const dur = vdur || declared || 5
  // in/out trim only applies to a timeline slot; a Bin preview is the whole clip
  const inSec = slotMode ? drag?.inSec ?? slot!.inSec ?? 0 : 0
  const outSec = slotMode ? drag?.outSec ?? slot!.outSec ?? (declared || dur) : declared || dur
  const takeNum = take ? clip.takes.findIndex((t) => t.id === take.id) + 1 : 0

  // beat machinery (mirror the timeline / program Monitor): per-beat thumbs + per-beat details (ranges/beatImgs memoized above)
  const stillFile = project.images.find((i) => i.id === clip.promptData.imageIds?.[0])?.file
  // storyboard (no rendered take): show the CURRENT beat's reference image, else the clip's keyframe still
  const storyImg = !url ? (beats[curBeat] ? beatImgs[curBeat] : undefined) ?? (stillFile ? mediaUrl(stillFile) : undefined) : undefined
  const tc = (n: number): string => `${Math.round(n * 100) / 100}s`
  const activeBeat = beats[curBeat]
  const overlayOn = smDetails || (!url && beats.length > 0) // auto-show beat details for unrendered clips

  // during a drag we update LOCAL state only; commit once on release (no per-mousemove IPC/disk write)
  const commit = (inS: number, outS: number): Promise<void> =>
    slotMode
      ? setTimelineItems(project.timeline.map((x, j) => (j === editTimelineIndex ? { ...x, inSec: inS, outSec: outS } : x)))
      : Promise.resolve()

  const onHandleDown = (side: 'in' | 'out', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    if (!bar) return
    let last = { inSec, outSec }
    const move = (ev: MouseEvent): void => {
      const r = bar.getBoundingClientRect()
      const t = Math.min(dur, Math.max(0, ((ev.clientX - r.left) / r.width) * dur))
      last =
        side === 'in'
          ? { inSec: Math.min(t, last.outSec - 0.25), outSec: last.outSec }
          : { inSec: last.inSec, outSec: Math.max(t, last.inSec + 0.25) }
      setDrag(last)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void commit(last.inSec, last.outSec).then(() => setDrag(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // drag the middle of the [in,out] band to slide the whole window (keeps its length)
  const onRegionDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    if (!bar) return
    const startX = e.clientX
    const startIn = inSec
    const len = outSec - inSec
    let last = { inSec, outSec }
    let moved = false
    const move = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true
      if (!moved) return
      document.body.style.cursor = 'grabbing' // feedback while sliding the window
      const r = bar.getBoundingClientRect()
      const delta = ((ev.clientX - startX) / r.width) * dur
      const nIn = Math.max(0, Math.min(startIn + delta, dur - len))
      last = { inSec: nIn, outSec: nIn + len }
      setDrag(last)
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      if (moved) {
        void commit(last.inSec, last.outSec).then(() => setDrag(null)) // dragged → slide the window
      } else {
        // plain click on the band → move the playhead there
        const v = vidRef.current
        const r = bar.getBoundingClientRect()
        const t = Math.min(dur, Math.max(0, ((ev.clientX - r.left) / r.width) * dur))
        if (v) v.currentTime = t // video → onTimeUpdate moves the head + beat
        else setPos(t) // storyboard → move head + beat directly
        setDrag(null)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const onBarDown = (e: React.MouseEvent): void => {
    const bar = barRef.current
    if (!bar) return
    const v = vidRef.current
    const seekTo = (clientX: number): void => {
      const r = bar.getBoundingClientRect()
      const t = Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur))
      if (v) v.currentTime = t // video → onTimeUpdate moves the head + beat
      else setPos(t) // storyboard → move head + beat directly
    }
    seekTo(e.clientX) // click = move the head
    const move = (ev: MouseEvent): void => seekTo(ev.clientX) // drag = scrub
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const togglePlay = (): void => {
    const v = vidRef.current
    if (v && url) {
      winRef.current = false // normal play = whole clip
      if (v.paused) void v.play()
      else v.pause()
      return
    }
    // storyboard: no video → toggle the beat hold-clock
    if (smPlaying) setSmPlaying(false)
    else {
      if (posRef.current >= fullDur - 0.05) setPos(0) // restart from the top if parked at the end
      setSmPlaying(true)
    }
  }
  const playWindow = (): void => {
    const v = vidRef.current
    if (v && url) {
      v.currentTime = inSec
      winRef.current = true // play only in→out, then stop
      void v.play()
      return
    }
    // storyboard: jump to the in-point and run the beat hold-clock
    setPos(inSec)
    setSmPlaying(true)
  }
  const toggleMute = (): void => {
    const v = vidRef.current
    if (!v) return
    if (v.muted) {
      focusAudio(v) // become the audio owner (mutes the others)
      setSmMuted(false)
    } else {
      v.muted = true
      setSmMuted(true)
    }
  }

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', background: '#000', height: '100%' }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {overlayOn && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              maxWidth: '72%',
              maxHeight: '82%',
              overflow: 'auto',
              zIndex: 4,
              background: 'rgba(0,0,0,.66)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '7px 9px',
              fontFamily: 'var(--mono)'
            }}
          >
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>
              {clipModelLine(clip)}
              {clipSeed(clip) != null ? ` · seed ${clipSeed(clip)}` : ''}
            </div>
            {activeBeat ? (
              <>
                <div style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 11 }}>
                  {clip.name} · beat {curBeat + 1}/{beats.length} — {activeBeat.name || 'shot'}
                </div>
                {ranges[curBeat] && (
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                    {tc(ranges[curBeat].start)} – {tc(ranges[curBeat].end)}
                  </div>
                )}
                {activeBeat.camera && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 3 }}>camera: {activeBeat.camera}</div>}
                {activeBeat.action && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 2 }}>action: {activeBeat.action}</div>}
                {activeBeat.lighting && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 2 }}>lighting: {activeBeat.lighting}</div>}
                {(['dialogue', 'vfx', 'reaction', 'sfx'] as const).map((k) =>
                  activeBeat[k] ? (
                    <div key={k} style={{ fontSize: 10, color: '#cfcfd6', marginTop: 2 }}>
                      {k}: {activeBeat[k]}
                    </div>
                  ) : null
                )}
              </>
            ) : (
              <>
                <div style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 11 }}>{clip.name}</div>
                {clip.promptData.scene.style && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 3 }}>style: {clip.promptData.scene.style}</div>}
                {clip.promptData.scene.visualFeel && <div style={{ fontSize: 10, color: '#e8e8ee', marginTop: 2 }}>feel: {clip.promptData.scene.visualFeel}</div>}
                {clip.promptData.freeform && <div style={{ fontSize: 10, color: '#cfcfd6', marginTop: 3 }}>{clip.promptData.freeform.slice(0, 200)}</div>}
              </>
            )}
          </div>
        )}
        {url ? (
          <video
            ref={vidRef}
            src={url}
            onClick={togglePlay}
            onLoadedMetadata={(e) => setVdur(e.currentTarget.duration || 0)}
            onPlay={(e) => {
              setSmPlaying(true)
              if (!e.currentTarget.muted) focusAudio(e.currentTarget)
            }}
            onPause={() => setSmPlaying(false)}
            onVolumeChange={(e) => {
              const v = e.currentTarget
              if (!v.muted) focusAudio(v)
              setSmMuted(v.muted)
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              // moves the source playhead imperatively (no per-frame React state) + tracks the active beat
              setPos(v.currentTime)
              // when playing only the in→out window, stop at the out-point
              if (winRef.current && v.currentTime >= outSec - 0.03) {
                v.pause()
                winRef.current = false
              }
            }}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'pointer' }}
          />
        ) : storyImg ? (
          <img src={storyImg} alt="" onClick={togglePlay} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#000', cursor: 'pointer' }} />
        ) : (
          <span style={{ color: 'var(--dim)', fontSize: 12 }}>no rendered take for this clip yet</span>
        )}
      </div>
      <div style={{ padding: '6px 8px', background: '#0c0c0f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span className="btn vd-hbtn" onClick={togglePlay} title="play / pause">{smPlaying ? '⏸' : '▶'}</span>
          <span className="btn vd-hbtn" onClick={playWindow} title="play the in→out window">▶▮ in→out</span>
          <span className="btn vd-hbtn" onClick={toggleMute} title="mute / unmute">{smMuted ? '🔇' : '🔊'}</span>
          <span className="btn vd-hbtn" style={{ marginLeft: 'auto', opacity: overlayOn ? 1 : 0.6 }} onClick={() => setSmDetails((v) => !v)} title="model / clip / beat details">
            ℹ details
          </span>
        </div>
        {/* live timecode (frames @ 24fps) — current set imperatively, total derived */}
        <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: '#e8e8ee', letterSpacing: 0.5, marginBottom: 4 }}>
          <span ref={tcRef} />
          <span style={{ color: 'var(--dim)', fontSize: 11 }}> / {smpte(dur)}</span>
        </div>
        <div ref={barRef} onMouseDown={onBarDown} style={{ position: 'relative', height: 22, background: '#1a1a20', borderRadius: 4, cursor: 'pointer', overflow: 'hidden' }} title="click / drag to scrub the source">
          {/* per-beat bands + reference thumbnails, like the timeline block */}
          {beats.length > 0 &&
            ranges.map((r, i) => (
              <div
                key={i}
                title={beats[i].name || `beat ${i + 1}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(r.start / dur) * 100}%`,
                  width: `${((r.end - r.start) / dur) * 100}%`,
                  background: beatImgs[i] ? `#0e0e12 center/contain no-repeat url("${beatImgs[i]}")` : BEAT_COLORS[i % BEAT_COLORS.length],
                  opacity: beatImgs[i] ? 1 : 0.4,
                  boxShadow: 'inset -1px 0 0 0 rgba(0,0,0,.45)',
                  zIndex: 1,
                  pointerEvents: 'none' // PURELY VISUAL — beats are selected/edited only in the block below; the bar just scrubs
                }}
              />
            ))}
          {/* in/out region: NON-interactive (pointerEvents none) so a click anywhere here still scrubs/previews that frame */}
          <div
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${(inSec / dur) * 100}%`, width: `${((outSec - inSec) / dur) * 100}%`, background: 'rgba(231,169,60,.22)', borderLeft: '2px solid var(--amber)', borderRight: '2px solid var(--amber)', pointerEvents: 'none', zIndex: 2 }}
          />
          {slotMode && (
            <>
              <div onMouseDown={(e) => onHandleDown('in', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(inSec / dur) * 100}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`in ${inSec.toFixed(2)}s`} />
              <div onMouseDown={(e) => onHandleDown('out', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(outSec / dur) * 100}%`, width: 10, marginLeft: -5, cursor: 'ew-resize', zIndex: 3 }} title={`out ${outSec.toFixed(2)}s`} />
              {/* grab handle in the MIDDLE of the region — only THIS slides the window; everywhere else seeks */}
              <div
                onMouseDown={onRegionDown}
                title="grab to slide the in/out window"
                style={{ position: 'absolute', left: `${((inSec + outSec) / 2 / dur) * 100}%`, top: '50%', transform: 'translate(-50%, -50%)', height: 16, minWidth: 22, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', zIndex: 4, color: '#15151a', background: 'var(--amber)', borderRadius: 8, fontSize: 11, fontWeight: 700, lineHeight: 1, userSelect: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' }}
              >
                ↔
              </div>
            </>
          )}
          <div ref={sphRef} style={{ position: 'absolute', top: 0, bottom: 0, left: '0%', width: 2, background: '#fff', pointerEvents: 'none' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 3 }}>
          <span>in {inSec.toFixed(2)}s</span>
          <span style={{ color: 'var(--muted)' }}>
            {clip.name}
            {takeNum ? ` · take ${takeNum}/${clip.takes.length}` : ''}
            {slotMode ? ` · #${editTimelineIndex! + 1}` : ' · bin'}
          </span>
          <span>out {outSec.toFixed(2)}s</span>
        </div>
      </div>
      {/* editable beats timeline — ONLY when the clip already has beats (the monitor never creates the first
          beat; that's done in the Clip Editor). Fully editable per the user's choice. */}
      {beats.length > 0 && (
        <div className="vd-scroll" style={{ flex: '0 1 auto', maxHeight: '45%', overflowY: 'auto', borderTop: '1px solid var(--line)', background: '#0c0c0f', padding: '2px 8px 8px' }}>
          <Beats key={clip.id} beats={beats} duration={beatsBarDur} onChange={persistBeats} refImageUrl={beatRefImage} titles={project.images.map((i) => i.title)} playheadRef={beatPhRef} showAutoTime={false} />
        </div>
      )}
    </div>
  )
}

// ---- filmstrip cache: each video file is sampled ONCE; display is resampled from the cache ----
const STRIP_H = 90 // capture height; width is derived from the source aspect so frames are never stretched
const STRIP_SAMPLES = 20 // frames sampled across the full clip, once per file
type Strip = { dur: number; ts: number[]; frames: string[]; aspect: number }
const STRIP_CACHE = new Map<string, Strip>()
const STRIP_INFLIGHT = new Map<string, Promise<Strip | null>>()

async function extractStrip(file: string): Promise<Strip | null> {
  const b = await window.vidancer.mediaRead(file)
  if (!b) return null
  const objUrl = URL.createObjectURL(new Blob([b as unknown as BlobPart], { type: 'video/mp4' }))
  try {
    const video = document.createElement('video')
    video.muted = true
    video.src = objUrl
    await new Promise<void>((res) => {
      video.onloadedmetadata = () => res()
      video.onerror = () => res()
    })
    const dur = video.duration || 0
    if (!dur) return null
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
    const W = Math.max(1, Math.round(STRIP_H * aspect))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = STRIP_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const ts: number[] = []
    const frames: string[] = []
    for (let i = 0; i < STRIP_SAMPLES; i++) {
      const t = Math.min(dur - 0.01, Math.max(0, ((i + 0.5) / STRIP_SAMPLES) * dur))
      await new Promise<void>((res) => {
        const onSeeked = (): void => {
          video.removeEventListener('seeked', onSeeked)
          res()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = t
      })
      try {
        ctx.drawImage(video, 0, 0, W, STRIP_H)
        frames.push(canvas.toDataURL('image/jpeg', 0.6))
        ts.push(t)
      } catch {
        /* skip frame */
      }
    }
    return frames.length ? { dur, ts, frames, aspect } : null
  } finally {
    URL.revokeObjectURL(objUrl)
  }
}

function ensureStrip(file: string): Promise<Strip | null> {
  const cached = STRIP_CACHE.get(file)
  if (cached) return Promise.resolve(cached)
  let p = STRIP_INFLIGHT.get(file)
  if (!p) {
    p = extractStrip(file).then((s) => {
      if (s) STRIP_CACHE.set(file, s)
      STRIP_INFLIGHT.delete(file)
      return s
    })
    STRIP_INFLIGHT.set(file, p)
  }
  return p
}

// `count` thumbnails windowed to [inSec,outSec], resampled from the per-file cache (extracted once).
// Resizing/trimming only recomputes the cheap nearest-frame selection — never re-reads the video.
// load (once) the cached strip for a file; `enabled` gates extraction (thumbnails-off → skip)
function useStrip(file: string | undefined, enabled: boolean): Strip | null {
  const [strip, setStrip] = useState<Strip | null>(() => (file ? STRIP_CACHE.get(file) ?? null : null))
  useEffect(() => {
    if (!file || !enabled) {
      setStrip(null)
      return
    }
    const cached = STRIP_CACHE.get(file)
    if (cached) {
      setStrip(cached)
      return
    }
    let alive = true
    void ensureStrip(file).then((s) => {
      if (alive) setStrip(s)
    })
    return () => {
      alive = false
    }
  }, [file, enabled])
  return strip
}

// pick `count` frames windowed to [inSec,outSec] from the cached strip (nearest by timestamp)
function sampleStrip(strip: Strip | null, count: number, inSec?: number, outSec?: number): string[] {
  if (!strip || count < 1) return []
  const lo = Math.max(0, inSec ?? 0)
  const hi = Math.min(strip.dur, outSec ?? strip.dur)
  const span = Math.max(0.01, hi - lo)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const t = lo + ((i + 0.5) / count) * span
    let best = 0
    let bd = Infinity
    for (let j = 0; j < strip.ts.length; j++) {
      const d = Math.abs(strip.ts[j] - t)
      if (d < bd) {
        bd = d
        best = j
      }
    }
    out.push(strip.frames[best])
  }
  return out
}

// ---- one timeline block (filmstrip of frames from the clip's take) ----
function TlBlock(props: {
  flex: number
  current: boolean
  dropActive: boolean
  name: string
  durLabel: string
  takeLabel: string
  takes: { id: string; label: string }[]
  currentTakeId?: string
  onPickTake: (takeId: string) => void
  file?: string
  videoFile?: string
  seconds: number
  inSec?: number
  outSec?: number
  beats?: BeatField[]
  beatImgs?: (string | undefined)[]
  onTrimStart: (side: 'in' | 'out', e: React.MouseEvent) => void
  onClick: () => void
  onDoubleClick: () => void
  onRemove: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  // measure the block; frames show at their TRUE aspect (never stretched) and we pack enough of them
  // to fill the width — so the "gaps" between frames are filled by more frames, not letterboxing.
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      const w = Math.round(r?.width ?? 0)
      const h = Math.round(r?.height ?? 0)
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const showFilmstrip = useStore((s) => s.showFilmstrips)
  const strip = useStrip(props.videoFile, !!props.videoFile && showFilmstrip)
  const aspect = strip?.aspect ?? 16 / 9
  const frameW = size.h * aspect // each frame's on-screen width at the block's height (true aspect)
  const count = size.w > 0 && frameW > 0 ? Math.max(1, Math.min(40, Math.ceil(size.w / frameW))) : 0
  const frames = useMemo(() => sampleStrip(strip, count, props.inSec, props.outSec), [strip, count, props.inSec, props.outSec])
  const fallbackUrl = useThumbUrl(showFilmstrip && !props.videoFile ? props.file : undefined)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <div
      ref={wrapRef}
      className={'vd-clip' + (props.current ? ' sel' : '')}
      style={{
        flex: props.flex,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 44,
        borderLeft: props.dropActive ? '3px solid var(--amber)' : undefined,
        outline: !props.videoFile ? '1px dashed var(--amber-dim)' : undefined,
        outlineOffset: -1
      }}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      title="double-click to edit · drag to reorder"
    >
      {frames.length > 1 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          {frames.map((f, i) => (
            <img key={i} src={f} alt="" style={{ height: '100%', width: 'auto', flex: '0 0 auto', objectFit: 'contain', opacity: 0.6 }} />
          ))}
        </div>
      ) : frames.length === 1 ? (
        <img src={frames[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.6 }} />
      ) : fallbackUrl ? (
        <img src={fallbackUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.55 }} />
      ) : null}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.2))' }} />
      <div style={{ position: 'absolute', top: 3, left: 5, right: 16, fontSize: 10, color: '#fff', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', zIndex: 5 }}>
        {props.name}
      </div>
      <div
        style={{ position: 'absolute', top: 17, left: 5, fontSize: 9, color: 'var(--muted)', cursor: 'pointer', textShadow: '0 1px 2px #000', zIndex: 5 }}
        onClick={(e) => {
          e.stopPropagation()
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
        title="pick this instance's take"
      >
        {props.takeLabel} ▾
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 5, fontSize: 9, color: '#cfcfd6', textShadow: '0 1px 2px #000', zIndex: 5 }}>
        {props.videoFile ? '▶' : '▦'} {props.durLabel}
      </div>
      {props.beats &&
        props.beats.length > 0 &&
        (() => {
          // the in/out trim CLIPS the clip; beats keep their absolute positions and are windowed to [in,out]
          const inS = props.inSec ?? 0
          const winLen = Math.max(0.0001, props.seconds) // effective (trimmed) duration
          const outS = inS + winLen
          const ranges = beatRanges(props.beats)
          const vis: { i: number; name: string; img?: string; left: number; width: number }[] = []
          props.beats.forEach((b, i) => {
            const vs = Math.max(ranges[i].start, inS)
            const ve = Math.min(ranges[i].end, outS)
            if (ve <= vs) return
            vis.push({ i, name: b.name, img: props.beatImgs?.[i], left: ((vs - inS) / winLen) * 100, width: ((ve - vs) / winLen) * 100 })
          })
          return (
            <>
              {/* each visible beat's reference image, over its (clipped) span above the band */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 6, zIndex: 2, pointerEvents: 'none' }}>
                {vis.map((v) =>
                  v.img ? (
                    <div key={v.i} title={v.name} style={{ position: 'absolute', top: 0, bottom: 0, left: `${v.left}%`, width: `${v.width}%`, background: `center/contain no-repeat url("${v.img}")` }} />
                  ) : null
                )}
              </div>
              {/* colored beat bands at the bottom — the cut-structure indicator, clipped to the trim window */}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, zIndex: 4, pointerEvents: 'none' }}>
                {vis.map((v) => (
                  <div key={v.i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${v.left}%`, width: `${v.width}%`, background: BEAT_COLORS[v.i % BEAT_COLORS.length], boxShadow: 'inset -1px 0 0 0 rgba(0,0,0,.45)' }} />
                ))}
              </div>
            </>
          )
        })()}
      <span
        style={{ position: 'absolute', top: 1, right: 4, cursor: 'pointer', color: '#fff', textShadow: '0 1px 2px #000' }}
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
      >
        ✕
      </span>
      <div
        onMouseDown={(e) => props.onTrimStart('in', e)}
        onClick={(e) => e.stopPropagation()}
        title="drag to trim start"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(90deg, rgba(231,169,60,.55), transparent)' }}
      />
      <div
        onMouseDown={(e) => props.onTrimStart('out', e)}
        onClick={(e) => e.stopPropagation()}
        title="drag to trim end"
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', zIndex: 6, background: 'linear-gradient(270deg, rgba(231,169,60,.55), transparent)' }}
      />
      {menuPos &&
        createPortal(
          <div onClick={() => setMenuPos(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: menuPos.x, top: menuPos.y, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 6, padding: 4, minWidth: 96, maxHeight: 220, overflow: 'auto' }}
            >
              {props.takes.length === 0 && <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--dim)' }}>no takes</div>}
              {props.takes.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    props.onPickTake(t.id)
                    setMenuPos(null)
                  }}
                  style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: t.id === props.currentTakeId ? 'var(--amber)' : '#cfcfd6' }}
                >
                  {t.label}
                  {t.id === props.currentTakeId ? ' ✓' : ''}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

// playhead lives in its own component so ONLY it re-renders on the per-frame tlProgress updates,
// not the whole TimelinePanel + every TlBlock (that was the playback lag)
function Playhead({ segs, total }: { segs: { start: number; dur: number }[]; total: number }): React.JSX.Element | null {
  const tlIndex = useStore((s) => s.tlIndex)
  const tlProgress = useStore((s) => s.tlProgress)
  if (segs.length === 0) return null
  const seg = segs[Math.min(tlIndex, segs.length - 1)] ?? { start: 0, dur: 0 }
  const pct = Math.min(100, ((seg.start + tlProgress * seg.dur) / total) * 100)
  return (
    <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--amber)', left: `${pct}%`, pointerEvents: 'none', zIndex: 5 }} />
  )
}

// live sequence timecode (current / total) — its OWN per-frame subscriber so the parent panel doesn't re-render
function TimeReadout({ segs, total, style }: { segs: { start: number; dur: number }[]; total: number; style?: React.CSSProperties }): React.JSX.Element {
  const tlIndex = useStore((s) => s.tlIndex)
  const tlProgress = useStore((s) => s.tlProgress)
  const seg = segs[Math.min(tlIndex, segs.length - 1)] ?? { start: 0, dur: 0 }
  const cur = segs.length ? seg.start + tlProgress * seg.dur : 0
  return (
    <span className="vd-tc" style={{ fontFamily: 'var(--mono)', ...style }}>
      {smpte(cur)} <span style={{ color: 'var(--dim)' }}>/ {smpte(total)}</span>
    </span>
  )
}

// ---- Timeline: ruler/scrubber + track of clip instances + playhead ----
export function TimelinePanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const tlIndex = useStore((s) => s.tlIndex)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const tlLoop = useStore((s) => s.tlLoop)
  const showFilmstrips = useStore((s) => s.showFilmstrips)
  const toggleFilmstrips = useStore((s) => s.toggleFilmstrips)
  const tlPlay = useStore((s) => s.tlPlay)
  const tlPause = useStore((s) => s.tlPause)
  const tlSetIndex = useStore((s) => s.tlSetIndex)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const seek = useStore((s) => s.seek)
  const addToTimeline = useStore((s) => s.addToTimeline)
  const setTimelineItems = useStore((s) => s.setTimelineItems)
  const editTimelineSlot = useStore((s) => s.editTimelineSlot)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const [dragTrim, setDragTrim] = useState<{ index: number; inSec: number; outSec: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const trimming = useRef(false)

  const timeline = project?.timeline ?? []
  // during an edge-trim drag, override the dragged item's in/out LOCALLY (no store write) for live preview
  const viewTimeline = dragTrim
    ? timeline.map((it, i) => (i === dragTrim.index ? { ...it, inSec: dragTrim.inSec, outSec: dragTrim.outSec } : it))
    : timeline
  const clips = project?.clips ?? []
  const durOf = (clipId: string): number => {
    const c = clips.find((x) => x.id === clipId)
    const d = parseFloat(c?.promptData.duration ?? '5')
    return Number.isNaN(d) || d <= 0 ? 5 : d
  }
  const inOf = (it: TimelineItem): number => it.inSec ?? 0
  const outOf = (it: TimelineItem): number => it.outSec ?? durOf(it.clipId)
  const effDur = (it: TimelineItem): number => Math.max(0.25, outOf(it) - inOf(it))
  const nameOf = (clipId: string): string => clips.find((c) => c.id === clipId)?.name ?? '?'
  const beatsOf = (clipId: string): BeatField[] => clips.find((c) => c.id === clipId)?.promptData.beats ?? []
  const beatImgsOf = (clipId: string): (string | undefined)[] => {
    const c = clips.find((x) => x.id === clipId)
    if (!c) return []
    return c.promptData.beats.map((b) => {
      const f = beatRefFile(b, c.promptData.freeform, project?.images ?? [])
      return f ? mediaUrl(f) : undefined
    })
  }
  const firstImageOf = (clipId: string): string | undefined => {
    const c = clips.find((x) => x.id === clipId)
    const id = c?.promptData.imageIds?.[0]
    return id ? project?.images.find((i) => i.id === id)?.file : undefined
  }
  const takeFileOf = (it: TimelineItem): string | undefined => {
    const c = clips.find((x) => x.id === it.clipId)
    if (!c || c.takes.length === 0) return undefined
    const id = it.takeId ?? c.keeperTakeId ?? c.takes[c.takes.length - 1].id
    return c.takes.find((t) => t.id === id)?.file
  }
  const effTakeIdx = (it: TimelineItem): { idx: number; count: number } => {
    const c = clips.find((x) => x.id === it.clipId)
    if (!c || c.takes.length === 0) return { idx: -1, count: 0 }
    const curId = it.takeId ?? c.keeperTakeId ?? c.takes[c.takes.length - 1].id
    return { idx: Math.max(0, c.takes.findIndex((t) => t.id === curId)), count: c.takes.length }
  }
  const takeLabel = (it: TimelineItem): string => {
    const { idx, count } = effTakeIdx(it)
    return idx < 0 ? 'no take' : `take ${idx + 1}${count > 1 ? ' / ' + count : ''}`
  }
  const takesOf = (clipId: string): { id: string; label: string }[] =>
    (clips.find((c) => c.id === clipId)?.takes ?? []).map((t, i) => ({ id: t.id, label: `take ${i + 1}` }))
  const curTakeId = (it: TimelineItem): string | undefined => {
    const c = clips.find((x) => x.id === it.clipId)
    if (!c || c.takes.length === 0) return undefined
    return it.takeId ?? c.keeperTakeId ?? c.takes[c.takes.length - 1].id
  }
  const pickTake = (index: number, takeId: string): void =>
    void setTimelineItems(timeline.map((x, j) => (j === index ? { ...x, takeId } : x)))

  const total = viewTimeline.reduce((s, it) => s + effDur(it), 0) || 1
  let segAcc = 0
  const segs = viewTimeline.map((it) => {
    const d = effDur(it)
    const seg = { start: segAcc, dur: d }
    segAcc += d
    return seg
  })

  const step = total <= 12 ? 1 : total <= 40 ? 5 : total <= 120 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(Math.round(t))

  const reorderMove = (from: number, to: number): void => {
    if (from === to || Number.isNaN(from)) return
    const arr = [...timeline]
    const [m] = arr.splice(from, 1)
    arr.splice(from < to ? to - 1 : to, 0, m)
    void setTimelineItems(arr)
  }
  const reorderToEnd = (from: number): void => {
    if (Number.isNaN(from)) return
    const arr = [...timeline]
    const [m] = arr.splice(from, 1)
    arr.push(m)
    void setTimelineItems(arr)
  }
  const onTrackDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropIdx(null)
    // a take dragged from the clip editor → add that clip with the take preset as this instance's default
    const takeData = e.dataTransfer.getData('application/x-vd-take')
    if (takeData) {
      try {
        const o = JSON.parse(takeData) as { clipId?: string; takeId?: string }
        if (o.clipId) void addToTimeline(o.clipId, o.takeId)
      } catch {
        /* ignore */
      }
      return
    }
    const clipId = e.dataTransfer.getData('text/plain')
    if (clipId) {
      void addToTimeline(clipId)
      return
    }
    const tlIdx = e.dataTransfer.getData('application/x-vd-tlitem')
    if (tlIdx !== '') reorderToEnd(parseInt(tlIdx, 10))
  }

  const seekFromClientX = (clientX: number): void => {
    const el = wrapRef.current
    if (!el || viewTimeline.length === 0) return
    const r = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const time = frac * total
    let a = 0
    for (let i = 0; i < viewTimeline.length; i++) {
      const d = effDur(viewTimeline[i])
      if (time < a + d || i === viewTimeline.length - 1) {
        const offset = Math.max(0, Math.min(d, time - a))
        seek(i, offset, d ? offset / d : 0)
        return
      }
      a += d
    }
  }
  const onScrubDown = (e: React.MouseEvent): void => {
    seekFromClientX(e.clientX)
    const move = (ev: MouseEvent): void => seekFromClientX(ev.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onTrimStart = (index: number, side: 'in' | 'out', e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const el = wrapRef.current
    const proj = project
    if (!el || !proj) return
    const startX = e.clientX
    const secPerPx = total / el.getBoundingClientRect().width // captured at drag start (stable)
    const it0 = proj.timeline[index]
    const startIn = it0.inSec ?? 0
    const startOut = it0.outSec ?? durOf(it0.clipId)
    const src = durOf(it0.clipId)
    trimming.current = true
    let final = { inSec: startIn, outSec: startOut }
    const move = (ev: MouseEvent): void => {
      const dSec = (ev.clientX - startX) * secPerPx
      final =
        side === 'in'
          ? { inSec: Math.min(Math.max(0, startIn + dSec), startOut - 0.25), outSec: startOut }
          : { inSec: startIn, outSec: Math.max(Math.min(src, startOut + dSec), startIn + 0.25) }
      setDragTrim({ index, ...final }) // LOCAL preview only — no store write, no app-wide re-render
    }
    const up = (): void => {
      trimming.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void setTimelineItems(
        proj.timeline.map((x, j) => (j === index ? { ...x, inSec: final.inSec, outSec: final.outSec } : x))
      ).then(() => setDragTrim(null)) // persist once, then drop the local override
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="vd-panel vd-timeline">
      <div className="vd-transport">
        <span onClick={() => tlSetIndex(Math.max(0, tlIndex - 1))}>⏮</span>
        <span className="vd-play" onClick={() => (tlPlaying ? tlPause() : tlPlay())}>{tlPlaying ? '⏸' : '▶'}</span>
        <span onClick={() => tlSetIndex(Math.min(timeline.length - 1, tlIndex + 1))}>⏭</span>
        <span className="vd-loop" style={{ opacity: tlLoop ? 1 : 0.4 }} onClick={toggleLoop}>⟲</span>
        <span
          className="vd-loop"
          style={{ opacity: showFilmstrips ? 1 : 0.4 }}
          onClick={toggleFilmstrips}
          title={showFilmstrips ? 'thumbnails on — click for faster plain blocks' : 'thumbnails off (faster)'}
        >
          🎞
        </span>
        <span className="vd-tc">{timeline.length} clips</span>
        <TimeReadout segs={segs} total={total} />
      </div>

      <div ref={wrapRef} style={{ position: 'relative' }}>
        <div
          onMouseDown={onScrubDown}
          style={{ position: 'relative', height: 16, borderBottom: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', background: '#0c0c0f' }}
          title="click or drag to scrub"
        >
          {ticks.map((t) => (
            <div
              key={t}
              style={{ position: 'absolute', left: `${(t / total) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--line2)', paddingLeft: 2, fontSize: 8, color: 'var(--dim)' }}
            >
              {t}s
            </div>
          ))}
        </div>

        <div
          className="vd-track"
          onDragOver={(e) => {
            const t = e.dataTransfer.types
            if (t.includes('text/plain') || t.includes('application/x-vd-tlitem') || t.includes('application/x-vd-take'))
              e.preventDefault()
          }}
          onDrop={onTrackDrop}
          style={{ position: 'relative', padding: '4px 0', gap: 0 }}
        >
          {timeline.length === 0 && (
            <span className="vd-sm" style={{ color: 'var(--dim)', alignSelf: 'center', margin: 'auto' }}>drag clips from the Bin here →</span>
          )}
          {viewTimeline.map((it, i) => (
            <TlBlock
              key={`${it.id}-${i}`}
              flex={effDur(it)}
              current={i === tlIndex}
              dropActive={dropIdx === i}
              name={nameOf(it.clipId)}
              durLabel={`${Math.round(effDur(it) * 100) / 100}s`}
              takeLabel={takeLabel(it)}
              takes={takesOf(it.clipId)}
              currentTakeId={curTakeId(it)}
              onPickTake={(takeId) => pickTake(i, takeId)}
              file={firstImageOf(it.clipId)}
              videoFile={takeFileOf(it)}
              seconds={effDur(it)}
              inSec={it.inSec}
              outSec={it.outSec}
              beats={beatsOf(it.clipId)}
              beatImgs={beatImgsOf(it.clipId)}
              onTrimStart={(side, e) => onTrimStart(i, side, e)}
              onClick={() => tlSetIndex(i)}
              onDoubleClick={() => editTimelineSlot(i, it.clipId)}
              onRemove={() => void setTimelineItems(timeline.filter((_, j) => j !== i))}
              onDragStart={(e) => {
                if (trimming.current) {
                  e.preventDefault()
                  return
                }
                e.dataTransfer.setData('application/x-vd-tlitem', String(i))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-vd-tlitem')) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropIdx(i)
                }
              }}
              onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
              onDrop={(e) => {
                const f = e.dataTransfer.getData('application/x-vd-tlitem')
                if (f !== '') {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropIdx(null)
                  reorderMove(parseInt(f, 10), i)
                }
              }}
            />
          ))}
        </div>

        {timeline.length > 0 && <Playhead segs={segs} total={total} />}
      </div>

      <p className="vd-hint">Click/drag the ruler to scrub · drag blocks to reorder · click `take N` to switch · double-click to edit.</p>
    </div>
  )
}
