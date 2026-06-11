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
