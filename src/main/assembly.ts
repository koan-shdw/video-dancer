// ASSEMBLY (docs/archive/ASSEMBLY-SPEC-2026-09-09): the Co-Director's first cut. CONCEPT reads the
// storyboard + brief + the conversation and writes an outline the user corrects and locks;
// ASSEMBLE watches the takes (WATCH-LANE), asks the strong model for placements, and cuts a NEW
// timeline the user refines. It proposes; the human cuts.
import { getProject, setAssembly, addTimeline, setTimelineItems, setActiveTimeline, mainEffDur } from './project'
import { runSubCalls, type SubCallOpts } from './subcall'
import { watchVideo, type WatchOpts } from './watch'
import type { Project, Timeline, TimelineItem, ProjectDelta } from '@koan/vidancer-ui/shared/types'

export type AssemblyOpts = SubCallOpts & { synthModel: string; watch: WatchOpts; onProgress?: (msg: string) => void }

const clipLine = (p: Project, it: TimelineItem, i: number): string => {
  const c = p.clips.find((x) => x.id === it.clipId)
  if (!c) return `${i + 1}. (missing clip)`
  const pd = c.promptData
  const beats = (pd.beats ?? []).map((b, k) => `    beat ${k + 1} "${b.name || 'shot'}" ${b.length || 0}s: ${[b.camera, b.action].filter(Boolean).join(' — ')}`).join('\n')
  const takes = c.takes.length ? `${c.takes.length} take${c.takes.length > 1 ? 's' : ''} (keeper T${Math.max(1, c.takes.findIndex((t) => t.id === c.keeperTakeId) + 1)})` : 'NO TAKES YET'
  return `${i + 1}. clip "${c.name}" (id=${c.id}) · ${pd.duration}s · ${takes}\n    prompt: ${(pd.freeform || '').slice(0, 240)}\n${beats}`
}

// the storyboard as text, in order
function storyboardText(p: Project, tl: Timeline): string {
  const items = [...tl.items].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
  return items.map((it, i) => clipLine(p, it, i)).join('\n')
}

