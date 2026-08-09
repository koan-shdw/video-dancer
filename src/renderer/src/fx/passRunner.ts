// AI PASS RUNNER — the app-side orchestrator. Fresh build: the engine and models live in
// passWorker.ts on their own thread; this file only feeds frames and collects results, so the
// app stays fully alive while a pass crunches. Cancellable at every frame.
//
// Flow: ensure model (main downloads once) → read bytes → worker init (capped GPU → steady
// wasm) → seek the take frame-by-frame → ImageBitmap → worker → gray frame → main's ffmpeg
// sidecar encoder (fx:encodeFrame IPC) → done toast + cache invalidate.

import { useStore } from '../store'
import { toast } from '../ui/Toast'
import { mediaUrl } from '../media'
import { invalidateSidecars } from './fxUtils'

let running = false
let cancelRequested = false

// the panel's cancel button — safe any time; a half-written sidecar is discarded by the encoder
export function cancelPass(): void {
  cancelRequested = true
}
export function passRunning(): boolean {
  return running
}

// robust seek: 'seeked' event with a metadata retry and a hard timeout — shared with the
// export baker (fx/baker.ts), keep it dependency-free
export const seekTo = (v: HTMLVideoElement, t: number): Promise<void> =>
  new Promise((res) => {
    let done = false
    const finish = (): void => {
      if (!done) {
        done = true
        v.removeEventListener('seeked', finish)
        res()
      }
    }
    v.addEventListener('seeked', finish)
    const kick = (): void => {
      try {
        v.currentTime = t
      } catch {
        v.addEventListener('loadedmetadata', () => (v.currentTime = t), { once: true })
      }
    }
    kick()
    setTimeout(finish, 1500)
  })

