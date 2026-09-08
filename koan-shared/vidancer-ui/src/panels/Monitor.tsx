import { vd } from '../api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { focusAudio } from '../audioBus'
import { beatAtTime, beatRefImageUrl } from '../lib/beatUtils'
import { resolveView, activeItems, activeTimeline, audioStartOf, extentOf, itemAt, audioEndOf, nextBoundary, startOf, effDur, sourceTimeAt, timelineEnd, sourceDurOf } from '../lib/timelineUtils'
import { envGainAt } from '../shared/audioEnv'
import { resolveAudioSource } from '../shared/audioSource'
import { clipModelLine, clipSeed } from '../lib/clipMeta'
import { framePngBytes } from '../lib/frameGrab'
import { setProgramFrameGrab } from '../panelBus'
import { smpte } from '../lib/time'
import { readFx2, type FxV2 } from '../fx/fxData'
import { createFxChain, type FxChain } from '../fx/core/chain'
import type { FxLayerInput } from '../fx/core/types'
import { getEffect } from '../fx/core/registry'
import { sidecarsOf, sidecarsRev } from '../fx/fxUtils'
import { Ic, Play, Pause, Repeat, Volume2, VolumeX, Camera, Info } from '../ui/icons'
import { TimeReadout } from './shared/playback'
import '../fx/effects'

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
        let vol = (a.gain ?? 1) * envGainAt(a.volume, tIn) // v19 rubber band, block-local time
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
  }, [playing, start, a.inSec, a.outSec, a.gain, a.volume, a.fadeInSec, a.fadeOutSec, file])
  return <audio ref={ref} src={mediaUrl(file)} preload="auto" style={{ display: 'none' }} />
}

