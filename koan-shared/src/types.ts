// Shared types — one copy (SPEC.md). Apps re-export from their own shared/types.ts so
// existing import sites keep working.

// ----- LoRA shelf (bible 12.10) — dynamic rows beside the model registry -----
export interface LoraSidecar {
  source: 'civitai' | 'hf' | 'local'
  name: string
  author?: string
  thumb?: string // remote URL — proxied through main as a data URL (CSP stays hardened)
  triggerWords?: string[]
  baseModel?: string
  homepage?: string
  sha256?: string
  scanned?: boolean // weight scan ran clean at install; false = engine absent, scan skipped
}
export interface LoraRow {
  file: string
  bytes: number
  sidecar?: LoraSidecar
}
export interface LoraCatalogItem {
  key: string // stable identity: 'civitai:<versionId>' | 'hf:<repo>'
  source: 'civitai' | 'hf'
  name: string
  author?: string
  thumb?: string
  triggerWords: string[]
  baseModel: string
  file: string // basename it lands as
  url: string // download URL (civitai key appended at install, never stored)
  bytes?: number
  sha256?: string
  downloads?: number
  homepage?: string
}
