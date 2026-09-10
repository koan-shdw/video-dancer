// A recycled A/B player must not reveal the previous binding's decoded surface.
// readyState can still describe that surface just after src changes. Scope every
// asynchronous callback to this binding and wait for the requested presented frame.
export function prepareVideoFrame(
  el: HTMLVideoElement,
  opts: { url: string; target: number; sourceChanged: boolean; gate: boolean; onReady: () => void }
): () => void {
  let disposed = false
  let applied = false
  let presentedTime: number | undefined
  let frameCallback: number | undefined
  const listeners: [string, EventListener][] = []
  const listen = (name: string, fn: () => void): void => {
    listeners.push([name, fn])
    el.addEventListener(name, fn)
  }
  const dispose = (): void => {
    disposed = true
    for (const [name, fn] of listeners) el.removeEventListener(name, fn)
    if (frameCallback !== undefined) el.cancelVideoFrameCallback(frameCallback)
  }
  const hasFrameCallback = typeof el.requestVideoFrameCallback === 'function'
  const ready = (): boolean => {
    if (disposed || !applied || el.currentSrc !== opts.url || el.seeking || el.readyState < 2) return false
    // Allow one low-frame-rate frame around the requested time. currentTime alone
    // is not evidence: it updates immediately while the old image is still painted.
    if (Math.abs(el.currentTime - opts.target) > 0.05) return false
    if (hasFrameCallback && (presentedTime === undefined || Math.abs(presentedTime - opts.target) > 0.05)) return false
    dispose()
    opts.onReady()
    return true
  }
  const watchFrame = (): void => {
    if (disposed || !hasFrameCallback || frameCallback !== undefined) return
    frameCallback = el.requestVideoFrameCallback((_now, metadata) => {
      frameCallback = undefined
      if (disposed) return
      presentedTime = metadata.mediaTime
      if (!ready()) watchFrame()
    })
  }
  const apply = (): void => {
    if (disposed || applied || el.currentSrc !== opts.url) return
    applied = true
    if (!opts.gate) {
      try { el.currentTime = opts.target } catch { /* next scrub retries */ }
      dispose()
      opts.onReady() // same-block scrubbing keeps the current picture
      return
    }
    if (!opts.sourceChanged && !el.seeking && el.readyState >= 2 && Math.abs(el.currentTime - opts.target) < 0.000001) {
      // An unchanged source already displaying this exact time needs no new decode.
      dispose()
      opts.onReady()
      return
    }
    watchFrame()
    try {
      el.currentTime = opts.target
    } catch {
      applied = false // metadata will retry; never release the gate on a failed seek
    }
  }
  listen('loadedmetadata', apply)
  listen('loadeddata', () => { ready() })
  listen('seeked', () => { ready() })
  if (opts.gate) {
    el.pause()
    el.style.visibility = 'hidden'
    el.style.opacity = '0'
  }
  if (opts.sourceChanged) {
    // Wait for THIS source's metadata; the synchronous readyState may be stale.
    el.src = opts.url
  } else if (el.readyState >= 1) apply()
  return dispose
}
