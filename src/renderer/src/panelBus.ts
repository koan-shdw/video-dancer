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
