import { vd } from '../api'
// EXPORT BAKER — the missing half of export parity. The SAME chain module the Monitor previews
// with (createFxChain) steps frame-by-frame at export resolution and streams RGBA rows to
// main's ffmpeg segment encoder (fx:bakeStart → fx:encodeFrame → fx:encodeEnd); export:run then
// splices the baked segments over the raw takes (audio stays with the originals). Parity is
// structural: one chain, one layer-assembly rule (mirrors Monitor drawFx exactly), one cover
// fit — a preview lie can only exist where this file diverges from the Monitor, so any change
// to the Monitor's layer assembly must land here in the same commit.
//
// PARITY LAW (WORKFLOW doctrine): effects that cannot bake must never silently drop — a bake
// failure ABORTS the whole export with the error surfaced. There is no partial fallback.

import { createFxChain } from './core/chain'
import type { FxLayerInput } from './core/types'
import { getEffect } from './core/registry'
import './effects'
import { readFx2 } from './fxData'
import { fxSpans, hiddenVideoTracks, sidecarsOf } from './fxUtils'
import { seekTo } from './passRunner'
import { mediaUrl } from '../media'
import { effDur, extentOf, itemAt, audioEndOf, resolveView, sourceTimeAt, startOf } from '../lib/timelineUtils'
import { beatAtTime, beatRefImageUrl } from '../lib/beatUtils'

export interface ExportBake {
  start: number
  end: number
  file: string
}

let cancelRequested = false
// safe any time — the current frame finishes, the half-written segment is discarded by the
// encoder, and startExport surfaces a clean "cancelled"
export function cancelBake(): void {
  cancelRequested = true
}

const VIDEO_OPEN_TIMEOUT = 15000

