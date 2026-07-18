// lets a folder's right-click action ask App (which owns the dockview api) to open that folder
// as its own panel, docked as a tab next to the Bin/Library.
type Opener = (folderId: string, kind: 'bin' | 'lib', name: string) => void
let opener: Opener | null = null
export function setFolderOpener(fn: Opener | null): void {
  opener = fn
}
export function openFolderPanel(folderId: string, kind: 'bin' | 'lib', name: string): void {
  opener?.(folderId, kind, name)
}

// same pattern for the Timeline Editor: a Bin double-click asks App to open/raise the panel
let tlEditorOpener: (() => void) | null = null
export function setTimelineEditorOpener(fn: (() => void) | null): void {
  tlEditorOpener = fn
}
export function openTimelineEditor(): void {
  tlEditorOpener?.()
}

// and the Image Editor (Library double-click)
let imgEditorOpener: (() => void) | null = null
export function setImageEditorOpener(fn: (() => void) | null): void {
  imgEditorOpener = fn
}
export function openImageEditor(): void {
  imgEditorOpener?.()
}

// and the Clip Editor (Bin clip double-click — same "double-click opens its editor" grammar)
let clipEditorOpener: (() => void) | null = null
export function setClipEditorOpener(fn: (() => void) | null): void {
  clipEditorOpener = fn
}
export function openClipEditor(): void {
  clipEditorOpener?.()
}

// and the Clip Edit panel (v2v) — callers set the store's editTarget first, then raise the panel
let clipEditOpener: (() => void) | null = null
export function setClipEditOpener(fn: (() => void) | null): void {
  clipEditOpener = fn
}
export function openClipEdit(): void {
  clipEditOpener?.()
}

// and the Watched panel — opened when a watch folder is picked (and by the Library's 👁 button)
let watchOpener: (() => void) | null = null
export function setWatchOpener(fn: (() => void) | null): void {
  watchOpener = fn
}
export function openWatchPanel(): void {
  watchOpener?.()
}

// and the Queue panel — raised whenever a paid job joins the queue
let queueOpener: (() => void) | null = null
export function setQueueOpener(fn: (() => void) | null): void {
  queueOpener = fn
}
export function openQueue(): void {
  queueOpener?.()
}

// and the Timeline Monitor (raised on play AND on scrubbing the timeline ruler)
let tlMonitorOpener: (() => void) | null = null
export function setTimelineMonitorOpener(fn: (() => void) | null): void {
  tlMonitorOpener = fn
}
export function raiseTimelineMonitor(): void {
  tlMonitorOpener?.()
}

// and the Project Styles window (a modal App owns) — a style link-chip double-click opens it
// on that style, the header button opens it plain
let projectStylesOpener: ((styleId?: string) => void) | null = null
export function setProjectStylesOpener(fn: ((styleId?: string) => void) | null): void {
  projectStylesOpener = fn
}
export function openProjectStyles(styleId?: string): void {
  projectStylesOpener?.(styleId)
}

// dev-HMR guard: hot-replacing this module resets the slots to null while App's onReady (the only
// registrar) does NOT re-run — every opener silently no-ops until reload. Force the full reload.
if (import.meta.hot) import.meta.hot.invalidate()
