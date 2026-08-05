import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { focusAudio } from '../audioBus'
import { beatAtTime, beatRefImageUrl } from '../lib/beatUtils'
import { resolveView, activeItems, activeTimeline, audioStartOf, itemAt, nextBoundary, startOf, effDur, sourceTimeAt, timelineEnd, sourceDurOf } from '../lib/timelineUtils'
import { clipModelLine, clipSeed } from '../lib/clipMeta'
import { framePngBytes } from '../lib/frameGrab'
import { smpte } from '../lib/time'

// one detached clip-audio block, kept in sync with the GLOBAL CLOCK — free-run, hard-correct
// only on drift (no per-frame seeks, no stutter). Gain + fades applied via element volume.
function AudioItemPlayer({ a, start, file, playing, muted }: {
  a: TimelineAudioItem
  start: number
  file: string
  playing: boolean
  muted: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const m = ref.current
    if (m) m.muted = muted
  }, [muted, file])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    if (!playing) {
      m.pause()
      return
    }
    let raf = 0
    const tick = (): void => {
      const T = useStore.getState().tlTime
      const len = Math.max(0, a.outSec - a.inSec)
      const end = start + len
      if (T >= start && T < end) {
        const target = a.inSec + (T - start)
        // fades + gain shape the volume each tick (cheap; no seeking involved)
        const tIn = T - start
        const tOut = end - T
        let vol = a.gain ?? 1
        if (a.fadeInSec && tIn < a.fadeInSec) vol *= tIn / a.fadeInSec
        if (a.fadeOutSec && tOut < a.fadeOutSec) vol *= tOut / a.fadeOutSec
        m.volume = Math.max(0, Math.min(1, vol))
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
  }, [playing, start, a.inSec, a.outSec, a.gain, a.fadeInSec, a.fadeOutSec, file])
  return <audio ref={ref} src={mediaUrl(file)} preload="auto" style={{ display: 'none' }} />
}

