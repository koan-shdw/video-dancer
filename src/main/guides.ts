// The Co-Director's guide files: three prompting guides (the director's "Seedance Prompter v3"
// set, shipped verbatim) + the Co-Director's own behavior instructions. Defaults are bundled
// into the binary via ?raw imports; the first edit — Settings "edit" or a Co-Director
// update_guide call — forks a personal copy into userData/guides/, which wins from then on.
// Revert deletes the personal copy. Remembered instructions do NOT fork: they live in their own
// file (learned.md) and ride after the shipped instructions, so an app update always reaches the
// user (director 2026-09-10: a learned-rules fork from 09-08 was silently hiding every 09-09 rule).
// All loaded guides ride every Co-Director exchange (one cached system block).
import { readFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app, shell } from 'electron'
import { readIfExists, writeAtomic } from './fileSave'
import codirectorDefault from './guides/codirector.md?raw'
import planDefault from './guides/codir-plan.md?raw'
import masterDefault from './guides/seedance-master-knowledge.md?raw'
import prompterClaudeDefault from './guides/seedance-instructions-claude.md?raw'
import prompterChatgptDefault from './guides/seedance-instructions-chatgpt.md?raw'
import rigsDefault from './guides/rigs.md?raw'

export type GuideId = 'codirector' | 'master' | 'prompter-claude' | 'prompter-chatgpt' | 'rigs'

// a Windows checkout bundles the guides with CRLF (the release's Windows runner), and a guide edited
// in a Windows editor saves with it: every platform reads LF, so the text the model gets is the same
const lf = (s: string): string => s.replace(/\r\n/g, '\n')

const GUIDES: { id: GuideId; label: string; file: string; def: string }[] = [
  { id: 'codirector', label: 'Co-Director instructions', file: 'codirector.md', def: lf(codirectorDefault) },
  { id: 'master', label: 'Master knowledge — prompting canon', file: 'seedance-master-knowledge.md', def: lf(masterDefault) },
  // Director rigs (2026-09): the camera / action / VFX vocabulary with what each move looks like
  { id: 'rigs', label: 'Director rigs — camera · action · VFX vocabulary', file: 'rigs.md', def: lf(rigsDefault) },
  { id: 'prompter-claude', label: 'Prompter instructions (Claude)', file: 'seedance-instructions-claude.md', def: lf(prompterClaudeDefault) },
  { id: 'prompter-chatgpt', label: 'Prompter instructions (ChatGPT)', file: 'seedance-instructions-chatgpt.md', def: lf(prompterChatgptDefault) }
]

// the guides the Co-Director may edit via update_guide (its own file changes only via save_rule / edit_rule / delete_rule)
export const PROMPTING_GUIDE_IDS = ['master', 'prompter-claude', 'prompter-chatgpt', 'rigs'] as const

// which files ride along on every exchange by default: his instructions (always, not toggleable)
// + the master canon. The two prompter-instruction variants duplicate material that codirector.md
// replaces, so they stay off unless the user flips them on in Settings.
const DEFAULT_LOAD: Record<GuideId, boolean> = { codirector: true, master: true, rigs: true, 'prompter-claude': false, 'prompter-chatgpt': false }

export function resolveLoad(overrides: Record<string, boolean> | undefined): Record<GuideId, boolean> {
  const out = { ...DEFAULT_LOAD }
  for (const g of GUIDES) {
    if (g.id !== 'codirector' && typeof overrides?.[g.id] === 'boolean') out[g.id] = overrides[g.id]
  }
  return out
}

const LEARNED_HEADER = '## Learned instructions'

export function isGuideId(x: string): x is GuideId {
  return GUIDES.some((g) => g.id === x)
}
const entry = (id: GuideId): { id: GuideId; label: string; file: string; def: string } => GUIDES.find((g) => g.id === id)!

