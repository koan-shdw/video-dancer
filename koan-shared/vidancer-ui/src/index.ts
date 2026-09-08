// @koan/vidancer-ui — the public surface. Two consumers: vi-dancer's Electron shell and shdw.work.
export { default as App } from './App'
// Workspace = the same App. Layout, welcome, tour and what's-new are all driven by the settings the
// bridge returns (workspaces, welcomeSeen, tourDone), so a consumer chooses the layout and silences
// the modals through its VidancerApi, not through props. Zero pixels differ between the two names.
export { default as Workspace } from './App'
export { MirrorView } from './preview/MirrorView'
export { setVidancerApi, vd, type VidancerBridge } from './api'
export { setMediaBase, mediaUrl, thumbUrl } from './media'
export { useStore } from './store'
export { openModelsCard } from './panelBus'
export { confirmDialog, textPrompt, alertDialog } from './prompt'
