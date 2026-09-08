// EFFECTS v2 — the data shape. A block's effects are an ORDERED STACK of module entries plus
// one blend section (how the finished layer meets the layers below). This type is the renderer's
// working shape; schema v17 in shared/types.ts mirrors it once the data phase lands (the app must
// be closed to touch shared — until then everything here stays renderer-local).

import type { FxMedia } from './gl'

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'darken' | 'lighten' | 'softlight'
export const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'softlight']

export interface FxParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  def: number
  fmt?: 'pct' | 'deg' | 'raw' | 'toggle' // toggle: on/off button row (value 0|1), not a slider
  hint?: string // tooltip override for the row's control
}

export interface FxEntry {
  id: string // stable per entry — reorder/remove key
  type: string // registry module key
  params: Record<string, number>
}

export interface FxBlend {
  mode: BlendMode
  opacity: number // 0..1
}

export interface FxStack {
  stack: FxEntry[]
  blend?: FxBlend // absent = normal @ 1
}

export interface FxLayerInput {
  video: FxMedia
  matte?: FxMedia | null
  depth?: FxMedia | null
  fx?: FxStack
  fade: number // dissolve/transition multiplier 0..1 (multiplies blend opacity)
  progress: number // 0..1 through the block — modules read it via uCtx.x
  flatDepth: number // z-stack default when the sandwich module is absent (phase C)
}