function guidesDir(): string {
  return join(app.getPath('userData'), 'guides')
}
export function customGuideFile(id: GuideId): string {
  return join(guidesDir(), entry(id).file)
}

// for READING (the exchange's system block): an unreadable personal copy falls back to the shipped
// text for this exchange. Edits never build on that fallback: updateGuideText reads strictly.
export async function readGuideText(id: GuideId): Promise<string> {
  try {
    return await readOwnGuide(id)
  } catch (e) {
    console.warn(`[guides] ${entry(id).file} unreadable, using the shipped text this time:`, e instanceof Error ? e.message : e)
    return entry(id).def
  }
}
// his personal copy, or the shipped text when he has none; an unreadable copy THROWS
async function readOwnGuide(id: GuideId): Promise<string> {
  const own = await readIfExists(customGuideFile(id))
  return own == null ? entry(id).def : lf(own)
}

async function writeGuideText(id: GuideId, text: string): Promise<void> {
  await mkdir(guidesDir(), { recursive: true })
  await writeAtomic(customGuideFile(id), text)
}

// ---- learned instructions: their own file, never a fork ----

const LEARNED_FILE = (): string => join(guidesDir(), 'learned.md')

// no file = no rules. An unreadable file THROWS: save_rule / edit_rule then report an error instead
// of writing one rule over all of them (audit 2026-10-09 H3)
async function readLearned(): Promise<string[]> {
  await migrateLearnedFork()
  return rulesIn(await readIfExists(LEARNED_FILE()))
}
const rulesIn = (text: string | null): string[] =>
  (text ?? '')
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)
// for READING only (status, the exchange's system block): unreadable shows as none, and says so
const readLearnedForShow = (): Promise<string[]> =>
  readLearned().catch((e) => {
    console.warn('[guides] learned.md unreadable:', e instanceof Error ? e.message : e)
    return []
  })

async function writeLearned(rules: string[]): Promise<void> {
  await mkdir(guidesDir(), { recursive: true })
  await writeAtomic(LEARNED_FILE(), rules.map((r) => `- ${r}`).join('\n') + '\n')
}

// one-time: a personal codirector.md that only exists to carry "## Learned instructions" moves
// its rules into learned.md and is deleted, so the shipped instructions load again
let migrated = false
async function migrateLearnedFork(): Promise<void> {
  if (migrated) return
  migrated = true
  const f = customGuideFile('codirector')
  if (!existsSync(f)) return
  let text: string
  try {
    text = await readFile(f, 'utf-8')
  } catch {
    return
  }
  const at = text.indexOf(LEARNED_HEADER)
  if (at < 0) return // a hand-edited copy without learned rules — the user's, leave it
  // the section runs to the next heading — the field notes after it carry bullets of their own
  const end = text.indexOf('\n## ', at + LEARNED_HEADER.length)
  const rules = text
    .slice(at, end < 0 ? undefined : end)
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)
  const have = rulesIn(await readIfExists(LEARNED_FILE()))
  const merged = [...have]
  for (const r of rules) if (!merged.some((m) => m.toLowerCase() === r.toLowerCase())) merged.push(r)
  if (merged.length) await writeLearned(merged)
  await unlink(f)
}

export interface GuideStatus {
  id: GuideId
  label: string
  customised: boolean
  hasLearned: boolean
  path: string
}

export async function guideStatus(): Promise<GuideStatus[]> {
  await migrateLearnedFork()
  const out: GuideStatus[] = []
  for (const g of GUIDES) {
    const customised = existsSync(customGuideFile(g.id))
    const hasLearned = g.id === 'codirector' ? (await readLearnedForShow()).length > 0 : false
    out.push({ id: g.id, label: g.label, customised, hasLearned, path: customGuideFile(g.id) })
  }
  return out
}

// seed the personal copy (once) and open it in the OS editor
export async function openGuide(id: GuideId): Promise<string> {
  const f = customGuideFile(id)
  if (!existsSync(f)) await writeGuideText(id, entry(id).def)
  await shell.openPath(f)
  return f
}

