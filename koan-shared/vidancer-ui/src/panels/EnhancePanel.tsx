import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { EmptyState } from '../ui/EmptyState'
import { Section, Dropdown } from '@koan/shared'
import { Thumbnail } from '../Thumbnail'
import { mediaUrl } from '../media'
import { modelWizard } from '../lib/modelWizard'
import { localModelFor } from '../shared/localModels'
import { openKeyWizard } from '../ui/KeyWizard'
import { keySupplier } from '../lib/keySuppliers'
import { MIME_TAKE, MIME_VIDEO } from '../lib/dragDrop'
import { Ic, Play, Pause, Volume2, VolumeX } from '../ui/icons'
import {
  INTERP_ENGINES,
  UPSCALE_ENGINES,
  enhanceEngine,
  enhanceCost,
  enhanceTone,
  enhanceWords,
  interpPlan,
  upscalePlan,
  type EnhanceEngine,
  type EnhanceField,
  type EnhanceSection,
  type InterpAsk,
  type UpscaleAsk
} from '../shared/enhance'

// ---- ENHANCE (list 52). His design, 10-01: "we make a new window called ENHANCE it has two
// sections in it withthier own pills and design model choices and settings — Interpolate and
// Enlarge" (upscale: his word) · "A take appears in its monitor same layout as clip gen, etc. With a
// slide bar which lets you see before and after as well as a replay speed setting" · "Once a clip is
// enhanced a copy of it appears in its clip gen window with an outline around it … blue for
// interpolated, green for enhanced and purple for both" · "the settings in the window let us have all
// the options for topaz locally … those settings will change depending on the mode / service".
// My three adds he agreed to: a zoom on the monitor, a free short preview on the engines of this PC,
// and both sections in one run (interpolate first, then upscale). Spec: ENHANCE-SPEC-2026-10-01.md.

type Tools = Awaited<ReturnType<VidancerApi['enhanceTools']>>
type Facts = { w: number; h: number; fps: number; sec: number }
// the right side of the slide bar: a copy (offset 0), or a preview of `span` source seconds from `offset`
type After = { file: string; offset: number; ratio: number; label: string; span?: number }
const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }
const RATES = [1, 0.5, 0.25, 0.125]
const pct = (r: number): string => `${Math.round(r * 1000) / 10} %`
const fmtSec = (s: number): string => `${Math.round(s * 10) / 10} s`

const DEF_I: InterpAsk = { engine: 'rife-local', model: 'rife-v4.6', times: 2, slowmo: 1, settings: {} }
const DEF_U: UpscaleAsk = { engine: 'realesrgan-local', model: 'realesrgan-x4plus', scale: 2, settings: {} }

