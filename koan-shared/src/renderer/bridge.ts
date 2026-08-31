// The bridge — the per-app noun firewall (SPEC.md). Shared renderer code never says
// window.vidancer or window.spritedancer: each app hands over its surface ONCE at startup
// (before first render), and everything shared talks through this handle. An app missing a
// member fails at typecheck, not in the field.
import type { LoraCatalogItem, LoraRow } from '../types'

export interface KoanBridgeApi {
  // the LoRA shelf wire (bible 12.10)
  lorasList: () => Promise<{ installed: LoraRow[]; jobs: { file: string; pct: number }[]; errors: Record<string, string> }>
  lorasCivitai: (query: string, sort: 'downloads' | 'newest') => Promise<{ ok: boolean; items?: LoraCatalogItem[]; error?: string }>
  lorasOfficial: () => Promise<{ ok: boolean; items?: LoraCatalogItem[]; error?: string }>
  lorasInstall: (item: LoraCatalogItem) => Promise<{ ok: boolean; error?: string }>
  lorasCancel: (file: string) => Promise<boolean>
  lorasDelete: (file: string) => Promise<boolean>
  lorasTag: (file: string, baseModel: string) => Promise<boolean>
  lorasThumb: (url: string) => Promise<string | null>
  lorasImport: (path: string) => Promise<{ ok: boolean; file?: string; error?: string }>
  onLorasProgress: (cb: (p: { file: string; pct: number; note?: string }) => void) => () => void
  onLorasDone: (cb: (p: { file: string; ok: boolean; error?: string }) => void) => () => void
  // settings + shell (only what shared code actually uses)
  getSettings: () => Promise<Record<string, unknown> | null>
  setSettings: (patch: Record<string, unknown>) => Promise<unknown>
  openExternal: (url: string) => Promise<unknown>
}

export interface KoanBridge {
  api: KoanBridgeApi
  openModels: () => void // fronts this app's Models card/panel
  confirm: (message: React.ReactNode, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>
  // OS file drops → absolute path. vi-dancer rides legacy File.path; sprite webUtils.
  pathForFile?: (f: File) => string | undefined
}

let bridge: KoanBridge | null = null
export function setKoanBridge(b: KoanBridge): void {
  bridge = b
}
export function getKoanBridge(): KoanBridge {
  if (!bridge) throw new Error('setKoanBridge() must run before any @koan/shared surface renders')
  return bridge
}
export const dropPath = (f: File): string | undefined => getKoanBridge().pathForFile?.(f) ?? (f as File & { path?: string }).path
