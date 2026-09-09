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

// and the Video Editor (v2v result trees — callers set the store's editorVideoRoot first)
let videoEditorOpener: (() => void) | null = null
export function setVideoEditorOpener(fn: (() => void) | null): void {
  videoEditorOpener = fn
}
export function openVideoEditor(): void {
  videoEditorOpener?.()
}

// and the Clip Editor (Bin clip double-click — same "double-click opens its editor" grammar)
let clipEditorOpener: (() => void) | null = null
export function setClipEditorOpener(fn: (() => void) | null): void {
  clipEditorOpener = fn
}
export function openClipEditor(): void {
  clipEditorOpener?.()
}

// and the Watched panel — opened when a watch folder is picked (and by the Library's 👁 button)
let watchOpener: (() => void) | null = null
export function setWatchOpener(fn: (() => void) | null): void {
  watchOpener = fn
}
export function openWatchPanel(): void {
  watchOpener?.()
}

// and the Library panel — pick popovers front it instead of opening over nothing (empty-gate law)
let libraryOpener: (() => void) | null = null
export function setLibraryOpener(fn: (() => void) | null): void {
  libraryOpener = fn
}
export function openLibraryPanel(): void {
  libraryOpener?.()
}

// the Settings modal — App owns the state; panels that need it open it through here
// (first user: the Bridge banner's Claude-lane buttons, BRIDGE-SPEC 2026-09-01)
let settingsOpener: (() => void) | null = null
export function setSettingsOpener(fn: (() => void) | null): void {
  settingsOpener = fn
}
export function openSettingsModal(): void {
  settingsOpener?.()
}

// and the Queue panel — raised whenever a paid job joins the queue
let queueOpener: (() => void) | null = null
export function setQueueOpener(fn: (() => void) | null): void {
  queueOpener = fn
}
export function openQueue(): void {
  queueOpener?.()
}

// and the Char Sheet editor (Bin ⛉ tile double-click / create — callers set the store's
// editorSheetId first, then raise the panel)
let charSheetOpener: (() => void) | null = null
export function setCharSheetOpener(fn: (() => void) | null): void {
  charSheetOpener = fn
}
export function openCharSheetPanel(): void {
  charSheetOpener?.()
}

// and the Score card (Bin ♪ tile double-click / create — callers set the store's
// editorScoreId first, then raise the panel)
let scoreCardOpener: (() => void) | null = null
export function setScoreCardOpener(fn: (() => void) | null): void {
  scoreCardOpener = fn
}
export function openScoreCard(): void {
  scoreCardOpener?.()
}

// the Voices card — raised by a char sheet's 🎤 button (VOICES-SPEC)
let voicesCardOpener: (() => void) | null = null
export function setVoicesCardOpener(fn: (() => void) | null): void {
  voicesCardOpener = fn
}
export function openVoicesCard(): void {
  voicesCardOpener?.()
}

// Sheet Gen (SHEET-GEN-SPEC-2026-09-08) — a sheet-tagged clip's Bin double-click, or a Library
// image's make-plate entries (callers selectClip first, then raise the panel)
let imageGenOpener: (() => void) | null = null
export function setImageGenOpener(fn: (() => void) | null): void {
  imageGenOpener = fn
}
export function openImageGen(): void {
  imageGenOpener?.()
}
let sheetGenOpener: (() => void) | null = null
export function setSheetGenOpener(fn: (() => void) | null): void {
  sheetGenOpener = fn
}
export function openSheetGen(): void {
  sheetGenOpener?.()
}

// and the Models card — raised whenever a model download starts anywhere (the card IS the
// download UI; other surfaces just point here), and by pickers offering an undownloaded model
let modelsCardOpener: (() => void) | null = null
export function setModelsCardOpener(fn: (() => void) | null): void {
  modelsCardOpener = fn
}
export function openModelsCard(): void {
  modelsCardOpener?.()
}

// and the Clip Monitor (a timeline-block double-click must ALWAYS surface it — even for the
// same slot again, even if the panel was closed)
let clipMonitorOpener: (() => void) | null = null
export function setClipMonitorOpener(fn: (() => void) | null): void {
  clipMonitorOpener = fn
}
export function openClipMonitor(): void {
  clipMonitorOpener?.()
}

// the Clip Monitor's play/pause, registered while that panel is mounted — the global spacebar
// drives WHICHEVER monitor is fronted, so it needs a handle on this one's transport.
// Returns false when there's nothing to play (no clip previewed) → the caller falls back.
let clipMonitorPlayToggle: (() => boolean) | null = null
export function setClipMonitorPlayToggle(fn: (() => boolean) | null): void {
  clipMonitorPlayToggle = fn
}
export function toggleClipMonitorPlay(): boolean {
  return clipMonitorPlayToggle?.() ?? false
}

// same for Clip Gen's take preview — space with the Clip Gen panel fronted drives it
let clipGenPlayToggle: (() => boolean) | null = null
export function setClipGenPlayToggle(fn: (() => boolean) | null): void {
  clipGenPlayToggle = fn
}
export function toggleClipGenPlay(): boolean {
  return clipGenPlayToggle?.() ?? false
}

// I / O with Clip Gen fronted mark the take preview's in/out at its playhead (Premiere grammar,
// same letters the timeline ruler uses for its range). False = no take previewed.
let clipGenMarkInOut: ((which: 'in' | 'out') => boolean) | null = null
export function setClipGenMarkInOut(fn: ((which: 'in' | 'out') => boolean) | null): void {
  clipGenMarkInOut = fn
}
export function markClipGenInOut(which: 'in' | 'out'): boolean {
  return clipGenMarkInOut?.(which) ?? false
}

// and the Effects panel (a timeline block's right-click → effects — callers select the block
// first; the panel follows selectedTlItemId)
let effectsOpener: (() => void) | null = null
export function setEffectsOpener(fn: (() => void) | null): void {
  effectsOpener = fn
}
export function openEffectsPanel(): void {
  effectsOpener?.()
}

// the Timeline Monitor's 📷 frame grab, registered while that panel is mounted — the timeline
// block menu's "current frame" rides the SAME grab as the monitor's camera button.
// Returns false when there's no monitor / no video frame → the caller says so.
let programFrameGrab: (() => boolean) | null = null
export function setProgramFrameGrab(fn: (() => boolean) | null): void {
  programFrameGrab = fn
}
export function grabProgramFrame(): boolean {
  return programFrameGrab?.() ?? false
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

// the Co-Director panel — Watched's "send to Co-Director" raises it with the box seeded (CIVIT-LIKES-SPEC)
let coDirectorOpener: (() => void) | null = null
export function setCoDirectorOpener(fn: (() => void) | null): void {
  coDirectorOpener = fn
}
export function openCoDirector(): void {
  coDirectorOpener?.()
}