export function EnhancePanel(): React.JSX.Element {
  const src = useStore((s) => s.enhanceSource)
  const project = useStore((s) => s.project)
  const settingsRev = useStore((s) => s.settingsRev)
  const renderNow = useStore((s) => s.renderNow)
  const enqueueRender = useStore((s) => s.enqueueRender)
  const openEnhance = useStore((s) => s.openEnhance)

  // ---- the source: a take of a clip, or a Library video ----
  const clip = src?.kind === 'take' ? project?.clips.find((c) => c.id === src.clipId) : undefined
  const take = src?.kind === 'take' ? clip?.takes.find((t) => t.id === src.takeId) : undefined
  const video = src?.kind === 'video' ? (project?.videos ?? []).find((v) => v.id === src.videoId) : undefined
  const file = take?.file ?? video?.file
  const name = take && clip ? `${clip.name} · T${clip.takes.indexOf(take) + 1}` : (video?.title ?? '')
  const mark = take?.enhanced ?? video?.enhanced
  // the copies made from it (newest last) — the monitor compares against the newest by default
  const copies = useMemo(
    () =>
      take && clip
        ? clip.takes.filter((t) => t.enhanced?.of === take.id).map((t) => ({ id: t.id, file: t.file, sec: t.durationSec, mark: t.enhanced!, label: `T${clip.takes.indexOf(t) + 1}` }))
        : video
          ? (project?.videos ?? []).filter((v) => v.enhanced?.of === video.id).map((v) => ({ id: v.id, file: v.file, sec: v.durationSec, mark: v.enhanced!, label: v.title }))
          : [],
    [take, clip, video, project?.videos]
  )

  // ---- what is on this PC, the fal key, the source's size ----
  const [tools, setTools] = useState<Tools | null>(null)
  const [falKey, setFalKey] = useState(false)
  const [facts, setFacts] = useState<Facts | null>(null)
  useEffect(() => {
    void vd().enhanceTools().then(setTools).catch(() => undefined)
    void vd().getSettings().then((s) => setFalKey(!!s?.falKey))
  }, [settingsRev])
  useEffect(() => {
    setFacts(null)
    if (src) void vd().enhanceFacts(src).then(setFacts).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // ---- the two sections (remembered between runs, in Settings) ----
  const [interpOn, setInterpOn] = useState(true)
  const [upscaleOn, setUpscaleOn] = useState(false)
  const [ia, setIa] = useState<InterpAsk>(DEF_I)
  const [ua, setUa] = useState<UpscaleAsk>(DEF_U)
  const [fold, setFold] = useState({ interp: true, upscale: true }) // the two cards open or folded
  const loaded = useRef(false)
  // his remembered set. An Optical Flow ask forces its own values; those are never remembered, and
  // a normal source after one brings his set back (they used to overwrite it) (audit 2026-10-09 L33)
  type Last = { interpOn?: boolean; upscaleOn?: boolean; ia?: InterpAsk; ua?: UpscaleAsk }
  const lastRef = useRef<Last | undefined>(undefined)
  const flowShown = useRef(false)
  const applyLast = (last: Last | undefined): void => {
    if (!last) return
    if (typeof last.interpOn === 'boolean') setInterpOn(last.interpOn)
    if (typeof last.upscaleOn === 'boolean') setUpscaleOn(last.upscaleOn)
    if (last.ia?.engine) setIa({ ...DEF_I, ...last.ia })
    if (last.ua?.engine) setUa({ ...DEF_U, ...last.ua })
  }
  useEffect(() => {
    void vd().getSettings().then((s) => {
      lastRef.current = s?.enhanceLast as Last | undefined
      applyLast(lastRef.current)
      // an Optical Flow ask that opened the window wins over what was remembered
      const flow = useStore.getState().enhanceSource?.flow
      if (flow) {
        flowShown.current = true
        setInterpOn(true)
        setUpscaleOn(false)
        setIa((a) => ({ ...a, times: flow.times, fps: undefined, slowmo: 1 }))
      }
      loaded.current = true
    })
  }, [])
  useEffect(() => {
    if (!loaded.current || src?.flow) return
    const t = window.setTimeout(() => {
      lastRef.current = { interpOn, upscaleOn, ia, ua }
      void vd().setSettings({ enhanceLast: lastRef.current })
    }, 500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interpOn, upscaleOn, ia, ua])
  // Optical Flow (the speed dialog) sends a take with the frames its blocks need: smoother, same length
  useEffect(() => {
    if (!src?.flow) {
      if (flowShown.current && loaded.current) applyLast(lastRef.current)
      flowShown.current = false
      return
    }
    flowShown.current = true
    setInterpOn(true)
    setUpscaleOn(false)
    setIa((a) => ({ ...a, times: src.flow!.times, fps: undefined, slowmo: 1 }))
  }, [src])

  const ie = enhanceEngine('interp', ia.engine)
  const ue = enhanceEngine('upscale', ua.engine)
  const topazModels = (sec: EnhanceSection): { value: string; label: string; title?: string }[] => (tools?.topaz[sec] ?? []).map((m) => ({ value: m.id, label: `${m.name} · ${m.id}`, title: m.desc }))
  const modelsOf = (e: EnhanceEngine): { value: string; label: string; title?: string }[] => (e.where === 'topaz' ? topazModels(e.section) : (e.models ?? []))

  // ---- can it run: every blocker is said on the card before the click ----
  const engineWhy = (e: EnhanceEngine): string =>
    e.where === 'fal'
      ? falKey
        ? ''
        : 'No fal key saved — paste it in Settings first.'
      : e.where === 'topaz'
        ? !tools
          ? 'looking for Topaz Video…'
          : !tools.topaz.found
            ? 'Topaz Video is not installed on this PC'
            : !modelsOf(e).length
              ? `Topaz on this PC has no ${e.section === 'interp' ? 'frame' : 'enhance'} models`
              : ''
        : !tools
          ? 'looking…'
          : (e.modelRow === 'rife-ncnn' ? tools.rife : tools.esrgan)
            ? ''
            : `${e.modelRow === 'rife-ncnn' ? 'RIFE' : 'Real-ESRGAN'} is not on this PC yet — download it once (Models card)`
  const smoother = (ia.slowmo || 1) === 1
  const { outFps, perFrame } = facts ? interpPlan(ia, facts.fps) : { outFps: 0, perFrame: 0 }
  const why = !src || !file
    ? 'nothing open'
    : !interpOn && !upscaleOn
      ? 'switch on INTERPOLATE, UPSCALE or both'
      : (interpOn && engineWhy(ie)) ||
        (upscaleOn && engineWhy(ue)) ||
        (interpOn && !smoother && !ie.slowmo ? `${ie.label} makes no slow motion — pick another engine or "smoother"` : '') ||
        (interpOn && ie.maxTimes && perFrame > ie.maxTimes + 0.01 ? `${ie.label} makes at most ×${ie.maxTimes} the frames — this asks ×${Math.round(perFrame * 10) / 10}` : '') ||
        (interpOn && smoother && ie.fpsRange && outFps > ie.fpsRange[1] + 0.01 ? `${ie.label} makes at most ${ie.fpsRange[1]} fps — this would be ${Math.round(outFps)}: pick fewer frames or a frame rate` : '')
  const local = (interpOn ? ie.where !== 'fal' : true) && (upscaleOn ? ue.where !== 'fal' : true)

  // ---- the copy it would make, and what it costs ----
  const plan = facts
    ? (() => {
        const ip = interpOn ? interpPlan(ia, facts.fps) : undefined
        const up = upscaleOn ? upscalePlan(ua, facts.w, facts.h) : undefined
        const cost = enhanceCost({ interp: interpOn ? ia : undefined, upscale: upscaleOn ? ua : undefined, src: facts })
        return { w: up?.w ?? facts.w, h: up?.h ?? facts.h, fps: ip?.outFps ?? facts.fps, sec: facts.sec * (ip?.slowmo ?? 1), cost }
      })()
    : null
  const costFace = !plan ? '' : local ? 'free' : plan.cost.usd != null ? `~$${plan.cost.usd.toFixed(2)}` : plan.cost.note

  // ---- the monitor: before under, after over, the slide bar between; both play together ----
  const [after, setAfter] = useState<After | null>(null)
  const [split, setSplit] = useState(0.5)
  const [rate, setRate] = useState(1)
  const [zoom, setZoom] = useState<'fit' | number>('fit') // a number = screen pixels per pixel of the after (1 = 100 %)
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(true)
  const [dur, setDur] = useState(0)
  const scrubRef = useRef<HTMLInputElement>(null) // moved by the clock below, not by React (no re-render each frame)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewErr, setPreviewErr] = useState('')
  const beforeRef = useRef<HTMLVideoElement>(null)
  const afterRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(260)
  const scrollerRef = useRef<HTMLDivElement>(null) // the picture's viewport: scrolls and pans when zoomed in
  const stageRef = useRef<HTMLDivElement>(null) // both videos, sized by the zoom
  const handleRef = useRef<HTMLDivElement>(null) // the slide bar: on the monitor, never on the zoomed picture
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [panning, setPanning] = useState(false)
  const anchor = useRef<{ sx: number; sy: number; mx?: number; my?: number } | null>(null) // no mx/my = land in the middle
  // the newest copy is the after, until a preview or another copy is picked
  const newest = copies[copies.length - 1]
  useEffect(() => {
    setPreviewErr('')
    setAfter(newest ? { file: newest.file, offset: 0, ratio: 0, label: `after · ${newest.label}` } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, newest?.id])
  // keep the after on the before's clock (a slow-motion copy runs `ratio` times longer)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const b = beforeRef.current
      const a = afterRef.current
      if (b) {
        if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = String(b.currentTime)
        if (after?.span && (b.currentTime < after.offset - 0.05 || b.currentTime > after.offset + after.span)) b.currentTime = after.offset // a preview loops its own stretch
        if (a && after) {
          const ratio = after.ratio || (b.duration > 0 && a.duration > 0 ? a.duration / b.duration : 1)
          const want = Math.max(0, (b.currentTime - after.offset) * ratio)
          if (Math.abs(a.currentTime - want) > 0.08) a.currentTime = want
          const pr = rate * ratio
          if (Math.abs(a.playbackRate - pr) > 1e-3) a.playbackRate = Math.min(16, Math.max(0.0625, pr))
          if (b.paused !== a.paused) void (b.paused ? a.pause() : a.play().catch(() => undefined))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [after, rate])
  useEffect(() => {
    if (beforeRef.current) beforeRef.current.playbackRate = rate
  }, [rate, file])
  const togglePlay = (): void => {
    const b = beforeRef.current
    if (!b) return
    if (b.paused) void b.play().catch(() => undefined)
    else b.pause()
  }
  const dragSplit = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const sc = scrollerRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    const move = (ev: MouseEvent): void => setSplit(Math.min(1, Math.max(0, (ev.clientX - r.left) / sc.clientWidth)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // zoom: fit, or screen pixels per pixel of the after (100 % = its own pixels; the before is drawn to
  // the same box: the fair comparison). His cleanup 10-01: the slide bar stays on the monitor at any
  // zoom, the wheel zooms at the pointer, the picture drags with the hand, the scroll bars stay
  const fitZ = nat && box.w && box.h ? Math.min(box.w / nat.w, box.h / nat.h) : 1
  const zMin = Math.min(fitZ, 1)
  const zMax = Math.max(fitZ, 8)
  const z = zoom === 'fit' || !nat ? fitZ : Math.min(zMax, Math.max(zMin, zoom))
  const stage = nat && box.w ? { w: Math.round(nat.w * z), h: Math.round(nat.h * z) } : null
  const live = useRef({ z, fitZ, zMin, zMax, nat })
  live.current = { z, fitZ, zMin, zMax, nat }
  const zoomTo = (next: number, at?: { x: number; y: number }, centre?: boolean): void => {
    const sc = scrollerRef.current
    const st = stageRef.current
    const L = live.current
    if (!sc || !st || !L.nat) return
    const z1 = Math.min(L.zMax, Math.max(L.zMin, next))
    // the picture point under the pointer (or the middle) stays where it is, or moves to the middle
    const mx = at?.x ?? sc.clientWidth / 2
    const my = at?.y ?? sc.clientHeight / 2
    anchor.current = { sx: (sc.scrollLeft + mx - st.offsetLeft) / L.z, sy: (sc.scrollTop + my - st.offsetTop) / L.z, ...(centre ? {} : { mx, my }) }
    setZoom(Math.abs(z1 - L.fitZ) < L.fitZ * 0.005 ? 'fit' : z1)
  }
  // the slide bar and the after's cut follow the viewport, not the zoomed picture
  const syncSplit = (): void => {
    const sc = scrollerRef.current
    const st = stageRef.current
    if (!sc || !st) return
    const x = split * sc.clientWidth
    if (handleRef.current) {
      handleRef.current.style.left = `${x}px`
      handleRef.current.style.bottom = `${sc.offsetHeight - sc.clientHeight}px`
    }
    if (afterRef.current) afterRef.current.style.clipPath = `inset(0 0 0 ${Math.max(0, sc.scrollLeft + x - st.offsetLeft)}px)`
  }
  useLayoutEffect(() => {
    const sc = scrollerRef.current
    const st = stageRef.current
    const a = anchor.current
    if (sc && st && a) {
      anchor.current = null
      sc.scrollLeft = st.offsetLeft + a.sx * z - (a.mx ?? sc.clientWidth / 2)
      sc.scrollTop = st.offsetTop + a.sy * z - (a.my ?? sc.clientHeight / 2)
    }
    syncSplit()
  })
  const showing = !!src && !!file
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    // the wheel zooms (a listener of our own: React's is passive and can't keep the page still)
    const onWheel = (e: WheelEvent): void => {
      const sc = scrollerRef.current
      if (!sc || !live.current.nat) return
      e.preventDefault()
      const r = sc.getBoundingClientRect()
      zoomTo(live.current.z * Math.exp(-e.deltaY * 0.002), { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing])
  // the hand: a drag moves the zoomed picture. A click does nothing here (his order 10-01, "disable
  // click play", "only for the enhance module"): ▶ plays and pauses
  const pressPicture = (e: React.MouseEvent): void => {
    const sc = scrollerRef.current
    if (!sc || e.button !== 0) return
    const r = sc.getBoundingClientRect()
    if (e.clientX - r.left >= sc.clientWidth || e.clientY - r.top >= sc.clientHeight) return // the scroll bars are theirs
    e.preventDefault()
    const x0 = e.clientX
    const y0 = e.clientY
    const l0 = sc.scrollLeft
    const t0 = sc.scrollTop
    let moved = false // under 4 px it stays a click (a double-click's half)
    const move = (ev: MouseEvent): void => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      if (!moved) setPanning(true)
      moved = true
      sc.scrollLeft = l0 - (ev.clientX - x0)
      sc.scrollTop = t0 - (ev.clientY - y0)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setPanning(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // his ask 10-01, "dbl click gores back to 100%": 100 % (the after's own pixels) with that spot in the
  // middle; at 100 % it goes back to fit (Lightroom's toggle)
  const dblPicture = (e: React.MouseEvent): void => {
    const sc = scrollerRef.current
    if (!sc || !live.current.nat) return
    const r = sc.getBoundingClientRect()
    if (e.clientX - r.left >= sc.clientWidth || e.clientY - r.top >= sc.clientHeight) return
    if (zoom !== 'fit' && Math.abs(live.current.z - 1) < 0.005) setZoom('fit')
    else zoomTo(1, { x: e.clientX - r.left, y: e.clientY - r.top }, true)
  }
  const runPreview = (): void => {
    if (!src || !local || why) return
    const at = beforeRef.current?.currentTime ?? 0
    setPreviewing('starting…')
    setPreviewErr('')
    const off = vd().onEnhanceProgress((p) => setPreviewing(p.msg))
    void vd()
      .enhancePreview({ source: src.kind === 'take' ? { kind: 'take', clipId: src.clipId, takeId: src.takeId } : { kind: 'video', videoId: src.videoId }, ...(interpOn ? { interp: ia } : {}), ...(upscaleOn ? { upscale: ua } : {}), preview: { atSec: at, sec: 2 } })
      .then((r) => {
        if (r.ok && r.file) setAfter({ file: r.file, offset: at, ratio: interpOn ? Math.max(1, ia.slowmo || 1) : 1, label: 'after · preview (2 s)', span: Math.min(2, Math.max(0.5, (beforeRef.current?.duration || at + 2) - at)) })
        else setPreviewErr(r.error ?? 'the preview failed')
      })
      .catch((e) => setPreviewErr(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        off()
        setPreviewing(null)
      })
  }

  // ---- run it: the copy lands as a take (and next to a Library source) ----
  const job = (): Parameters<typeof enqueueRender>[0] => ({
    kind: 'enhance' as const,
    label: `${name} · enhance`,
    engineLabel: [interpOn ? ie.label : '', upscaleOn ? ue.label : ''].filter(Boolean).join(' → '),
    estCost: plan?.cost.usd,
    thumbVideo: file,
    payload: {
      source: src!.kind === 'take' ? { kind: 'take', clipId: src!.clipId, takeId: src!.takeId } : { kind: 'video', videoId: src!.videoId },
      ...(interpOn ? { interp: ia } : {}),
      ...(upscaleOn ? { upscale: ua } : {}),
      // Optical Flow's blocks switch only to what they asked for: more frames, the same length
      ...(src?.flow?.itemIds.length && interpOn && smoother ? { adoptItemIds: src.flow.itemIds } : {})
    }
  })

  // ---- the empty window takes a take or a Library video dropped on it ----
  const onDrop = (e: React.DragEvent): void => {
    const tk = e.dataTransfer.getData(MIME_TAKE)
    const vid = e.dataTransfer.getData(MIME_VIDEO)
    if (!tk && !vid) return
    e.preventDefault()
    try {
      if (tk) {
        const o = JSON.parse(tk) as { clipId?: string; takeId?: string }
        if (o.clipId && o.takeId) openEnhance({ kind: 'take', clipId: o.clipId, takeId: o.takeId })
      } else openEnhance({ kind: 'video', videoId: vid })
    } catch {
      /* not ours */
    }
  }
  const dropProps = { onDragOver: (e: React.DragEvent) => e.preventDefault(), onDrop }

  if (!src || !file)
    return (
      <div className="vd-panel" style={{ height: '100%' }} {...dropProps}>
        <EmptyState>
          nothing open — right-click a take in Clip Gen, a timeline block or a Library video: <b>enhance…</b> — or drop one here
        </EmptyState>
      </div>
    )

  // ---- one section: its switch, its pills, its model, its settings ----
  const field = (f: EnhanceField, value: unknown, set: (v: number | boolean | string) => void): React.JSX.Element => (
    <div key={f.key} title={f.title} style={{ flex: '0 0 auto' }}>
      <div style={lb}>{f.kind === 'number' ? `${f.label} · ${Number(value ?? f.def)}` : f.label}</div>
      {f.kind === 'number' ? (
        <input type="range" min={f.min} max={f.max} step={f.step} value={Number(value ?? f.def)} onChange={(e) => set(Number(e.target.value))} style={{ width: 130 }} />
      ) : f.kind === 'bool' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', height: 24, cursor: 'pointer' }}>
          <input type="checkbox" checked={value === undefined ? f.def : !!value} onChange={(e) => set(e.target.checked)} /> on
        </label>
      ) : (
        <Dropdown value={String(value ?? f.def)} options={f.options} onChange={(v) => set(v)} />
      )}
    </div>
  )
  const pills = (list: EnhanceEngine[], cur: string, pick: (id: string) => void): React.JSX.Element => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {list.map((e) => (
        <span key={e.id} data-pill={e.id} className={e.id === cur ? 'btn vd-hbtn' : 'btn vd-hbtn ghost'} title={`${e.about}\n${e.priceNote}`} onClick={() => pick(e.id)}>
          {e.label}
        </span>
      ))}
    </div>
  )
  const status = (e: EnhanceEngine): React.JSX.Element | null => {
    const w = engineWhy(e)
    if (!w) return <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>{e.priceNote}</div>
    return (
      <div data-engine-why style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
        {w}
        {e.where === 'local' && tools && (
          <span className="btn vd-hbtn" title="the Models card downloads it once — its size is on the row" onClick={() => void modelWizard(e.modelRow!)}>
            download · {localModelFor(e.modelRow!)?.sizeNote ?? ''}
          </span>
        )}
        {e.where === 'fal' && (
          <span className="btn vd-hbtn" onClick={() => openKeyWizard(keySupplier('fal'), 'ENHANCE runs this engine on your fal key.')}>
            add the fal key
          </span>
        )}
        {e.where === 'topaz' && tools && !tools.topaz.found && (
          <span className="btn vd-hbtn ghost" onClick={() => void vd().enhanceTools(true).then(setTools)} title="look again, after installing Topaz Video">
            re-check
          </span>
        )}
      </div>
    )
  }
  const onSwitch = (on: boolean, set: (v: boolean) => void, label: string): React.JSX.Element => (
    <label data-switch={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: on ? 'var(--amber)' : 'var(--dim)', cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {on ? 'on' : 'off'}
    </label>
  )
  const topazModel = (sec: EnhanceSection, id?: string): EnhanceTopazModel | undefined => (tools?.topaz[sec] ?? []).find((m) => m.id === id)
  const pickModel = (e: EnhanceEngine, cur: string | undefined, set: (v: string) => void): React.JSX.Element | null => {
    const opts = modelsOf(e)
    if (!opts.length) return null
    const value = opts.some((o) => o.value === cur) ? cur! : opts[0].value
    if (value !== cur) queueMicrotask(() => set(value))
    return (
      <div style={{ flex: '0 0 auto' }}>
        <div style={lb}>model</div>
        <Dropdown value={value} options={opts} onChange={set} style={{ minWidth: 190 }} title={opts.find((o) => o.value === value)?.title ?? e.about} />
      </div>
    )
  }

  const tone = enhanceTone(mark)
  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} {...dropProps}>
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span title="interpolate and upscale — every result is a copy; the source is never changed" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)' }}>
            enhance
          </span>
          <span style={{ fontSize: 12, color: 'var(--txt-hi)', fontWeight: 600 }}>{name}</span>
          {mark && (
            <span style={{ fontSize: 10, color: tone }} title="this is already an enhanced copy — a second run adds to what was done">
              {enhanceWords(mark)}
            </span>
          )}
          {facts && <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{`${facts.w}×${facts.h} · ${Math.round(facts.fps * 100) / 100} fps · ${fmtSec(facts.sec)}`}</span>}
        </div>
        {src.flow && (
          <div data-flow style={{ fontSize: 11, color: 'var(--amber)', border: '1px dashed var(--amber-dim)', borderRadius: 4, padding: '4px 8px', marginBottom: 8 }}>
            Optical Flow: a copy with ×{src.flow.times} the frames and the same length — {src.flow.itemIds.length} timeline block{src.flow.itemIds.length === 1 ? '' : 's'} play it when it lands.
          </div>
        )}

        {/* ---- the monitor ---- */}
        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="btn vd-hbtn" onClick={togglePlay} title="play / pause both"><Ic i={playing ? Pause : Play} size={11} /></span>
            <span className="btn vd-hbtn" onClick={() => setMuted((m) => !m)} title="the source's sound"><Ic i={muted ? VolumeX : Volume2} size={11} /></span>
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>replay</span>
            <Dropdown value={String(rate)} options={RATES.map((r) => ({ value: String(r), label: pct(r) }))} onChange={(v) => setRate(Number(v))} title="replay speed — slowed down, the before side repeats frames and the after side does not" />
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>zoom</span>
            <Dropdown
              value={zoom === 'fit' ? 'fit' : Math.abs(z - 1) < 0.005 ? '1' : Math.abs(z - 2) < 0.005 ? '2' : `${Math.round(z * 100)} %`}
              options={[{ value: 'fit', label: 'fit' }, { value: '1', label: '100 %' }, { value: '2', label: '200 %' }]}
              onChange={(v) => (v === 'fit' ? setZoom('fit') : zoomTo(Number(v)))}
              title="100 % = the after's own pixels (at fit, a 720p and a 4K look alike) · the mouse wheel zooms at the pointer · drag the picture to move it · double-click the picture: 100 %, again: fit"
            />
            <span
              className="btn vd-hbtn ghost"
              data-preview
              style={{ marginLeft: 'auto', ...(!local || !!why || !!previewing ? { opacity: 0.45, cursor: 'default' } : {}) }}
              title={!local ? 'online engines cost money — the slide bar compares after the run' : why || 'runs the picked engines on 2 seconds at the playhead — free, nothing saved'}
              onClick={runPreview}
            >
              {previewing ?? 'preview 2 s'}
            </span>
          </div>
          <div ref={boxRef} data-monitor style={{ position: 'relative', height: boxH, background: '#000', borderRadius: 6, overflow: 'hidden' }}>
            {/* the picture: zooms and scrolls inside its viewport; the slide bar and labels sit over it */}
            <div
              ref={scrollerRef}
              data-viewport
              onMouseDown={pressPicture}
              onDoubleClick={dblPicture}
              onScroll={syncSplit}
              title={zoom === 'fit' ? 'double-click: 100 % · the wheel zooms · ▶ plays' : 'drag to move the picture · the wheel zooms · double-click: 100 %, again: fit · ▶ plays'}
              style={{ position: 'absolute', inset: 0, overflow: zoom === 'fit' ? 'hidden' : 'auto', cursor: zoom === 'fit' ? 'zoom-in' : panning ? 'grabbing' : 'grab' }}
            >
              <div style={{ position: 'relative', display: 'grid', placeItems: 'center', minWidth: '100%', minHeight: '100%', width: 'max-content', height: 'max-content' }}>
                <div ref={stageRef} data-stage style={{ position: 'relative', width: stage ? stage.w : box.w || '100%', height: stage ? stage.h : box.h || '100%' }}>
                  <video
                    ref={beforeRef}
                    data-before
                    src={mediaUrl(file)}
                    autoPlay
                    loop
                    muted={muted}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onLoadedMetadata={(e) => {
                      setDur(e.currentTarget.duration || 0)
                      if (!after) setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
                      e.currentTarget.playbackRate = rate
                    }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                  {after && (
                    <video
                      ref={afterRef}
                      data-after
                      src={mediaUrl(after.file)}
                      muted
                      playsInline
                      onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  )}
                </div>
              </div>
            </div>
            {after && (
              <>
                <div ref={handleRef} data-split onMouseDown={dragSplit} title="drag: before on the left, after on the right" style={{ position: 'absolute', top: 0, width: 14, marginLeft: -7, cursor: 'ew-resize', zIndex: 3 }}>
                  <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.4)' }} />
                </div>
                <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 9.5, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 4, padding: '1px 5px', pointerEvents: 'none' }}>before</span>
                <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 9.5, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 4, padding: '1px 5px', pointerEvents: 'none' }}>{after.label}</span>
              </>
            )}
            {!after && (
              <span style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.7)', pointerEvents: 'none' }}>
                no after yet — a preview or a finished copy shows here, split with the before
              </span>
            )}
          </div>
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              const y0 = e.clientY
              const h0 = boxH
              const move = (ev: MouseEvent): void => setBoxH(Math.max(140, Math.min(900, h0 + ev.clientY - y0)))
              const up = (): void => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
            title="drag to resize the monitor"
            style={{ height: 6, cursor: 'ns-resize' }}
          />
          <input
            ref={scrubRef}
            data-scrub
            type="range"
            min={0}
            max={dur || 0}
            step={0.01}
            defaultValue={0}
            onInput={(e) => {
              if (beforeRef.current) beforeRef.current.currentTime = Number(e.currentTarget.value)
            }}
            style={{ width: '100%' }}
            title="scrub"
          />
          {previewErr && <div style={{ fontSize: 11, color: 'var(--bad)' }}>✕ {previewErr}</div>}
          {copies.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={lb}>copies made from it — click one to compare</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {copies.map((c) => (
                  <span
                    key={c.id}
                    data-copy={c.id}
                    onClick={() => setAfter({ file: c.file, offset: 0, ratio: 0, label: `after · ${c.label}` })}
                    title={`${c.label} — ${enhanceWords(c.mark)}`}
                    style={{ borderRadius: 6, boxShadow: `0 0 0 2px ${enhanceTone(c.mark)}`, cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', gap: 2, padding: 3, background: 'var(--bg2)', outline: after?.file === c.file ? '2px solid var(--amber)' : undefined, outlineOffset: 2 }}
                  >
                    <Thumbnail videoFile={c.file} w={96} h={54} />
                    <span style={{ fontSize: 9, color: 'var(--dim)', maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.label} · {enhanceWords(c.mark)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---- INTERPOLATE ---- */}
        <Section title="interpolate" collapsible open={fold.interp} onToggle={() => setFold((f) => ({ ...f, interp: !f.interp }))} right={onSwitch(interpOn, setInterpOn, 'interp')}>
          <div data-section="interp" style={{ opacity: interpOn ? 1 : 0.5 }}>
            {pills(INTERP_ENGINES, ia.engine, (id) => setIa((a) => ({ ...a, engine: id, model: undefined })))}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {pickModel(ie, ia.model, (v) => setIa((a) => ({ ...a, model: v })))}
              <div style={{ flex: '0 0 auto' }}>
                <div style={lb}>for</div>
                <Dropdown
                  value={smoother ? 'smooth' : 'slow'}
                  options={[
                    { value: 'smooth', label: 'smoother — same length', title: 'more frames each second; the copy runs as long as the source, with its sound' },
                    { value: 'slow', label: 'slow motion — longer', disabled: !ie.slowmo, title: ie.slowmo ? 'the copy runs longer at the same frame rate; it has no sound' : `${ie.label} makes no slow motion` }
                  ]}
                  onChange={(v) => setIa((a) => (v === 'smooth' ? { ...a, slowmo: 1, times: Math.max(2, a.times || 2) } : { ...a, slowmo: Math.max(2, a.times || 2), times: 1, fps: undefined }))}
                />
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <div style={lb}>{smoother ? 'frames' : 'how much slower'}</div>
                <Dropdown
                  value={smoother ? (ia.fps ? 'fps' : String(ia.times)) : String(ia.slowmo)}
                  options={[
                    ...[2, 4, 8].map((n) => {
                      const tooMany = !!ie.maxTimes && n > ie.maxTimes
                      const tooFast = smoother && !!ie.fpsRange && !!facts && facts.fps * n > ie.fpsRange[1] + 0.01
                      return { value: String(n), label: `×${n}`, disabled: tooMany || tooFast, title: tooMany ? `${ie.label} makes at most ×${ie.maxTimes}` : tooFast ? `${ie.label} makes at most ${ie.fpsRange![1]} fps` : undefined }
                    }),
                    ...(smoother ? [{ value: 'fps', label: 'to a frame rate' }] : [])
                  ]}
                  onChange={(v) =>
                    setIa((a) => (smoother ? (v === 'fps' ? { ...a, fps: Math.min(60, Math.round((facts?.fps ?? 24) * 2)) } : { ...a, times: Number(v), fps: undefined }) : { ...a, slowmo: Number(v), times: 1 }))
                  }
                />
              </div>
              {smoother && ia.fps != null && (
                <div style={{ flex: '0 0 auto' }}>
                  <div style={lb}>frame rate</div>
                  <input
                    type="number"
                    min={ie.fpsRange?.[0] ?? 1}
                    max={ie.fpsRange?.[1] ?? 240}
                    value={ia.fps}
                    onChange={(e) => setIa((a) => ({ ...a, fps: Math.max(1, Number(e.target.value) || 1) }))}
                    style={{ width: 70, background: 'var(--field)', color: 'var(--txt-hi)', border: '1px solid var(--line)', borderRadius: 4, padding: '4px 6px', fontSize: 12 }}
                  />
                </div>
              )}
              {ie.fields.map((f) => field(f, ia.settings?.[f.key], (v) => setIa((a) => ({ ...a, settings: { ...(a.settings ?? {}), [f.key]: v } }))))}
            </div>
            {status(ie)}
          </div>
        </Section>

        {/* ---- UPSCALE ---- */}
        <Section title="upscale" collapsible open={fold.upscale} onToggle={() => setFold((f) => ({ ...f, upscale: !f.upscale }))} right={onSwitch(upscaleOn, setUpscaleOn, 'upscale')}>
          <div data-section="upscale" style={{ opacity: upscaleOn ? 1 : 0.5 }}>
            {pills(UPSCALE_ENGINES, ua.engine, (id) => setUa((a) => ({ ...a, engine: id, model: undefined })))}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {pickModel(ue, ua.model, (v) => setUa((a) => ({ ...a, model: v })))}
              <div style={{ flex: '0 0 auto' }}>
                <div style={lb}>size</div>
                <Dropdown
                  value={ua.height ? String(ua.height) : `x${ua.scale ?? 2}`}
                  options={[
                    { value: 'x2', label: '×2' },
                    { value: 'x4', label: '×4' },
                    { value: '1080', label: '1080p' },
                    { value: '2160', label: '2160p (4K)' }
                  ]}
                  onChange={(v) => setUa((a) => (v.startsWith('x') ? { ...a, scale: Number(v.slice(1)), height: undefined } : { ...a, height: Number(v), scale: undefined }))}
                />
              </div>
              {ue.fields.map((f) => field(f, ua.settings?.[f.key], (v) => setUa((a) => ({ ...a, settings: { ...(a.settings ?? {}), [f.key]: v } }))))}
              {/* Topaz on this PC: the picked model's own sliders, read from its model file */}
              {ue.where === 'topaz' &&
                (topazModel('upscale', ua.model ?? modelsOf(ue)[0]?.value)?.sliders ?? []).map((sl) =>
                  field({ key: sl.key, label: sl.label, kind: 'number', min: sl.min, max: sl.max, step: 0.05, def: sl.def }, ua.settings?.[sl.key], (v) => setUa((a) => ({ ...a, settings: { ...(a.settings ?? {}), [sl.key]: v } })))
                )}
            </div>
            {status(ue)}
          </div>
        </Section>

        {/* the copy it makes */}
        {plan && (
          <div data-plan style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 2px', fontFamily: 'var(--mono)' }}>
            the copy: {plan.w}×{plan.h} · {Math.round(plan.fps * 100) / 100} fps · {fmtSec(plan.sec)}
            {interpOn && upscaleOn ? ' · interpolate first, then upscale' : ''}
            {plan.cost.note ? ` · ${plan.cost.note}` : ''}
          </div>
        )}
      </div>

      {why && why !== 'nothing open' && <div style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--bad)' }}>✕ {why}</div>}
      <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
        <span
          className="btn"
          data-run
          style={{ flex: 1, textAlign: 'center', opacity: why ? 0.45 : 1, cursor: why ? 'not-allowed' : undefined }}
          aria-disabled={!!why}
          title={why || 'starts now, alongside anything running — the copy lands as a new take'}
          onClick={() => !why && renderNow(job())}
        >
          {`▶ Enhance now · ${[interpOn ? ie.label : '', upscaleOn ? ue.label : ''].filter(Boolean).join(' → ') || '—'}${costFace ? ` · ${costFace}` : ''}`}
        </span>
        <span
          className="btn"
          data-queue
          style={{ flex: '0 0 auto', textAlign: 'center', opacity: why ? 0.45 : 1, cursor: why ? 'not-allowed' : undefined }}
          aria-disabled={!!why}
          title={why || 'add to the render queue — runs in order, one at a time'}
          onClick={() => !why && enqueueRender(job())}
        >
          ＋ Queue
        </span>
      </div>
    </div>
  )
}
