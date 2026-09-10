import type { Project, Timeline } from './types'

export const DEFAULT_WATCH_MODEL = 'gemini-3.6-flash'
export interface WatchTimelineRequest { timelineId: string; question?: string; range?: 'full' | 'selection' }
export interface WatchTimelineResult {
  ok: boolean; text?: string; error?: string; warning?: string; via?: 'gemini' | 'frames'; model?: string; tokens?: number
  timelineName?: string; startSec?: number; durationSec?: number
}
export interface WatchBakeRequest { id: string; project: Project; timeline: Timeline; plan: { W: number; H: number; fps: number } }
export interface WatchBakeReply { id: string; bakes?: { start: number; end: number; file: string }[]; error?: string }