// ---- Timeline Monitor v2: GLOBAL-CLOCK engine + A/B double-buffered video ----
// tlTime is the single truth. While the visible block's player is live, IT is the clock (perfect
// AV lock); across gaps/storyboards a wall clock advances. The standby player preloads and
// pre-seeks the block after the next boundary, so cuts are an instant swap — no seeks, no loads,
// no stray frames at the boundary. Dissolves crossfade active over standby.
export function MonitorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const clips = project?.clips ?? []
  const tlObj = activeTimeline(project)
  const timeline = activeItems(project)
  const tlPlaying = useStore((s) => s.tlPlaying)
  const seekTick = useStore((s) => s.seekTick)
  const [showDetails, setShowDetails] = useState(false)
  const [dtlScale, setDtlScale] = useState(1)
  const dtlDrag = useRef<{ x: number; y: number; s: number } | null>(null)
  const [guides, setGuides] = useState(false) // safe-area overlay
  const [rawGrab, setRawGrab] = useState(false)
  const [grabMsg, setGrabMsg] = useState('')
  const [visId, setVisId] = useState<string | null>(null) // block under the playhead (state → overlays re-render)
  const [curBeat, setCurBeat] = useState(0)
  const pARef = useRef<HTMLVideoElement>(null)
  const pBRef = useRef<HTMLVideoElement>(null)
  // player roles: which element is live, and which block each one is bound to
  const roleRef = useRef<{ active: 0 | 1; itemId: [string | null, string | null]; file: [string | null, string | null] }>({ active: 0, itemId: [null, null], file: [null, null] })

  const total = Math.max(timelineEnd(timeline, clips), 1)
  const hidden = useMemo(() => {
    const h = new Set<number>()
    const vCount = Math.max(1, tlObj?.videoTracks ?? 1)
    const solos = (tlObj?.soloTracks ?? []).filter((t) => t.startsWith('v'))
    for (let t = 0; t < vCount; t++) {
      const key = `v${t}`
      if (solos.length ? !solos.includes(key) : (tlObj?.mutedTracks ?? []).includes(key)) h.add(t)
    }
    return h
  }, [tlObj?.videoTracks, tlObj?.soloTracks, tlObj?.mutedTracks])

  const vis = visId ? timeline.find((x) => x.id === visId) : undefined
  const clip = vis ? clips.find((c) => c.id === vis.clipId) : undefined
  const view = vis && clip ? resolveView(clip, vis) : undefined
  const recipe = view?.recipe ?? clip?.promptData
  const beats = view?.beats ?? []
  const refImg = (b: BeatField): string | undefined => beatRefImageUrl(b, view?.beatFreeform ?? '', project?.images ?? [])
  const takeFileOfItem = (it: TimelineItem): string | undefined => {
    const c = clips.find((x) => x.id === it.clipId)
    return c ? resolveView(c, it).take?.file : undefined
  }
  const audioMutedFor = (it: TimelineItem): boolean =>
    !!tlObj?.videoMuted || !!it.muted || !!it.audioDetachedId || (tlObj?.mutedTracks ?? []).includes(`v${it.track ?? 0}`)

  // storyboard face + beat image for take-less blocks / gaps
  const faceFile = clip?.storyboardImageId ? project?.images.find((i) => i.id === clip.storyboardImageId)?.file : undefined
  const stillFile = recipe?.imageIds?.[0] ? project?.images.find((i) => i.id === recipe.imageIds[0])?.file : undefined
  const hasVideo = !!(vis && takeFileOfItem(vis))
  const storyImg = vis && !hasVideo ? (beats[curBeat] ? refImg(beats[curBeat]) : undefined) ?? (faceFile ? mediaUrl(faceFile) : undefined) ?? (stillFile ? mediaUrl(stillFile) : undefined) : null

  // ---- THE ENGINE ----
  useEffect(() => {
    const players = [pARef.current, pBRef.current] as (HTMLVideoElement | null)[]
    const role = roleRef.current
    const bind = (idx: 0 | 1, it: TimelineItem, T: number): void => {
      const el = players[idx]
      const file = takeFileOfItem(it)
      if (!el || !file) return
      const url = mediaUrl(file)
      if (role.file[idx] !== url) {
        el.src = url
        role.file[idx] = url
      }
      role.itemId[idx] = it.id
      el.playbackRate = it.speed && it.speed > 0 ? it.speed : 1
      const target = sourceTimeAt(it, clips, Math.max(T, startOf(it)))
      const apply = (): void => {
        try {
          el.currentTime = target
        } catch {
          /* not seekable yet */
        }
      }
      if (el.readyState >= 1) apply()
      else el.addEventListener('loadedmetadata', apply, { once: true })
    }
    const show = (el: HTMLVideoElement | null, on: boolean, opacity = 1): void => {
      if (!el) return
      el.style.visibility = on ? 'visible' : 'hidden'
      el.style.opacity = String(on ? opacity : 0)
    }
    let raf = 0
    let last = performance.now()
    let hardSeek = true // first tick (and every seekTick) re-binds at tlTime
    const tick = (): void => {
      const st = useStore.getState()
      let T = st.tlTime
      const now = performance.now()
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const rIn = tlObj?.rangeInSec
      const rOut = tlObj?.rangeOutSec
      const rangeLoop = st.tlLoop && rIn != null && rOut != null && rOut > rIn
      const visNow = itemAt(timeline, clips, T, hidden)
      const active = players[role.active]
      if (st.tlPlaying) {
        // clock: the LIVE video is authoritative (perfect AV lock); wall clock elsewhere
        if (visNow && role.itemId[role.active] === visNow.id && active && active.readyState >= 2 && !active.paused && takeFileOfItem(visNow)) {
          const sp = visNow.speed && visNow.speed > 0 ? visNow.speed : 1
          const base = visNow.useRecipe ? 0 : (visNow.inSec ?? 0)
          T = startOf(visNow) + (active.currentTime - base) / sp
        } else {
          T += dt
        }
        const endT = rangeLoop ? rOut! : total
        if (T >= endT - 0.001) {
          if (st.tlLoop) {
            T = rangeLoop ? rIn! : 0
            hardSeek = true
          } else {
            T = endT
            st.tlPause()
          }
        }
        st.tlSetTime(T)
      }
      // resolve what should be on screen
      const visT = itemAt(timeline, clips, T, hidden)
      if ((visT?.id ?? null) !== (visIdRef.current ?? null)) {
        visIdRef.current = visT?.id ?? null
        setVisId(visT?.id ?? null)
      }
      // beat under the playhead (for storyboard + overlay) — state write only on change
      if (visT) {
        const c = clips.find((x) => x.id === visT.clipId)
        const v = c ? resolveView(c, visT) : undefined
        const bi = v && v.beats.length ? beatAtTime(v.beats, sourceTimeAt(visT, clips, T)) : 0
        setCurBeat((cb) => (cb === bi ? cb : bi))
      }
      const file = visT ? takeFileOfItem(visT) : undefined
      if (visT && file) {
        // ensure the ACTIVE player carries the visible block (swap to a preloaded standby at cuts)
        if (role.itemId[role.active] !== visT.id || hardSeek) {
          const sb = (1 - role.active) as 0 | 1
          if (!hardSeek && role.itemId[sb] === visT.id) {
            players[role.active]?.pause()
            role.active = sb
          } else {
            bind(role.active, visT, T)
            role.itemId[(1 - role.active) as 0 | 1] = null // stale preload is meaningless after a hard bind
          }
          hardSeek = false
        }
        const ap = players[role.active]
        if (ap) {
          const target = sourceTimeAt(visT, clips, T)
          if (Math.abs(ap.currentTime - target) > 0.3)
            try {
              ap.currentTime = target
            } catch {
              /* ignore */
            }
          ap.playbackRate = visT.speed && visT.speed > 0 ? visT.speed : 1
          ap.muted = audioMutedFor(visT)
          if (st.tlPlaying && ap.paused) {
            ap.play().catch(() => undefined)
            if (!ap.muted) focusAudio(ap)
          }
          if (!st.tlPlaying && !ap.paused) ap.pause()
        }
        // preload the block after the next boundary on the standby player
        const nb = nextBoundary(timeline, clips, T)
        const nxt = nb != null ? itemAt(timeline, clips, nb + 0.01, hidden) : undefined
        const sb = (1 - role.active) as 0 | 1
        if (nxt && nxt.id !== visT.id && takeFileOfItem(nxt)) {
          if (role.itemId[sb] !== nxt.id) bind(sb, nxt, (nb ?? 0) + 0.01)
        }
        // dissolve window: crossfade active over the (preloaded, playing) standby
        const visEnd = startOf(visT) + effDur(visT, clips)
        const tr = visT.transitionOutSec ?? 0
        const inDissolve = tr > 0 && T > visEnd - tr && role.itemId[sb] != null
        if (inDissolve) {
          const k = Math.max(0, Math.min(1, (visEnd - T) / tr))
          show(players[role.active], true, k)
          show(players[sb], true, 1)
          const bp = players[sb]
          if (bp) {
            bp.muted = true // audio crossfades are the lanes' job; the standby stays silent
            if (st.tlPlaying && bp.paused) bp.play().catch(() => undefined)
          }
        } else {
          show(players[role.active], true, 1)
          show(players[(1 - role.active) as 0 | 1], false)
        }
      } else {
        // gap or storyboard: park both players, react renders the still/black underneath
        for (const p of players) if (p && !p.paused) p.pause()
        show(players[0], false)
        show(players[1], false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, clips, hidden, total, tlObj?.rangeInSec, tlObj?.rangeOutSec, seekTick, tlObj?.id])
  const visIdRef = useRef<string | null>(null)

  // ---- music lane: synced to the global clock ----
  const music = tlObj?.music
  const musicTrack = music ? project?.audio.find((a) => a.id === music.audioId) : undefined
  const musicUrl = musicTrack ? mediaUrl(musicTrack.file) : undefined
  const musRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const m = musRef.current
    if (m) m.muted = !!tlObj?.musicMuted
  }, [tlObj?.musicMuted, musicUrl])
  useEffect(() => {
    const m = musRef.current
    if (!m || !music || !musicUrl) return
    if (!tlPlaying) {
      m.pause()
      return
    }
    let raf = 0
    const tick = (): void => {
      const T = useStore.getState().tlTime
      const inS = music.inSec ?? 0
      const srcDur = musicTrack?.durationSec ?? (isFinite(m.duration) ? m.duration : 0)
      const outS = Math.min(music.outSec ?? (srcDur || Infinity), srcDur || Infinity)
      const end = music.startSec + (isFinite(outS) ? Math.max(0, outS - inS) : total)
      if (T >= music.startSec && T < Math.min(end, total)) {
        const target = inS + (T - music.startSec)
        if (m.paused) {
          try {
            m.currentTime = target
          } catch {
            /* ignore */
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
  }, [tlPlaying, music?.audioId, music?.startSec, music?.inSec, music?.outSec, musicUrl, total])

  // ---- output mirror relay (change + 1s drift tick — never per frame) ----
  const mirrorOn = useStore((s) => s.mirrorDisplayId != null)
  useEffect(() => {
    if (!mirrorOn) return
    const send = (): void => {
      const ap = roleRef.current.active === 0 ? pARef.current : pBRef.current
      const url = roleRef.current.file[roleRef.current.active]
      window.vidancer.mirrorState({
        url: hasVideo ? url ?? undefined : undefined,
        imgUrl: !hasVideo ? (storyImg ?? undefined) : undefined,
        time: ap?.currentTime ?? 0,
        playing: useStore.getState().tlPlaying
      })
    }
    send()
    const settle = window.setTimeout(send, 150)
    const iv = window.setInterval(() => {
      if (useStore.getState().tlPlaying) send()
    }, 1000)
    return () => {
      window.clearTimeout(settle)
      window.clearInterval(iv)
    }
  }, [mirrorOn, hasVideo, storyImg, tlPlaying, seekTick, visId])

  // ---- stage geometry ----
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => {
      const r = es[0]?.contentRect
      if (r) setBox({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const tlAspect = tlObj?.aspectRatio ?? '16:9'
  const [aw, ah] = tlAspect.split(':').map(Number)
  const ar = aw > 0 && ah > 0 ? aw / ah : 16 / 9
  const fitW = box.h > 0 && box.w / box.h > ar ? Math.round(box.h * ar) : box.w
  const fitH = box.h > 0 && box.w / box.h > ar ? box.h : ar > 0 ? Math.round(box.w / ar) : box.h

  // 📷 grab the current program frame → Library
  const grabFrame = async (): Promise<void> => {
    const ap = roleRef.current.active === 0 ? pARef.current : pBRef.current
    if (!ap || !hasVideo) return
    const bytes = await framePngBytes(ap, rawGrab ? undefined : tlAspect)
    if (!bytes) {
      setGrabMsg('no frame')
      return
    }
    const note = `frame · ${clip?.name ?? 'clip'} · ${smpte(ap.currentTime)}`
    const id = await useStore.getState().saveFrame(bytes, note)
    const title = id ? useStore.getState().project?.images.find((i) => i.id === id)?.title : null
    setGrabMsg(title ? `✓ ${title} → Library` : 'saved ✓')
    window.setTimeout(() => setGrabMsg(''), 2500)
  }

  const activeBeat = beats[curBeat]
  const overlayOn = showDetails || (!hasVideo && !!vis && beats.length > 0)
  const tc = (n: number): string => `${Math.round(n * 100) / 100}s`
  const metaClip = clip && recipe ? { ...clip, promptData: recipe } : clip

  return (
    <div className="vd-panel vd-monitor" style={{ position: 'relative' }}>
      {musicUrl && <audio ref={musRef} src={musicUrl} preload="auto" style={{ display: 'none' }} />}
      {(tlObj?.audioItems ?? []).map((a) => {
        const f = clips.find((c) => c.id === a.source.clipId)?.takes.find((t) => t.id === a.source.takeId)?.file
        if (!f || !tlObj) return null
        const segsAll = timeline.map((it) => ({ start: startOf(it), dur: effDur(it, clips) }))
        const laneMuted = (tlObj.soloTracks ?? []).filter((t) => t.startsWith('a')).length
          ? !(tlObj.soloTracks ?? []).includes(`a${a.lane}`)
          : (tlObj.mutedTracks ?? []).includes(`a${a.lane}`)
        return (
          <AudioItemPlayer
            key={a.id}
            a={a}
            start={audioStartOf(a, segsAll, tlObj.items)}
            file={f}
            playing={tlPlaying}
            muted={!!a.muted || !!tlObj.videoMuted || laneMuted}
          />
        )
      })}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 6, display: 'flex', gap: 6 }}>
        {hasVideo && (
          <>
            <span className="btn vd-hbtn" onClick={() => void grabFrame()} title={rawGrab ? '📷 grab the RAW frame (uncropped)' : '📷 grab the frame as shown (timeline canvas crop)'}>
              📷
            </span>
            <span className="btn vd-hbtn" style={{ opacity: rawGrab ? 1 : 0.5 }} onClick={() => setRawGrab((v) => !v)} title="toggle raw / as-shown frame grabs">
              raw
            </span>
          </>
        )}
        <span className="btn vd-hbtn" style={{ opacity: guides ? 1 : 0.5 }} onClick={() => setGuides((v) => !v)} title="safe-area guides (action 90% / title 80%)">
          ⛶
        </span>
        {vis && (
          <span className="btn vd-hbtn" onClick={() => setShowDetails((v) => !v)} title="show / hide this clip's recipe over the video">
            {showDetails ? 'details ▴' : 'details ▾'}
          </span>
        )}
      </div>
      {grabMsg && <span style={{ position: 'absolute', top: 36, right: 8, zIndex: 6, fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>{grabMsg}</span>}

      <div ref={hostRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: fitW, height: fitH, background: '#000', overflow: 'hidden' }}>
          {/* A/B players — the engine flips visibility/opacity; both always mounted */}
          <video ref={pARef} muted playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', visibility: 'hidden' }} />
          <video ref={pBRef} muted playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', visibility: 'hidden' }} />
          {/* storyboard / gap layer under the players */}
          {!hasVideo &&
            (storyImg ? (
              <img src={storyImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: 12, textAlign: 'center', padding: 10 }}>
                {timeline.length ? (vis ? 'no rendered take — storyboard' : '') : 'drag clips from the Bin onto the timeline'}
              </span>
            ))}
          {/* safe-area guides */}
          {guides && (
            <>
              <div style={{ position: 'absolute', inset: '5%', border: '1px dashed rgba(255,255,255,.5)', pointerEvents: 'none', zIndex: 5 }} />
              <div style={{ position: 'absolute', inset: '10%', border: '1px dashed rgba(255,255,255,.3)', pointerEvents: 'none', zIndex: 5 }} />
            </>
          )}
        </div>
        {/* recipe / beat overlay — child of the PANE, not the letterboxed picture: the text pins
            to the monitor's own top-left corner whatever shape the clip underneath is */}
        {overlayOn && vis && (
          <div style={{ position: 'absolute', top: 8, left: 8, maxWidth: dtlScale > 1.2 ? '94%' : '64%', maxHeight: '82%', overflow: 'auto', zIndex: 6, background: 'rgba(0,0,0,.66)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 9px', fontFamily: 'var(--mono)' }}>
              <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 3 }}>
                {metaClip ? clipModelLine(metaClip) : ''}
                {view?.take ? '' : ' · S-B — storyboard'}
                {clip && clipSeed(clip) != null ? ` · seed ${clipSeed(clip)}` : ''}
              </div>
              {activeBeat ? (
                <>
                  <div style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 11 }}>
                    {clip?.name} · beat {curBeat + 1}/{beats.length} — {activeBeat.name || 'shot'}
                  </div>
                  {activeBeat.camera && <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 2 }}>camera: {activeBeat.camera}</div>}
                  {activeBeat.action && <div style={{ fontSize: Math.round(10 * dtlScale), lineHeight: dtlScale > 1.2 ? 1.15 : undefined, color: 'var(--txt-hi)', marginTop: 2 }}>action: {activeBeat.action}</div>}
                  {activeBeat.lighting && <div style={{ fontSize: 10, color: 'var(--txt-hi)', marginTop: 2 }}>lighting: {activeBeat.lighting}</div>}
                  {(['dialogue', 'vfx', 'reaction', 'sfx'] as const).map((k) =>
                    activeBeat[k] ? (
                      <div key={k} style={{ fontSize: 10, color: 'var(--body)', marginTop: 2 }}>
                        {k}: {activeBeat[k]}
                      </div>
                    ) : null
                  )}
                  <div style={{ position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <span
                      className="btn vd-hbtn"
                      onPointerDown={(e) => {
                        e.preventDefault()
                        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                        dtlDrag.current = { x: e.clientX, y: e.clientY, s: dtlScale }
                      }}
                      onPointerMove={(e) => {
                        const d = dtlDrag.current
                        if (!d) return
                        setDtlScale(Math.min(9, Math.max(1, d.s + (e.clientX - d.x + e.clientY - d.y) / 150)))
                      }}
                      onPointerUp={() => (dtlDrag.current = null)}
                      onPointerCancel={() => (dtlDrag.current = null)}
                      onDoubleClick={() => setDtlScale(1)}
                      title="drag down/across = scale the action text · double-click = reset"
                      style={{ cursor: 'nwse-resize', touchAction: 'none', userSelect: 'none' }}
                    >
                      ⤢{dtlScale > 1.05 ? ` ${dtlScale.toFixed(1)}×` : ''}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 11, marginBottom: 3 }}>{clip?.name}</div>
                  {recipe?.scene.style && <div style={{ fontSize: 10 }}>style: {recipe.scene.style}</div>}
                  {recipe?.scene.visualFeel && <div style={{ fontSize: 10 }}>feel: {recipe.scene.visualFeel}</div>}
                  {recipe?.freeform && <div style={{ fontSize: 10, color: 'var(--body)', marginTop: 2 }}>{recipe.freeform.slice(0, 240)}</div>}
                </>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
