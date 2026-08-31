// @koan/shared/main — main-process entry. One copy, every app reads it (SPEC.md).
export * as loraShelf from './loraShelf'
export { configureLoraShelf, type LoraShelfDeps } from './loraShelf'
export { registerLorasIpc } from './lorasIpc'
export type { LoraCatalogItem, LoraRow, LoraSidecar } from '../types'