// ---- CONCEPT: the outline (markdown), re-run with each correction ----
export async function assemblyConcept(correction: string | undefined, opts: AssemblyOpts): Promise<{ ok: true; delta: ProjectDelta; outline: string } | { ok: false; error: string }> {
  const p = getProject()
  if (!p) return { ok: false, error: 'no project open' }
  const tl = p.timelines.find((t) => t.id === p.activeTimelineId)
  if (!tl || tl.items.length === 0) return { ok: false, error: 'the storyboard is empty — put clips on the active timeline first' }
  const prev = p.assembly?.outline?.trim()
  const talk = p.codir.log
    .slice(-40)
    .map((m) => `${m.role === 'user' ? 'DIRECTOR' : 'CO-DIRECTOR'}: ${m.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n')
  const prompt = [
    'You are assembling the first cut of a short film from the shots below. Write the ASSEMBLY OUTLINE: the shots in story order, each with a title, the source clip (by name and id), what MUST be seen in it, a target length in seconds, and one line of notes (energy, what the cut into it should feel like). Then a HOLES section: shots the story needs that no clip provides (or "none"). Markdown, numbered, short lines. No preamble.',
    `THE BRIEF:\n${p.codir.brief.trim() || '(empty)'}`,
    `THE STORYBOARD (the active timeline, in order):\n${storyboardText(p, tl)}`,
    talk ? `THE CONVERSATION (latest last):\n${talk}` : '',
    prev ? `THE CURRENT OUTLINE (revise it, keep what still holds):\n${prev}` : '',
    correction?.trim() ? `THE DIRECTOR'S CORRECTION (obey it):\n${correction.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  opts.onProgress?.('assembly · writing the outline…')
  const r = await runSubCalls([{ id: 'concept', model: opts.synthModel, maxTokens: 2500, prompt }], opts)
  const res = r.results[0]
  if (!res?.ok || !res.text) return { ok: false, error: `concept failed: ${res?.error ?? 'no reply'}` }
  const outline = res.text.trim()
  const log = [...(p.assembly?.log ?? []), ...(correction?.trim() ? [{ role: 'user' as const, text: correction.trim(), at: Date.now() }] : []), { role: 'assistant' as const, text: outline, at: Date.now() }].slice(-40)
  const delta = await setAssembly({ outline, locked: false, log })
  if (!delta) return { ok: false, error: 'project closed' }
  return { ok: true, delta, outline }
}

// ---- ASSEMBLE: watch the takes, place them, cut a NEW timeline ----
interface Placement {
  shot: number
  clipId: string
  takeId: string
  inSec: number
  outSec: number
  note: string
}
export async function assemblyAssemble(opts: AssemblyOpts): Promise<{ ok: true; delta: ProjectDelta; timelineId: string; placed: number; holes: string[] } | { ok: false; error: string }> {
  const p = getProject()
  if (!p) return { ok: false, error: 'no project open' }
  const a = p.assembly
  if (!a?.outline?.trim()) return { ok: false, error: 'no outline — run Assembly Concept first' }
  if (!a.locked) return { ok: false, error: 'lock the outline first' }
  const tl = p.timelines.find((t) => t.id === p.activeTimelineId)
  if (!tl) return { ok: false, error: 'no active timeline' }
  const sourceName = tl.name
  const items = [...tl.items].sort((x, y) => (x.startSec ?? 0) - (y.startSec ?? 0))

  // watch: the keeper + up to two other takes per clip (WATCH-LANE); reports carry timestamps
  const reports: string[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const c = p.clips.find((x) => x.id === it.clipId)
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    if (!c.takes.length) {
      reports.push(`CLIP "${c.name}" (id=${c.id}): NO TAKES — a hole unless the outline can skip it.`)
      continue
    }
    const keeper = c.takes.find((t) => t.id === c.keeperTakeId) ?? c.takes[c.takes.length - 1]
    const others = c.takes.filter((t) => t.id !== keeper.id).slice(-2)
    for (const t of [keeper, ...others]) {
      const n = c.takes.indexOf(t) + 1
      opts.onProgress?.(`assembly · watching "${c.name}" T${n}…`)
      const w = await watchVideo(t.file, 'Describe this take second by second with timestamps: what happens, the camera, the cuts, the sound. Then name the usable window (from–to seconds) where it holds together, and anything wrong (drift, warped limbs, a frozen frame).', { ...opts.watch, label: `watch · assembly ${c.name} T${n}` })
      reports.push(`CLIP "${c.name}" (id=${c.id}) TAKE ${n} (take id=${t.id}${t.id === keeper.id ? ', the keeper' : ''}, ${t.durationSec ? `${Math.round(t.durationSec * 10) / 10}s` : 'length unknown'}):\n${w.ok ? w.text : `(watch failed: ${w.error})`}`)
    }
  }

  opts.onProgress?.('assembly · choosing takes and cutting…')
  const prompt = [
    'You are assembling the first cut. Below: the locked ASSEMBLY OUTLINE, then WATCH REPORTS for every take of every clip. For each outline shot pick ONE take of its clip (the one that best delivers what the shot must show), and the usable window inSec–outSec inside that take (from the report; never longer than the take). Skip a shot whose clip has no takes and list it in holes. Keep story order.',
    'Answer with STRICT JSON only, nothing else: {"placements":[{"shot":1,"clipId":"…","takeId":"…","inSec":0,"outSec":3.5,"note":"shot 1 · title — why this take and window"}],"holes":["…"]}',
    `ASSEMBLY OUTLINE:\n${a.outline.trim()}`,
    `WATCH REPORTS:\n${reports.join('\n\n')}`
  ].join('\n\n')
  const r = await runSubCalls([{ id: 'assemble', model: opts.synthModel, maxTokens: 3000, prompt }], opts)
  const res = r.results[0]
  if (!res?.ok || !res.text) return { ok: false, error: `assemble failed: ${res?.error ?? 'no reply'}` }
  const s = res.text.indexOf('{')
  const e = res.text.lastIndexOf('}')
  let parsed: { placements?: Placement[]; holes?: string[] }
  try {
    parsed = JSON.parse(res.text.slice(s, e + 1)) as { placements?: Placement[]; holes?: string[] }
  } catch {
    return { ok: false, error: 'assemble: the model did not return the JSON placements' }
  }
  const placements = (parsed.placements ?? []).filter((x) => x && typeof x.clipId === 'string' && typeof x.takeId === 'string')
  if (!placements.length) return { ok: false, error: 'assemble: no placements came back' }

  // the NEW timeline: sequential on track 0, each block carries its outline note (the tooltip)
  const made = await addTimeline(`assembly · ${sourceName} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  if (!made) return { ok: false, error: 'could not create the assembly timeline' }
  let cursor = 0
  const newItems: TimelineItem[] = []
  for (const pl of placements.sort((x, y) => x.shot - y.shot)) {
    const c = p.clips.find((x) => x.id === pl.clipId)
    const t = c?.takes.find((x) => x.id === pl.takeId) ?? c?.takes.find((x) => x.id === c.keeperTakeId)
    if (!c || !t) continue
    const len = t.durationSec ?? 0
    const inSec = Math.max(0, Math.min(Number(pl.inSec) || 0, len > 0 ? len - 0.2 : Number(pl.inSec) || 0))
    const outRaw = Number(pl.outSec)
    const outSec = len > 0 ? Math.min(len, Number.isFinite(outRaw) && outRaw > inSec ? outRaw : len) : Number.isFinite(outRaw) && outRaw > inSec ? outRaw : inSec + 3
    const item: TimelineItem = { id: `asm-${Date.now().toString(36)}-${newItems.length}`, clipId: c.id, takeId: t.id, inSec, outSec, startSec: cursor, track: 0, note: String(pl.note ?? `shot ${pl.shot}`) }
    cursor += mainEffDur(item, p.clips)
    newItems.push(item)
  }
  const d1 = await setTimelineItems(made.timelineId, newItems)
  const d2 = await setActiveTimeline(made.timelineId)
  const d3 = await setAssembly({ timelineId: made.timelineId })
  const delta: ProjectDelta = { ...(made.delta ?? {}), ...(d1 ?? {}), ...(d2 ?? {}), ...(d3 ?? {}) }
  return { ok: true, delta, timelineId: made.timelineId, placed: newItems.length, holes: parsed.holes ?? [] }
}
