// Image-model paths (KREA2-LOCAL-SPEC-2026-09-08) — a leaf module with NO engine imports so
// ltxLocal's extra_model_paths writer and krea2Local can both read it without a cycle.
import { app } from 'electron'
import { join } from 'path'

const modelsRoot = (): string => join(app.getPath('userData'), 'models')
// official Krea 2 files (registry rows share this folder — LTX's video/ltx-2.5 pattern)
export const krea2Dir = (): string => join(modelsRoot(), 'image', 'krea-2')
// civit checkpoints: one folder per Civitai version id, the file + our sidecar inside
export const civitCheckpointsDir = (): string => join(modelsRoot(), 'image', 'civit')

// the user's picked LoRA folders (Settings `loraFolders`) — read IN PLACE, never copied; every
// one becomes a `loras` root in the engine's extra_model_paths so subfolder names resolve
let extraLoraDirs: string[] = []
export function setExtraLoraDirs(dirs: string[]): void {
  extraLoraDirs = [...new Set(dirs.filter((d) => typeof d === 'string' && d.trim()))]
}
export function getExtraLoraDirs(): string[] {
  return extraLoraDirs
}