export async function revertGuide(id: GuideId): Promise<void> {
  const f = customGuideFile(id)
  if (existsSync(f)) await unlink(f)
}

// ---- the Co-Director's self-updates ----

// save one rule into learned.md, in the director's words (rides after the instructions as "## Learned instructions")
export async function appendLearned(rule: string): Promise<'saved' | 'duplicate'> {
  const clean = rule.trim().replace(/\s+/g, ' ')
  if (!clean) return 'duplicate'
  const rules = await readLearned()
  if (rules.some((r) => r.toLowerCase() === clean.toLowerCase())) return 'duplicate'
  await writeLearned([...rules, clean])
  return 'saved'
}

// list 28: change or delete ONE learned rule — by its number as listed, or by its exact text.
// `next` = the new words; absent = delete. A rule he replaces never stays in beside its successor.
export async function changeLearned(which: string | number, next?: string): Promise<string> {
  const rules = await readLearned()
  const key = String(which).trim().replace(/\s+/g, ' ')
  const i = /^\d+$/.test(key) ? Number(key) - 1 : rules.findIndex((r) => r.toLowerCase() === key.toLowerCase())
  if (i < 0 || i >= rules.length) return `ERROR: no such rule — the rules are:\n${rules.map((r, k) => `${k + 1}. ${r}`).join('\n') || '(none saved)'}`
  const old = rules[i]
  const clean = next?.trim().replace(/\s+/g, ' ')
  if (next !== undefined && !clean) return 'ERROR: empty text — delete_rule removes a rule'
  if (clean) rules[i] = clean
  else rules.splice(i, 1)
  await writeLearned(rules)
  return clean ? `rule ${i + 1} now reads: ${clean} (it read: ${old})` : `deleted rule ${i + 1}: ${old}`
}

// forget every learned rule
export async function purgeLearned(): Promise<void> {
  await migrateLearnedFork()
  const f = LEARNED_FILE()
  if (existsSync(f)) await unlink(f)
}

// surgical edit from the Co-Director: replace an exact excerpt, or append a new section
export async function updateGuideText(id: GuideId, oldText: string | undefined, newText: string): Promise<string> {
  const g = entry(id)
  const cur = await readOwnGuide(id) // an unreadable personal copy refuses the edit; the default never lands over it
  let next: string
  if (oldText && oldText.trim()) {
    if (!cur.includes(oldText)) return `ERROR: old_text not found in ${g.label} — anchor on the guide's exact current text`
    next = cur.replace(oldText, newText)
  } else {
    next = cur.trimEnd() + '\n\n' + newText.trim() + '\n'
  }
  await writeGuideText(id, next)
  return `${g.label} updated${existsSync(customGuideFile(id)) ? ' (personal copy)' : ''}`
}

// every exchange's stable system block: instructions first (they win conflicts), then whichever
// guides the user has toggled on (Settings → guide files → load)
export async function buildSystemGuides(loadOverrides?: Record<string, boolean>, plan = false): Promise<string> {
  const load = resolveLoad(loadOverrides)
  const parts: string[] = []
  const learned = await readLearnedForShow() // also migrates a stale learned-rules fork, first thing
  for (const g of GUIDES) {
    if (!load[g.id]) continue
    let text = (await readGuideText(g.id)).trim()
    if (g.id === 'codirector' && learned.length)
      text += `\n\n${LEARNED_HEADER}\n\nRules the director asked you to keep, in his words. Follow them as if written above. They live in ${LEARNED_FILE()}: save_rule adds one, edit_rule changes one, delete_rule removes one.\n${learned.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    parts.push(`===== GUIDE FILE: ${g.label} =====\n\n${text}`)
  }
  if (plan) parts.push(lf(planDefault).trim())
  return parts.join('\n\n\n')
}
