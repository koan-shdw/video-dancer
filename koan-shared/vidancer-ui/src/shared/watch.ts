import type { Project, Timeline } from './types'

// list 32: Gemini 3.8 Flash watches by default; 3.6 Flash, the one before it, still works when
// picked. Ids and prices off Google's model and pricing pages, read 2026-09-30: both take video
// and sound, and both cost the same ($0.75 in / $3.75 out per 1M through 2026, double after).
export const DEFAULT_WATCH_MODEL = 'gemini-3.8-flash'
export const WATCH_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash'] // the ones with a known price
export interface WatchTimelineRequest { timelineId: string; question?: string; range?: 'full' | 'selection' }
export interface WatchTimelineResult {
  ok: boolean; text?: string; error?: string; warning?: string; via?: 'gemini' | 'frames'; model?: string; tokens?: number
  timelineName?: string; startSec?: number; durationSec?: number
}
export interface WatchBakeRequest { id: string; project: Project; timeline: Timeline; plan: { W: number; H: number; fps: number } }
export interface WatchBakeReply { id: string; bakes?: { start: number; end: number; file: string }[]; error?: string }
