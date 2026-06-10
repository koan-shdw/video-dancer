// One audio owner across all <video> players. Whoever "focuses" becomes the only audible element;
// every other registered player is muted. Prevents the double-music bug (program + source + preview).
let current: HTMLVideoElement | null = null
const subs = new Set<() => void>()

export function focusAudio(el: HTMLVideoElement | null): void {
  if (current && current !== el) current.muted = true
  current = el
  if (el) el.muted = false
  subs.forEach((s) => s())
}

export function muteAll(): void {
  if (current) current.muted = true
  current = null
  subs.forEach((s) => s())
}

export function isAudioOwner(el: HTMLVideoElement | null): boolean {
  return !!el && current === el
}

// notified whenever ownership changes, so each player can sync its 🔊/🔇 icon to its element's muted state
export function subAudio(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}