// one stretched ♪ score span (v18), synced to the GLOBAL CLOCK exactly like a detached audio
// block. Span semantics: audio never time-stretches — the take's window plays inside the span,
// a shorter take ends early (silence after), a longer one is capped by the span.
function ScoreItemPlayer({ s, file, playing, srcDur }: { s: TimelineScoreItem; file: string; playing: boolean; srcDur?: number }): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const m = ref.current
    if (m) m.muted = !!s.muted
  }, [s.muted, file])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    if (!playing || s.muted) {
      m.pause()
      return
    }
    let raf = 0
    const tick = (): void => {
      const T = useStore.getState().tlTime
      const aIn = s.inSec ?? 0
      const dur = srcDur ?? (isFinite(m.duration) ? m.duration : 0)
      const outCap = Math.min(s.outSec ?? (dur || Infinity), dur || Infinity)
      const playLen = Math.min(s.spanSec, isFinite(outCap) ? Math.max(0, outCap - aIn) : s.spanSec)
      const end = s.startSec + playLen
      if (T >= s.startSec && T < end) {
        const target = aIn + (T - s.startSec)
        const tIn = T - s.startSec
        const tOut = end - T
        let vol = (s.gain ?? 1) * envGainAt(s.volume, tIn) // v19 rubber band, block-local time
        if (s.fadeInSec && tIn < s.fadeInSec) vol *= tIn / s.fadeInSec
        if (s.fadeOutSec && tOut < s.fadeOutSec) vol *= tOut / s.fadeOutSec
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
  }, [playing, s.startSec, s.spanSec, s.inSec, s.outSec, s.gain, s.volume, s.fadeInSec, s.fadeOutSec, s.muted, file, srcDur])
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
  const tlPlay = useStore((s) => s.tlPlay)
  const tlPause = useStore((s) => s.tlPause)
  const tlLoop = useStore((s) => s.tlLoop)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const tlPlayInOut = useStore((s) => s.tlPlayInOut)
  const tlPlayRangeOnce = useStore((s) => s.tlPlayRangeOnce)
  const setTimelineMutes = useStore((s) => s.setTimelineMutes)
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
  // EFFECTS — the chain canvas sits over the A/B players; when the visible block carries fx the
  // engine hides the players and draws the active one through the pass chain instead. Blocks on
  // LOWER tracks under the playhead ride along as under-layers (opacity/blends composite over
  // them, not black) via a dedicated pool of hidden, loosely-synced players.
  const fxCanvasRef = useRef<HTMLCanvasElement>(null)
  const fxChainRef = useRef<FxChain | null>(null)
  // bumping the gen swaps in a FRESH canvas element (new WebGL context) — the self-heal for a
  // lost/dead context, which otherwise stays dead on the same canvas forever
  const [fxCanvasGen, setFxCanvasGen] = useState(0)
  const fxU0 = useRef<HTMLVideoElement>(null)
  const fxU1 = useRef<HTMLVideoElement>(null)
  const fxU2 = useRef<HTMLVideoElement>(null)
  const fxUnderFiles = useRef<[string | null, string | null, string | null]>([null, null, null])
  // AI sidecar players for the TOP layer (subject matte / depth), slaved to the active player's
  // clock. Sidecars for under-layers are a later pass — their masks no-op harmlessly meanwhile.
  const fxMatteRef = useRef<HTMLVideoElement>(null)
  const fxDepthRef = useRef<HTMLVideoElement>(null)
  const fxSidecarKnown = useRef(new Map<string, { matte: boolean; depth: boolean } | null>())
  const fxSidecarRev = useRef(0) // mirrors fxUtils.sidecarsRev — a bump flushes the known-map
  useEffect(
    () => () => {
      fxChainRef.current?.destroy()
      fxChainRef.current = null
      // a removed media element does NOT stop on unmount (HTML spec keeps audible elements
      // alive) — without this, closing the Monitor mid-play leaves detached audio running
      for (const r of [pARef, pBRef, fxU0, fxU1, fxU2]) r.current?.pause()
    },
    []
  )
  // player roles: which element is live, and which block each one is bound to. pending = src just
  // changed and no frame is decoded yet — a visible element would paint its STALE previous frame
  // pending tracks WHY a player is gated: 'src' = new file, no frame decoded yet (heals on
  // readyState ≥ 2) · 'seek' = cross-block jump within one file, old frame still painted (heals
  // on !seeking — readyState stays ≥ 2 through a seek, so the src heal would leak a stale frame)
  const roleRef = useRef<{ active: 0 | 1; itemId: [string | null, string | null]; file: [string | null, string | null]; pending: [false | 'src' | 'seek', false | 'src' | 'seek'] }>({ active: 0, itemId: [null, null], file: [null, null], pending: [false, false] })

  const musicEnd = audioEndOf(tlObj, project?.audio ?? []) // ⟲ tails + playback reach the FULL audio end (music, detached audio, ♪ scores)
  const total = Math.max(timelineEnd(timeline, clips, musicEnd), 1)
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
  const audioMutedFor = (it: TimelineItem): boolean => {
    if (tlObj?.videoMuted || it.muted || it.audioDetachedId) return true
    const tr = it.track ?? 0
    if ((tlObj?.mutedTracks ?? []).includes(`v${tr}`)) return true
    // linked (blue) audio RIDES lane a<track> but PLAYS through the video element — the lane's
    // M/S buttons never reached it (the bug: mute the lane, the blue block keeps singing).
    // Export mirrors this exactly (export.ts laneMutedA — keep the two in step).
    const laneKey = `a${tr}`
    const solosA = (tlObj?.soloTracks ?? []).filter((t) => t.startsWith('a'))
    if (solosA.length) return !solosA.includes(laneKey)
    return (tlObj?.mutedTracks ?? []).includes(laneKey)
  }

  // storyboard face + beat image for take-less blocks / gaps
  const faceFile = clip?.storyboardImageId ? project?.images.find((i) => i.id === clip.storyboardImageId)?.file : undefined
  const stillFile = recipe?.imageIds?.[0] ? project?.images.find((i) => i.id === recipe.imageIds[0])?.file : undefined
  const hasVideo = !!(vis && takeFileOfItem(vis))
  const hasRange = !!tlObj && tlObj.rangeInSec != null && tlObj.rangeOutSec != null && tlObj.rangeOutSec > tlObj.rangeInSec
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
        role.pending[idx] = 'src' // hide until a frame of the NEW src is decoded (no stale paint)
        el.src = url
        role.file[idx] = url
        el.addEventListener(
          'loadeddata',
          () => {
            role.pending[idx] = false
          },
          { once: true }
        )
      }
      role.itemId[idx] = it.id
      el.playbackRate = it.speed && it.speed > 0 ? it.speed : 1
      const target = sourceTimeAt(it, clips, Math.max(T, startOf(it)))
      // gate only when this element is being RE-POINTED at a different block — jogging within
      // one block must never hide the picture (frames trail the mouse, Premiere-style); the old
      // any-seek gate held the player black through fast scrubs ('seeked' lagged every jump)
      const crossBlock = role.itemId[idx] !== it.id
      const apply = (): void => {
        try {
          // a seek keeps painting the OLD frame until 'seeked' fires — when the jump crosses
          // blocks, gate visibility too (same-file rebinds never change src, so the src gate
          // can't help: that was the "random frame between two clips sharing a render" bug)
          if (crossBlock && Math.abs(el.currentTime - target) > 0.05) {
            role.pending[idx] = 'seek'
            el.addEventListener(
              'seeked',
              () => {
                role.pending[idx] = false
              },
              { once: true }
            )
          }
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
    let boundaryTimer = 0 // precise out-point pause — survives a throttled rAF
    let boundaryArmedFor: string | null = null
    // EFFECTS — draw the ready active player through the pass chain onto the overlay canvas,
    // with the blocks on lower tracks riding along as under-layers so opacity/blends composite
    // over the real picture below, not black. A shader failure latches fxFailed for this engine
    // run (no per-tick retry storm) and playback falls back to the plain <video> path.
    let fxFailed = false
    let fxRebuilds = 0
    let fxDeadCanvas: HTMLCanvasElement | null = null // the canvas a failure happened on — skip ticks until React commits its keyed replacement
    let fxLastFx: FxV2 | null = null
    let fxLastDraft: unknown = null
    const underPool = [fxU0.current, fxU1.current, fxU2.current] as (HTMLVideoElement | null)[]
    // visibility (not display) — a display:none canvas has no layout box, so clientWidth reads 0
    // and the first fx frame would render 2×2; visibility keeps the box measurable while hidden
    const hideFx = (): void => {
      const cv = fxCanvasRef.current
      if (cv && cv.style.visibility !== 'hidden') cv.style.visibility = 'hidden'
      for (const u of underPool) if (u && !u.paused) u.pause()
      for (const s of [fxMatteRef.current, fxDepthRef.current]) if (s && !s.paused) s.pause()
    }
    // broadcast-style vernier: converge a slaved player on its clock by micro-nudging playback
    // SPEED — re-seeks stutter mid-play, rate nudges glide in within ~a frame and stay there.
    // Hard seek only for real jumps (first bind, user seek) or while paused (exact, no stutter).
    const vernier = (el: HTMLVideoElement, target: number, playing: boolean, base: number): void => {
      if (el.readyState < 1) return
      const err = el.currentTime - target // + = this player is AHEAD of its clock
      if (!playing) {
        el.playbackRate = base
        if (Math.abs(err) > 0.02) {
          try {
            el.currentTime = target
          } catch {
            /* not seekable yet */
          }
        }
        return
      }
      if (Math.abs(err) > 0.25) {
        // big drift converges too slowly by rate alone (5% of a second per second) — one seek
        try {
          el.currentTime = target
        } catch {
          /* not seekable yet */
        }
        el.playbackRate = base
        return
      }
      const nudge = Math.max(-0.08, Math.min(0.08, err * 0.8))
      el.playbackRate = base * (1 - nudge)
    }
    // slave one sidecar player to the top player's clock — same take timeline, frame-aligned
    const syncSidecar = (el: HTMLVideoElement | null, url: string, topEl: HTMLVideoElement, playing: boolean): HTMLVideoElement | null => {
      if (!el) return null
      if (el.dataset.src !== url) {
        el.dataset.src = url
        el.src = url
      }
      el.muted = true
      vernier(el, topEl.currentTime, playing, topEl.playbackRate)
      if (playing && el.paused) el.play().catch(() => undefined)
      if (!playing && !el.paused) el.pause()
      return el.readyState >= 2 ? el : null
    }
    const fxFor = (x: TimelineItem): FxV2 | null => {
      const d = useStore.getState().fxDraft
      return d && d.itemId === x.id ? d.fx : readFx2(x)
    }
    const prog = (x: TimelineItem, T: number): number => {
      const cyc = Math.max(0.01, effDur(x, clips))
      let rel = T - startOf(x)
      if (x.loop && rel >= cyc) rel = rel % cyc // ⟲ per-cycle progress — every repeat restarts its arc
      return Math.max(0, Math.min(1, rel / cyc))
    }
    // loosely-synced hidden player for one under-layer: drift-corrected like the audio lanes,
    // always muted (audio ownership never changes), ready only once a frame is decoded.
    // Slots are keyed by FILE, not by list index — when the under set changes size or order, a
    // layer already bound to its file keeps its element (no spurious rebind flashing it black).
    const underSlotFor = (url: string, used: Set<number>): number => {
      const files = fxUnderFiles.current
      const hit = files.findIndex((f, i) => f === url && !used.has(i))
      if (hit >= 0) return hit
      const free = files.findIndex((f, i) => f === null && !used.has(i))
      if (free >= 0) return free
      const evict = files.findIndex((_f, i) => !used.has(i))
      return evict >= 0 ? evict : 0
    }
    const syncUnder = (it: TimelineItem, T: number, playing: boolean, used: Set<number>): HTMLVideoElement | null => {
      const file = takeFileOfItem(it)
      if (!file) return null
      const url = mediaUrl(file)
      const slot = underSlotFor(url, used)
      const el = underPool[slot]
      if (!el) return null
      used.add(slot)
      if (fxUnderFiles.current[slot] !== url) {
        fxUnderFiles.current[slot] = url
        el.src = url
      }
      el.muted = true
      vernier(el, sourceTimeAt(it, clips, T), playing, it.speed && it.speed > 0 ? it.speed : 1)
      if (playing && el.paused) el.play().catch(() => undefined)
      if (!playing && !el.paused) el.pause()
      return el.readyState >= 2 ? el : null
    }
    let fxLastKey = ''
    const drawFx = (topEl: HTMLVideoElement, visT: TimelineItem, fxvTop: FxV2, T: number, playing: boolean): boolean => {
      const cv = fxCanvasRef.current
      if (!cv) return false
      // after a failure the next rAF can land BEFORE React commits the keyed replacement canvas —
      // rebuilding on the same dead canvas burns extra strikes for one incident
      if (cv === fxDeadCanvas) return false
      fxDeadCanvas = null
      try {
        if (!fxChainRef.current) fxChainRef.current = createFxChain(cv)
        const chain = fxChainRef.current
        // PREVIEW resolution: dpr-aware but budget-capped — the chain is many GPU passes per
        // layer and the preview does not need display-native pixels (export bakes full-res).
        const dpr = window.devicePixelRatio || 1
        const budget = Math.min(1, 1440 / Math.max(1, Math.max(cv.clientWidth, cv.clientHeight) * dpr))
        const W = Math.max(2, Math.round(cv.clientWidth * dpr * budget))
        const H = Math.max(2, Math.round(cv.clientHeight * dpr * budget))
        if (chain.canvasW() !== W || chain.canvasH() !== H) chain.resize(W, H)
        // the top layer must have a decoded frame — rendering without it paints opaque black
        // over everything (the chain skips unready layers). Fall back to the DOM path this tick.
        if (topEl.readyState < 2 || topEl.videoWidth === 0) return false
        // lower-track blocks under the playhead, bottom first — nearest 3 (chain caps at 4 layers)
        const unders = timeline
          .filter(
            (x) =>
              x.id !== visT.id &&
              !x.disabled &&
              !hidden.has(x.track ?? 0) &&
              (x.track ?? 0) < (visT.track ?? 0) &&
              startOf(x) <= T &&
              T < extentOf(x, timeline, clips, musicEnd) && // ⟲ under-layer tails composite too
              takeFileOfItem(x)
          )
          .sort((a, b) => (a.track ?? 0) - (b.track ?? 0))
          .slice(-3)
        const layers: FxLayerInput[] = []
        const used = new Set<number>()
        for (const u of unders) {
          const el = syncUnder(u, T, playing, used)
          if (el) layers.push({ video: el, fx: fxFor(u) ?? undefined, fade: 1, progress: prog(u, T), flatDepth: 0.5 })
        }
        // pool elements not used this tick pause (they may hold a stale file for later reuse)
        for (let i = 0; i < underPool.length; i++) {
          const el = underPool[i]
          if (el && !used.has(i) && !el.paused) el.pause()
        }
        // AI sidecars for the top layer — only when a stack module declares the need, only when
        // the files exist next to the take (existence learned async once per file, then cached)
        let matteEl: HTMLVideoElement | null = null
        let depthEl: HTMLVideoElement | null = null
        const needs = fxvTop.stack.reduce(
          (acc, e) => {
            const n = getEffect(e.type)?.needs
            return { matte: acc.matte || !!n?.matte, depth: acc.depth || !!n?.depth }
          },
          { matte: false, depth: false }
        )
        const topFile = takeFileOfItem(visT)
        if (topFile && (needs.matte || needs.depth)) {
          // a fresh generation bumps sidecarsRev — flush stale knowledge so the new data file
          // shows up live, no restart (the "mask does nothing after generating" bug)
          if (fxSidecarRev.current !== sidecarsRev) {
            fxSidecarRev.current = sidecarsRev
            fxSidecarKnown.current.clear()
          }
          const known = fxSidecarKnown.current.get(topFile)
          if (known === undefined) {
            fxSidecarKnown.current.set(topFile, null) // in flight
            void sidecarsOf(topFile).then((r) => fxSidecarKnown.current.set(topFile, { matte: !!r.matte, depth: !!r.depth }))
          } else if (known) {
            if (needs.matte && known.matte) matteEl = syncSidecar(fxMatteRef.current, mediaUrl(`${topFile}.matte.mp4`), topEl, playing)
            if (needs.depth && known.depth) depthEl = syncSidecar(fxDepthRef.current, mediaUrl(`${topFile}.depth.mp4`), topEl, playing)
          }
        }
        layers.push({ video: topEl, fx: fxvTop, matte: matteEl, depth: depthEl, fade: 1, progress: prog(visT, T), flatDepth: 0.5 })
        // GPU-draw only when something can have changed. The key carries every input that alters
        // the picture — INCLUDING each video's position and the layer count, so late-decoding
        // media triggers the redraw (caching a not-yet-ready frame froze the monitor black).
        const fxRef = useStore.getState().fxDraft
        const key = `${T.toFixed(3)}|${W}x${H}|${visT.id}|${layers.map((l) => (l.video as HTMLVideoElement).currentTime.toFixed(3)).join(',')}|${matteEl ? matteEl.currentTime.toFixed(3) : 'x'}|${depthEl ? depthEl.currentTime.toFixed(3) : 'x'}`
        if (!playing && key === fxLastKey && fxvTop === fxLastFx && fxRef === fxLastDraft) return true
        fxLastKey = key
        fxLastFx = fxvTop
        fxLastDraft = fxRef
        chain.render(layers)
        fxRebuilds = 0 // a clean frame proves the context healthy — strikes only count consecutive failures
        if (cv.style.visibility !== 'visible') cv.style.visibility = 'visible'
        return true
      } catch (err) {
        // self-heal: tear the chain down and swap in a fresh canvas (fresh GL context) — a lost
        // context can never recover on the same canvas. Latch the fallback only after 3 strikes.
        fxRebuilds++
        console.error(`fx chain failed (attempt ${fxRebuilds}/3) — rebuilding on a fresh canvas`, err)
        try {
          fxChainRef.current?.destroy()
        } catch {
          /* context already gone */
        }
        fxChainRef.current = null
        fxDeadCanvas = cv
        if (fxRebuilds >= 3) fxFailed = true
        else setFxCanvasGen((g) => g + 1)
        hideFx()
        return false
      }
    }
    const tick = (): void => {
      const st = useStore.getState()
      let T = st.tlTime
      const now = performance.now()
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const rIn = tlObj?.rangeInSec
      const rOut = tlObj?.rangeOutSec
      const rangeLoop = st.tlLoop && rIn != null && rOut != null && rOut > rIn
      const visNow = itemAt(timeline, clips, T, hidden, musicEnd)
      const active = players[role.active]
      if (st.tlPlaying) {
        // clock: the LIVE video is authoritative (perfect AV lock); wall clock elsewhere.
        // ⟲ loop blocks are ALWAYS wall-clock — a wrapped video can't be time authority (after
        // the first seam-back its currentTime maps to cycle 0 forever, T would jump backwards)
        if (visNow && !visNow.loop && role.itemId[role.active] === visNow.id && active && active.readyState >= 2 && !active.paused && takeFileOfItem(visNow)) {
          const sp = visNow.speed && visNow.speed > 0 ? visNow.speed : 1
          const base = visNow.useRecipe ? 0 : (visNow.inSec ?? 0)
          T = startOf(visNow) + (active.currentTime - base) / sp
          // the live element free-runs PAST its own out-point between ticks — those frames are
          // trimmed-away content (the "frame from before the slice" bug). Clamp the clock a hair
          // past the block end so the handover fires THIS tick, and freeze the overrun paint.
          const visEnd = startOf(visNow) + effDur(visNow, clips)
          if (T >= visEnd) {
            T = visEnd + 0.0001
            active.pause() // a frozen boundary frame beats moving trimmed-away frames
          } else if (visEnd - T < 0.08 && boundaryArmedFor !== visNow.id) {
            // arm a precise pause AT the out-point: setTimeout keeps firing when rAF throttles
            boundaryArmedFor = visNow.id
            window.clearTimeout(boundaryTimer)
            const el = active
            boundaryTimer = window.setTimeout(() => {
              if (!el.paused && useStore.getState().tlPlaying) el.pause()
            }, Math.max(0, (visEnd - T) * 1000 - 2))
          } else if (visEnd - T >= 0.08 && boundaryArmedFor === visNow.id) {
            // scrubbed back inside the block (or looped) — disarm so the edge re-arms cleanly
            boundaryArmedFor = null
            window.clearTimeout(boundaryTimer)
          }
        } else {
          T += dt
        }
        // ▶in→out (play the range ONCE): the range's out-point ends the run even without loop —
        // tlPause clears the flag, so the next plain play runs free again
        const onceEnd = st.tlPlayRangeOnce && rIn != null && rOut != null && rOut > rIn ? rOut : null
        const endT = rangeLoop ? rOut! : onceEnd ?? total
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
      const visT = itemAt(timeline, clips, T, hidden, musicEnd)
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
          // v19: the video block's own fader + rubber band (block-local time)
          ap.volume = Math.max(0, Math.min(1, (visT.gain ?? 1) * envGainAt(visT.volume, T - startOf(visT))))
          if (st.tlPlaying && ap.paused) {
            ap.play().catch(() => undefined)
            if (!ap.muted) focusAudio(ap)
          }
          if (!st.tlPlaying && !ap.paused) ap.pause()
          // ⟲ LOOP SEAM: arm an exact seek-back at each cycle boundary so repeats land frame-
          // true instead of 0.3s late (the drift seek above stays as the backstop). Keyed per
          // seam — the timer re-arms every cycle, and the tail's END needs no arm at all: the
          // wall clock walks T past the extent and itemAt hands over naturally.
          if (visT.loop && st.tlPlaying) {
            const cyc = Math.max(0.05, effDur(visT, clips))
            const ext = extentOf(visT, timeline, clips, musicEnd)
            const k = Math.floor((T - startOf(visT)) / cyc) + 1
            const seamT = startOf(visT) + k * cyc
            const seamKey = `${visT.id}#loop${k}`
            if (seamT < ext - 0.01 && seamT - T < 0.08 && boundaryArmedFor !== seamKey) {
              boundaryArmedFor = seamKey
              window.clearTimeout(boundaryTimer)
              const el = ap
              const inBase = visT.useRecipe ? 0 : (visT.inSec ?? 0)
              boundaryTimer = window.setTimeout(() => {
                if (useStore.getState().tlPlaying)
                  try {
                    el.currentTime = inBase
                  } catch {
                    /* not seekable this instant — the drift seek catches it next tick */
                  }
              }, Math.max(0, (seamT - T) * 1000 - 2))
            }
          }
        }
        // preload the block after the next VISIBLE change on the standby player. nextBoundary
        // reports every block edge on every track — a lower-track edge underneath the live block
        // changes nothing on screen, and stopping there left the standby stale at the real cut
        // (the hard-bind fallback then flashed a wrong frame). Walk forward until the top changes.
        let nb = nextBoundary(timeline, clips, T, musicEnd)
        let nxt = nb != null ? itemAt(timeline, clips, nb + 0.01, hidden, musicEnd) : undefined
        for (let hop = 0; nb != null && nxt?.id === visT.id && hop < 8; hop++) {
          nb = nextBoundary(timeline, clips, nb, musicEnd)
          nxt = nb != null ? itemAt(timeline, clips, nb + 0.01, hidden, musicEnd) : undefined
        }
        const sb = (1 - role.active) as 0 | 1
        if (nxt && nxt.id !== visT.id && takeFileOfItem(nxt)) {
          if (role.itemId[sb] !== nxt.id) bind(sb, nxt, (nb ?? 0) + 0.01)
        }
        // dissolve window: crossfade active over the (preloaded, playing) standby
        // ⟲ a looped block dissolves at its TAIL end, never at a seam
        const visEnd = extentOf(visT, timeline, clips, musicEnd)
        const tr = visT.transitionOutSec ?? 0
        const inDissolve = tr > 0 && T > visEnd - tr && role.itemId[sb] != null
        // pending self-heal, per gate kind: 'src' heals on a decoded frame (readyState ≥ 2 — a
        // lost 'loadeddata' must never hide the player forever); 'seek' heals only when the seek
        // completes (!seeking) — readyState stays ≥ 2 through a same-file seek, so the src heal
        // would show the pre-seek frame at a hard cut between blocks sharing one render
        const ready = (i: 0 | 1): boolean => {
          const p = role.pending[i]
          if (!p) return true
          const el = players[i]
          if (!el) return false
          return p === 'seek' ? !el.seeking : el.readyState >= 2
        }
        // EFFECTS — the block's fx (live panel draft wins over the persisted value). Dissolves
        // stay on the DOM crossfade path for now: the chain canvas is opaque and would cover the
        // standby, so fx drop out for the crossfade window (v1 tradeoff, sandwich phase owns it).
        const draft = st.fxDraft
        const fxv = draft && draft.itemId === visT.id ? draft.fx : readFx2(visT)
        const fxOn = !fxFailed && !inDissolve && !!fxv && (fxv.stack.length > 0 || !!fxv.blend)
        if (inDissolve) {
          hideFx()
          const k = Math.max(0, Math.min(1, (visEnd - T) / tr))
          show(players[role.active], ready(role.active), k)
          show(players[sb], ready(sb), 1)
          const bp = players[sb]
          const nxtIt = role.itemId[sb] ? timeline.find((x) => x.id === role.itemId[sb]) : undefined
          if (bp && nxtIt) {
            bp.muted = true // audio crossfades are the lanes' job; the standby stays silent
            // TIME-CONTINUOUS handover: the incoming HOLDS its in-frame through the cross (the
            // model starts it AT the boundary). Free-running here made its head play TWICE —
            // once in the cross, again after the >0.3s drift seek rewound it at handover — or,
            // for dissolves ≤0.3s, the video-as-clock branch jumped T forward by the overrun.
            const target = sourceTimeAt(nxtIt, clips, Math.max(T, startOf(nxtIt)))
            if (Math.abs(bp.currentTime - target) > 0.05) {
              try {
                bp.currentTime = target
              } catch {
                /* not seekable yet */
              }
            }
            if (!bp.paused) bp.pause()
          }
        } else if (fxOn && ready(role.active) && players[role.active] && drawFx(players[role.active]!, visT, fxv!, T, st.tlPlaying)) {
          // chain drew this frame — players keep running (audio + clock) but stay hidden under it
          show(players[role.active], false)
          show(players[(1 - role.active) as 0 | 1], false)
        } else {
          hideFx()
          // pending gate: a just-rebound element paints its STALE previous frame until the new
          // src has a decoded frame — keep it hidden (black beats the wrong clip)
          show(players[role.active], ready(role.active), 1)
          show(players[(1 - role.active) as 0 | 1], false)
        }
      } else {
        // gap or storyboard: park both players, react renders the still/black underneath
        for (const p of players) if (p && !p.paused) p.pause()
        hideFx()
        show(players[0], false)
        show(players[1], false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(boundaryTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, clips, hidden, total, musicEnd, tlObj?.rangeInSec, tlObj?.rangeOutSec, seekTick, tlObj?.id])
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
        // v19 rubber band + fader (block-local time; HTMLMediaElement caps boosts at 1.0)
        m.volume = Math.max(0, Math.min(1, (music.gain ?? 1) * envGainAt(music.volume, T - music.startSec)))
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
  }, [tlPlaying, music?.audioId, music?.startSec, music?.inSec, music?.outSec, music?.gain, music?.volume, musicUrl, total])

  // ---- output mirror relay (change + 1s drift tick — never per frame) ----
  const mirrorOn = useStore((s) => s.mirrorDisplayId != null)
  useEffect(() => {
    if (!mirrorOn) return
    const send = (): void => {
      const ap = roleRef.current.active === 0 ? pARef.current : pBRef.current
      const url = roleRef.current.file[roleRef.current.active]
      vd().mirrorState({
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
  // the timeline block menu's "current frame" fires THIS grab (same frame the 📷 button saves);
  // ref-carried so the registered fn never goes stale. False = no video frame to grab.
  const grabRef = useRef<(() => void) | null>(null)
  grabRef.current = hasVideo ? () => void grabFrame() : null
  useEffect(() => {
    setProgramFrameGrab(() => {
      if (!grabRef.current) return false
      grabRef.current()
      return true
    })
    return () => setProgramFrameGrab(null)
  }, [])

  const activeBeat = beats[curBeat]
  const overlayOn = showDetails || (!hasVideo && !!vis && beats.length > 0)
  const tc = (n: number): string => `${Math.round(n * 100) / 100}s`
  const metaClip = clip && recipe ? { ...clip, promptData: recipe } : clip

  return (
    <div className="vd-panel" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      {musicUrl && <audio ref={musRef} src={musicUrl} preload="auto" style={{ display: 'none' }} />}
      {(tlObj?.scoreItems ?? []).map((sIt) => {
        const sc = project?.scoreClips.find((x) => x.id === sIt.scoreClipId)
        const take = sc?.takes.find((t) => t.id === (sIt.takeId ?? sc?.keeperTakeId)) ?? sc?.takes[sc.takes.length - 1]
        if (!take) return null // no render yet — the span is silent on purpose
        // v19 lane merge: scores share the audio lanes, so lane mute/solo silences them too
        const laneMuted = (tlObj?.soloTracks ?? []).filter((t) => t.startsWith('a')).length
          ? !(tlObj?.soloTracks ?? []).includes(`a${sIt.lane ?? 0}`)
          : (tlObj?.mutedTracks ?? []).includes(`a${sIt.lane ?? 0}`)
        return <ScoreItemPlayer key={sIt.id} s={laneMuted ? { ...sIt, muted: true } : sIt} file={take.file} playing={tlPlaying} srcDur={take.durationSec} />
      })}
      {(tlObj?.audioItems ?? []).map((a) => {
        const f = resolveAudioSource(a, clips, project?.audio ?? []).file // v20: both source kinds
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
      <div style={{ position: 'relative', flex: 1, minHeight: 90 }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: fitW, height: fitH, background: '#000', overflow: 'hidden' }}>
          {/* A/B players — the engine flips visibility/opacity; both always mounted */}
          <video ref={pARef} muted playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', visibility: 'hidden' }} />
          <video ref={pBRef} muted playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', visibility: 'hidden' }} />
          {/* EFFECTS under-layer pool — hidden decode sources for lower-track blocks when the
              chain composites; never visible, never audible */}
          <video ref={fxU0} muted playsInline preload="auto" style={{ display: 'none' }} />
          <video ref={fxU1} muted playsInline preload="auto" style={{ display: 'none' }} />
          <video ref={fxU2} muted playsInline preload="auto" style={{ display: 'none' }} />
          {/* AI sidecar players (top layer) — matte + depth slaved to the active player's clock */}
          <video ref={fxMatteRef} muted playsInline preload="auto" style={{ display: 'none' }} />
          <video ref={fxDepthRef} muted playsInline preload="auto" style={{ display: 'none' }} />
          {/* EFFECTS canvas — the engine draws the active player through the pass chain here
              whenever the visible block carries fx; hidden otherwise (visibility keeps the layout
              box so clientWidth stays measurable for the first fx frame) */}
          <canvas key={fxCanvasGen} ref={fxCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', visibility: 'hidden' }} />
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

      {/* ---- transport — the Clip Monitor's bar, program-side: three zones, cluster DEAD
           CENTER, details pinned right, timecode readout centered below (one grammar) ---- */}
      <div style={{ padding: '6px 8px', background: 'var(--bg0)', flex: '0 0 auto' }}>
        {/* the row FOLDS on narrow panels (law 4: rows fold, controls never shrink) — spacers
            collapse first, then buttons wrap onto centered lines; nothing clips out of reach */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, rowGap: 4, marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
            {grabMsg && <span style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{grabMsg}</span>}
          </div>
          <span className="btn vd-hbtn" onClick={() => (tlPlaying ? tlPause() : tlPlay())} title="play / pause (Space · K/L)">
            <Ic i={tlPlaying ? Pause : Play} />
          </span>
          <span
            className="btn vd-hbtn"
            // the armed once-run is DRAWN on the button (law 6) — lit amber until it parks
            style={tlPlayRangeOnce ? { background: 'var(--amber)', color: 'var(--on-accent)' } : hasRange ? undefined : { opacity: 0.4, cursor: 'default', color: 'var(--dim)' }}
            onClick={() => hasRange && tlPlayInOut()}
            title={
              !hasRange
                ? 'set the range first — I / O on the timeline ruler'
                : tlLoop
                  ? 'play the in→out range — ⟲ is lit, so it repeats until pause'
                  : 'play the in→out range once, then park at the out-point'
            }
          >
            <Ic i={Play} size={11} /> in→out
          </span>
          <span className="btn vd-hbtn" style={{ opacity: tlLoop ? 1 : 0.4 }} onClick={toggleLoop} title="loop — the timeline, or the in/out range when one is set">
            <Ic i={Repeat} size={11} />
          </span>
          <span
            className="btn vd-hbtn"
            style={{ opacity: tlObj?.videoMuted ? 1 : 0.6, color: tlObj?.videoMuted ? 'var(--bad)' : undefined }}
            onClick={() => tlObj && void setTimelineMutes(tlObj.id, { videoMuted: !tlObj.videoMuted })}
            title="mute ALL clip audio (playback + export) — the master switch for every clip's own sound"
          >
            <Ic i={tlObj?.videoMuted ? VolumeX : Volume2} />
          </span>
          <span
            className="btn vd-hbtn"
            style={hasVideo ? undefined : { opacity: 0.4, cursor: 'default', color: 'var(--dim)' }}
            onClick={() => hasVideo && void grabFrame()}
            title={hasVideo ? (rawGrab ? 'grab the RAW frame (uncropped) → Library' : 'grab the frame as shown (timeline canvas crop) → Library') : 'no video frame under the playhead'}
          >
            <Ic i={Camera} />
          </span>
          <span className="btn vd-hbtn" style={{ opacity: rawGrab ? 1 : 0.5 }} onClick={() => setRawGrab((v) => !v)} title="toggle raw / as-shown frame grabs">
            raw
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <span className="btn vd-hbtn" style={{ opacity: guides ? 1 : 0.5 }} onClick={() => setGuides((v) => !v)} title="safe-area guides (action 90% / title 80%)">
              ⛶
            </span>
            <span
              className="btn vd-hbtn"
              style={vis ? { opacity: overlayOn ? 1 : 0.6 } : { opacity: 0.4, cursor: 'default', color: 'var(--dim)' }}
              onClick={() => vis && setShowDetails((v) => !v)}
              title={vis ? "show / hide this clip's recipe over the video" : 'nothing under the playhead'}
            >
              <Ic i={Info} /> details
            </span>
          </div>
        </div>
        {/* live sequence timecode — the same readout widget, the Clip Monitor's look */}
        <div style={{ textAlign: 'center' }}>
          <TimeReadout total={total} style={{ marginLeft: 0, fontSize: 13, color: 'var(--txt-hi)', letterSpacing: 0.5 }} />
        </div>
      </div>
    </div>
  )
}
