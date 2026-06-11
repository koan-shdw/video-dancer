import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useMediaUrl } from '../Thumbnail'
import { mediaUrl } from '../media'
import { focusAudio, subAudio } from '../audioBus'
import { BEAT_COLORS, beatRanges } from '../emitYaml'
import { beatAtTime, beatRefImageUrl } from '../lib/beatUtils'
import { clipModelLine, clipSeed } from '../lib/clipMeta'
import { smpte } from '../lib/time'
import { Beats } from './Beats'

// ---- Clip Monitor: the double-clicked timeline clip + an in/out source timeline ----
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
  // the slot's "C" view (useRecipe) forces the live recipe — no take, storyboard-style preview
  const take = clip && !slot?.useRecipe
    ? (slot?.takeId ? clip.takes.find((t) => t.id === slot.takeId) : undefined) ??
      clip.takes.find((t) => t.id === clip.keeperTakeId) ??
      clip.takes[clip.takes.length - 1]
    : undefined
  const url = useMediaUrl(take?.file)
  // ANY take view is an immutable record: it shows ONLY the beats frozen at render time — a take
  // rendered before beats existed (or pre-snapshot) shows NONE. Editing happens on the recipe (C).
  const frozen = !!take

  // `beats` = (take view) the frozen snapshot's beats · (recipe view) our edit draft IF it belongs to
  // THIS clip, else the clip's stored beats. The draft check is per-render → no cross-clip leaks.
  const [beatsDraft, setBeatsDraft] = useState<BeatField[]>([])
  const draftClipRef = useRef<string | null>(null) // which clip beatsDraft belongs to
  const pendingBeatsRef = useRef<{ id: string; beats: BeatField[] } | null>(null)
  const beatTimerRef = useRef<number | undefined>(undefined)
  const recipeBeats = draftClipRef.current === clip?.id ? beatsDraft : (clip?.promptData.beats ?? [])
  const beats = frozen ? take.snapshot?.beats ?? [] : recipeBeats
  const beatFreeform = frozen ? take.snapshot?.freeform ?? '' : (clip?.promptData.freeform ?? '')
  // source length of the ACTIVE view: video metadata when playing a take; else the take's known real
  // length; else the (snapshot's or recipe's) duration setting. vdur is ignored without a video url —
  // it's stale metadata from a previously shown take.
  const declaredDur = (pd?: PromptData): number => (pd ? parseFloat(pd.duration) || 5 : 5)
  const viewDur = take ? take.durationSec ?? declaredDur(take.snapshot ?? clip?.promptData) : declaredDur(clip?.promptData)
  const fullDur = (url ? vdur : 0) || viewDur
  // the beats bar spans this duration (matches Beats.tsx: view duration → beats sum → 5)
  const beatsSum = beats.reduce((s, b) => s + (b.length || 0), 0)
  const beatsBarDur = viewDur > 0 ? viewDur : beatsSum > 0 ? beatsSum : 5
  const beatRefImage = (b: BeatField): string | undefined => beatRefImageUrl(b, beatFreeform, project?.images ?? [])
  // move the playhead + active beat (imperative playhead + timecode so playback doesn't re-render per frame)
  const setPos = (t: number): void => {
    posRef.current = t
    if (sphRef.current) sphRef.current.style.left = `${(t / fullDur) * 100}%`
    if (beatPhRef.current) beatPhRef.current.style.left = `${Math.min(100, Math.max(0, (t / beatsBarDur) * 100))}%`
    if (tcRef.current) tcRef.current.textContent = smpte(t)
    setCurBeat((c) => {
      const bi = beatAtTime(beats, t)
      return c === bi ? c : bi
    })
  }
  // the Clip Monitor owns ONLY beats. It must NOT write imageIds: the Clip Editor owns the reference list, and
  // a concurrent imageIds write here would race its shallow-merge save and drop refs. saveClipPromptData merges,
  // so sending just {beats} preserves the Editor's prompt/refs/seed. (@ref→ref linkage stays in the Editor.)
  const saveBeats = (id: string, next: BeatField[]): Promise<void> => saveClipPromptData(id, { beats: next })
  // edit a beat → instant local draft + debounced merge-save; on settle, drop the draft so external (Clip
  // Editor) edits get adopted again. Frozen take views never write (takes are immutable).
  const persistBeats = (next: BeatField[]): void => {
    if (!clip || frozen) return
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
    setVdur(0) // metadata belongs to the previous clip's video
    if (sphRef.current) sphRef.current.style.left = '0%'
    if (beatPhRef.current) beatPhRef.current.style.left = '0%'
    if (tcRef.current) tcRef.current.textContent = smpte(0)
    setCurBeat(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id])
  // flush on unmount so a just-made beat edit isn't lost when the panel closes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushBeats(), [])

  if (!clip || !project) {
    return (
      <div className="vd-panel vd-monitor">
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>double-click a timeline clip — or pick one in the Bin — to preview it here</span>
      </div>
    )
  }

  const dur = fullDur // source length of the active view (take's real length, or the recipe setting)
  // in/out trim only applies to a TAKE timeline slot — a C (recipe) slot always spans the full live
  // duration, and a Bin preview is the whole clip. Clamp to the view's length so switching to a
  // shorter take can't leave the window past the end.
  const slotTrim = slotMode && !slot?.useRecipe
  const inSec = slotTrim ? drag?.inSec ?? slot!.inSec ?? 0 : 0
  const outSec = Math.min(slotTrim ? drag?.outSec ?? slot!.outSec ?? dur : dur, dur)
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
    slotTrim
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
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration || 0
              setVdur(d)
              // backfill the take's ACTUAL length the first time we learn it (drives timeline block length)
              if (take && d > 0) useStore.getState().reportTakeDuration(clip.id, take.id, d)
            }}
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
          {slotTrim && (
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
            {takeNum ? ` · take ${takeNum}/${clip.takes.length}` : slot?.useRecipe ? ' · C (live recipe)' : ''}
            {slotMode ? ` · #${editTimelineIndex! + 1}` : ' · bin'}
          </span>
          <span>out {outSec.toFixed(2)}s</span>
        </div>
      </div>
      {/* beats timeline — ONLY when the view has beats (the monitor never creates the first beat; that's
          the Clip Editor's job). Editable for the live recipe; FROZEN (read-only) when showing a take. */}
      {beats.length > 0 && (
        <div className="vd-scroll" style={{ flex: '0 1 auto', maxHeight: '45%', overflowY: 'auto', borderTop: '1px solid var(--line)', background: '#0c0c0f', padding: '2px 8px 8px' }}>
          {frozen && (
            <div style={{ fontSize: 9, color: 'var(--dim)', padding: '4px 2px 0' }}>
              ❄ take {takeNum} beats — frozen with the render · switch to C to edit the live recipe
            </div>
          )}
          <div style={frozen ? { pointerEvents: 'none', opacity: 0.75 } : undefined}>
            <Beats
              key={clip.id + ':' + (frozen ? take!.id : 'C')}
              beats={beats}
              duration={beatsBarDur}
              onChange={persistBeats}
              refImageUrl={beatRefImage}
              titles={project.images.map((i) => i.title)}
              playheadRef={beatPhRef}
              showAutoTime={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