export async function bakeFxSpans(project: Project, tl: Timeline, onMsg: (msg: string) => void, options?: { plan: { W: number; H: number; fps: number }; signal: AbortSignal; onBake: (bake: ExportBake) => void }): Promise<ExportBake[]> {
  options?.signal.throwIfAborted()
  const clips = project.clips
  const items = tl.items
  const hidden = hiddenVideoTracks(tl)
  const musicEnd = audioEndOf(tl, project.audio ?? [])
  let spans = fxSpans(items, clips, hidden, musicEnd)
  // intersect with the export window — frames outside it would be baked and then never used
  const hasRange = tl.rangeInSec != null && tl.rangeOutSec != null && tl.rangeOutSec > tl.rangeInSec
  if (hasRange)
    spans = spans
      .map((s) => ({ start: Math.max(s.start, tl.rangeInSec!), end: Math.min(s.end, tl.rangeOutSec!) }))
      .filter((s) => s.end - s.start > 0.02)
  if (spans.length === 0) return [] // no fx anywhere — the classic export path handles everything
  cancelRequested = false

  const plan = options?.plan ?? await vd().exportPlan(tl.id)
  if (!plan) throw new Error('export plan unavailable')
  const { W, H, fps } = plan

  // hidden decode pool — one <video> per unique file, opened once, reused across spans/frames
  const pool = new Map<string, HTMLVideoElement>()
  const ensureVideo = async (file: string): Promise<HTMLVideoElement> => {
    const url = mediaUrl(file)
    const hit = pool.get(url)
    if (hit) return hit
    const v = document.createElement('video')
    v.src = url
    v.muted = true
    v.preload = 'auto'
    pool.set(url, v)
    await new Promise<void>((res, rej) => {
      if (v.readyState >= 2) return res()
      v.addEventListener('loadeddata', () => res(), { once: true })
      v.addEventListener('error', () => rej(new Error(`bake: media failed to open (${file})`)), { once: true })
      setTimeout(() => rej(new Error(`bake: media failed to open in ${VIDEO_OPEN_TIMEOUT / 1000}s (${file})`)), VIDEO_OPEN_TIMEOUT)
    })
    return v
  }
  // storyboard stills (take-less blocks inside a span) — the classic path shows the beat's ref
  // image; the bake must show the same picture, not black
  const stillCache = new Map<string, ImageBitmap | null>()
  const ensureStill = async (url: string): Promise<ImageBitmap | null> => {
    if (stillCache.has(url)) return stillCache.get(url) ?? null
    const bmp = await new Promise<ImageBitmap | null>((res) => {
      const img = new Image()
      img.onload = () => createImageBitmap(img).then(res, () => res(null))
      img.onerror = () => res(null)
      img.src = url
    })
    stillCache.set(url, bmp)
    return bmp
  }

  const takeFileOfItem = (it: TimelineItem): string | undefined => {
    const c = clips.find((x) => x.id === it.clipId)
    return c ? resolveView(c, it).take?.file : undefined
  }
  // per-cycle progress, same math as the Monitor (⟲ every repeat restarts its arc)
  const prog = (x: TimelineItem, T: number): number => {
    const cyc = Math.max(0.01, effDur(x, clips))
    let rel = T - startOf(x)
    if (x.loop && rel >= cyc) rel = rel % cyc
    return Math.max(0, Math.min(1, rel / cyc))
  }

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const chain = createFxChain(canvas, { strict: true }) // strict: an unready layer THROWS instead of baking black
  chain.resize(W, H)
  const rowBytes = W * 4
  const flip = new Uint8Array(W * H * 4) // reused every frame; readPixels rows arrive bottom-up

  const bakes: ExportBake[] = []
  try {
    for (let si = 0; si < spans.length; si++) {
      const span = spans[si]
      const frames = Math.max(1, Math.round((span.end - span.start) * fps))
      options?.signal.throwIfAborted()
      const started = await vd().fxBakeStart(W, H, fps, project.dir)
      if (!started.ok || !started.id || !started.file) throw new Error(started.error ?? 'bake encoder failed to start')
      const encId = started.id
      try {
        for (let k = 0; k < frames; k++) {
          if (cancelRequested) throw new Error('cancelled')
          options?.signal.throwIfAborted()
          const T = span.start + (k + 0.5) / fps // mid-frame sample, same convention as the pass runner
          // ---- layer assembly — MIRRORS Monitor drawFx: top item + up to 3 lower-track unders ----
          const top = itemAt(items, clips, T, hidden, musicEnd)
          const layers: FxLayerInput[] = []
          const seeks: Promise<void>[] = []
          if (top) {
            const unders = items
              .filter(
                (x) =>
                  x.id !== top.id &&
                  !x.disabled &&
                  !hidden.has(x.track ?? 0) &&
                  (x.track ?? 0) < (top.track ?? 0) &&
                  startOf(x) <= T &&
                  T < extentOf(x, items, clips, musicEnd) &&
                  takeFileOfItem(x)
              )
              .sort((a, b) => (a.track ?? 0) - (b.track ?? 0))
              .slice(-3)
            for (const u of unders) {
              const el = await ensureVideo(takeFileOfItem(u)!)
              seeks.push(seekTo(el, sourceTimeAt(u, clips, T)))
              layers.push({ video: el, fx: readFx2(u) ?? undefined, fade: 1, progress: prog(u, T), flatDepth: 0.5 })
            }
            const topFile = takeFileOfItem(top)
            if (topFile) {
              const el = await ensureVideo(topFile)
              const target = sourceTimeAt(top, clips, T)
              seeks.push(seekTo(el, target))
              const fxv = readFx2(top)
              let matte: HTMLVideoElement | null = null
              let depth: HTMLVideoElement | null = null
              if (fxv) {
                const needs = fxv.stack.reduce(
                  (acc, e) => {
                    const n = getEffect(e.type)?.needs
                    return { matte: acc.matte || !!n?.matte, depth: acc.depth || !!n?.depth }
                  },
                  { matte: false, depth: false }
                )
                if (needs.matte || needs.depth) {
                  const sc = await sidecarsOf(topFile)
                  if (needs.matte && sc.matte) {
                    matte = await ensureVideo(sc.matte)
                    seeks.push(seekTo(matte, target))
                  }
                  if (needs.depth && sc.depth) {
                    depth = await ensureVideo(sc.depth)
                    seeks.push(seekTo(depth, target))
                  }
                }
              }
              layers.push({ video: el, fx: fxv ?? undefined, matte, depth, fade: 1, progress: prog(top, T), flatDepth: 0.5 })
            } else {
              // take-less block inside a span (dissolve growth / merged spans): bake the same
              // still the classic path would show — beat ref, else storyboard face, else first ref
              const c = clips.find((x) => x.id === top.clipId)
              const view = c ? resolveView(c, top) : undefined
              const srcT = sourceTimeAt(top, clips, T)
              const beat = view?.beats.length ? view.beats[beatAtTime(view.beats, srcT)] : undefined
              const faceFile = c?.storyboardImageId ? project.images.find((i) => i.id === c.storyboardImageId)?.file : undefined
              const stillFile = view?.recipe.imageIds?.[0] ? project.images.find((i) => i.id === view.recipe.imageIds[0])?.file : undefined
              const url =
                (beat ? beatRefImageUrl(beat, view?.beatFreeform ?? '', project.images) : undefined) ??
                (faceFile ? mediaUrl(faceFile) : undefined) ??
                (stillFile ? mediaUrl(stillFile) : undefined)
              const bmp = url ? await ensureStill(url) : null
              if (bmp) layers.push({ video: bmp, fade: 1, progress: 0, flatDepth: 0.5 })
              // no still → no layer → the chain clears to black, exactly what export renders there
            }
          }
          await Promise.all(seeks)
          chain.render(layers)
          const px = chain.readPixels()
          for (let y = 0; y < H; y++) flip.set(px.subarray((H - 1 - y) * rowBytes, (H - y) * rowBytes), y * rowBytes)
          const ok = await vd().fxEncodeFrame(encId, flip) // backpressure honored main-side
          if (!ok) throw new Error('bake encoder died')
          if (k % 5 === 0 || k === frames - 1) onMsg(`baking effects ${si + 1}/${spans.length} · ${Math.round(((k + 1) / frames) * 100)}%`)
        }
        const fin = await vd().fxEncodeEnd(encId, true)
        if (!fin.ok || !fin.file) throw new Error(fin.error ?? 'bake encode failed')
        bakes.push({ start: span.start, end: span.end, file: fin.file })
        options?.onBake(bakes[bakes.length - 1])
      } catch (e) {
        void vd().fxEncodeEnd(encId, false) // discards the .part
        throw e
      }
    }
  } finally {
    chain.destroy()
    for (const el of pool.values()) {
      el.pause()
      el.removeAttribute('src')
      el.load() // release the decoder — pooled elements otherwise pin file handles until GC
    }
    pool.clear()
    for (const b of stillCache.values()) b?.close()
    stillCache.clear()
  }
  return bakes
}