export async function runPass(takeFile: string, kind: 'matte' | 'depth'): Promise<boolean> {
  if (running) {
    toast('an AI pass is already running — one at a time', { kind: 'error' })
    return false
  }
  running = true
  cancelRequested = false
  const setJob = useStore.getState().setFxJob
  const label = kind === 'matte' ? 'subject matte' : 'depth pass'
  let encId: string | null = null
  let worker: Worker | null = null
  const offModel = window.vidancer.onFxModelProgress((p) => {
    if (p.kind === kind) setJob({ label: `downloading ${label} model · first time only`, pct: p.pct })
  })
  try {
    setJob({ label: `${label}: checking model`, pct: 0 })
    const ensured = await window.vidancer.fxEnsureModel(kind)
    if (!ensured.ok) throw new Error(ensured.error ?? 'model download failed')
    const modelBytes = await window.vidancer.fxReadModel(kind)
    if (!modelBytes) throw new Error('model unreadable after download')

    const probe = await window.vidancer.fxProbe(takeFile)
    if (!probe.width || !probe.height || probe.duration <= 0) throw new Error('take not probeable')
    const W = probe.width
    const H = probe.height
    const fps = probe.fps > 0 ? Math.max(12, Math.min(60, Math.round(probe.fps))) : 24
    const frames = Math.max(1, Math.floor(probe.duration * fps))

    // the worker owns the engine — phase labels stream back while it boots
    worker = new Worker(new URL('./passWorker.ts', import.meta.url), { type: 'module' })
    const w = worker
    const waitFor = <T,>(match: (m: { t: string }) => T | undefined): Promise<T> =>
      new Promise((res, rej) => {
        // BOTH listeners removed on every exit — the old once-'error' was only removed if it
        // fired, so a 720-frame pass stacked 720 dead error listeners on the worker
        const onErr = (e: ErrorEvent): void => {
          w.removeEventListener('message', on)
          rej(new Error(e.message || 'worker crashed'))
        }
        const on = (e: MessageEvent): void => {
          const m = e.data as { t: string; label?: string; message?: string }
          if (m.t === 'phase') {
            setJob({ label: `${label}: ${m.label}`, pct: 0 })
            return
          }
          if (m.t === 'fail') {
            w.removeEventListener('message', on)
            w.removeEventListener('error', onErr)
            rej(new Error(m.message))
            return
          }
          const hit = match(m as { t: string })
          if (hit !== undefined) {
            w.removeEventListener('message', on)
            w.removeEventListener('error', onErr)
            res(hit)
          }
        }
        w.addEventListener('message', on)
        w.addEventListener('error', onErr, { once: true })
      })
    const ready = waitFor((m) => (m.t === 'ready' ? true : undefined))
    // document.baseURI resolves correctly in BOTH dev (http://localhost:…/) and packaged
    // (file:///…/out/renderer/) — the worker itself cannot derive this (see passWorker init)
    const ortBase = new URL('ort/', document.baseURI).href
    w.postMessage({ t: 'init', kind, modelBytes, W, H, ortBase }, [modelBytes.buffer as ArrayBuffer])
    try {
      await ready
    } catch (initErr) {
      // a model that downloaded complete but can't PARSE would fail identically forever (the
      // downloader caches on existence) — drop it so the next attempt re-downloads fresh bytes
      const m = initErr instanceof Error ? initErr.message : String(initErr)
      if (/protobuf|parse|invalid|corrupt/i.test(m)) void window.vidancer.fxDeleteModel(kind)
      throw initErr
    }

    const started = await window.vidancer.fxPassStart(takeFile, kind, W, H, fps)
    if (!started.ok || !started.id) throw new Error(started.error ?? 'sidecar encoder failed to start')
    encId = started.id

    const video = document.createElement('video')
    video.src = mediaUrl(takeFile)
    video.muted = true
    video.preload = 'auto'
    // the take must be truly OPEN before the first frame — grabbing from an unloaded video
    // throws instantly and the whole pass dies in two silent seconds (the "0% then nothing" bug)
    await new Promise<void>((res, rej) => {
      if (video.readyState >= 2) return res()
      video.addEventListener('loadeddata', () => res(), { once: true })
      video.addEventListener('error', () => rej(new Error('take failed to open')), { once: true })
      setTimeout(() => rej(new Error('take failed to open (15s timeout)')), 15000)
    })

    setJob({ label, pct: 0 })
    for (let i = 0; i < frames; i++) {
      if (cancelRequested) throw new Error('cancelled')
      const t = Math.min(probe.duration - 0.02, (i + 0.5) / fps)
      await seekTo(video, t)
      const bitmap = await createImageBitmap(video)
      const grayP = waitFor<Uint8Array>((m) =>
        m.t === 'gray' ? ((m as unknown as { data: Uint8Array }).data) : undefined
      )
      w.postMessage({ t: 'frame', bitmap, index: i }, [bitmap])
      const gray = await grayP
      const ok = await window.vidancer.fxEncodeFrame(encId, gray)
      if (!ok) throw new Error('sidecar encoder died')
      if (i % 3 === 0 || i === frames - 1) setJob({ label, pct: Math.round(((i + 1) / frames) * 100) })
    }
    const fin = await window.vidancer.fxEncodeEnd(encId, true)
    encId = null
    if (!fin.ok) throw new Error(fin.error ?? 'sidecar encode failed')
    invalidateSidecars(takeFile)
    setJob(null)
    toast(`${label} ✓ — cached next to the take`, { kind: 'ok' })
    return true
  } catch (e) {
    if (encId) void window.vidancer.fxEncodeEnd(encId, false)
    setJob(null)
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'cancelled') toast(`${label} cancelled — nothing saved`, { kind: 'ok' })
    else {
      // console.error mirrors into main.log — a missed toast must never blind the diagnosis
      console.error(`fx pass failed [${kind}] ${takeFile}:`, e)
      toast(`${label} failed: ${msg}`, { kind: 'error' })
    }
    return false
  } finally {
    worker?.terminate()
    offModel()
    running = false
  }
}
