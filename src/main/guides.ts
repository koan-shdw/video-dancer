// The Co-Director's guide files: three prompting guides (the director's "Seedance Prompter v3"
// set, shipped verbatim) + the Co-Director's own behavior instructions. Defaults are bundled
// into the binary via ?raw imports; the first edit — Settings "edit", a Co-Director
// update_guide call, or a remembered instruction — forks a personal copy into userData/guides/,
// which wins from then on. Revert deletes the personal copy. All four load into every
// Co-Director exchange (one cached system block), so an edit applies on the next message.
import { readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app, shell } from 'electron'
import codirectorDefault from './guides/codirector.md?raw'
import masterDefault from './guides/seedance-master-knowledge.md?raw'
import prompterClaudeDefault from './guides/seedance-instructions-claude.md?raw'
import prompterChatgptDefault from './guides/seedance-instructions-chatgpt.md?raw'
import rigsDefault from './guides/rigs.md?raw'

export type GuideId = 'codirector' | 'master' | 'prompter-claude' | 'prompter-chatgpt' | 'rigs'

const GUIDES: { id: GuideId; label: string; file: string; def: string }[] = [
  { id: 'codirector', label: 'Co-Director instructions', file: 'codirector.md', def: codirectorDefault },
  { id: 'master', label: 'Master knowledge — prompting canon', file: 'seedance-master-knowledge.md', def: masterDefault },
  // Director rigs (2026-09): the camera / action / VFX vocabulary with what each move looks like
  { id: 'rigs', label: 'Director rigs — camera · action · VFX vocabulary', file: 'rigs.md', def: rigsDefault },
  { id: 'prompter-claude', label: 'Prompter instructions (Claude)', file: 'seedance-instructions-claude.md', def: prompterClaudeDefault },
  { id: 'prompter-chatgpt', label: 'Prompter instructions (ChatGPT)', file: 'seedance-instructions-chatgpt.md', def: prompterChatgptDefault }
]

// the guides the Co-Director may edit via update_guide (its own file changes only via remember_instruction)
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

export async function readGuideText(id: GuideId): Promise<string> {
  const f = customGuideFile(id)
  if (existsSync(f)) {
    try {
      return await readFile(f, 'utf-8')
    } catch {
      /* unreadable → default */
    }
  }
  return entry(id).def
}

async function writeGuideText(id: GuideId, text: string): Promise<void> {
  await mkdir(guidesDir(), { recursive: true })
  await writeFile(customGuideFile(id), text, 'utf-8')
}

export interface GuideStatus {
  id: GuideId
  label: string
  customised: boolean
  hasLearned: boolean
  path: string
}

export async function guideStatus(): Promise<GuideStatus[]> {
  const out: GuideStatus[] = []
  for (const g of GUIDES) {
    const customised = existsSync(customGuideFile(g.id))
    const hasLearned = g.id === 'codirector' && customised ? (await readGuideText(g.id)).includes(LEARNED_HEADER) : false
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

// save one distilled rule under "## Learned instructions" (the section stays last in the file)
export async function appendLearned(rule: string): Promise<'saved' | 'duplicate'> {
  const clean = rule.trim().replace(/\s+/g, ' ')
  if (!clean) return 'duplicate'
  let text = await readGuideText('codirector')
  if (!text.includes(LEARNED_HEADER)) {
    text = text.trimEnd() + `\n\n${LEARNED_HEADER}\n\nRules the director asked you to keep. Follow them as if written above.\n`
  }
  const existing = text
    .slice(text.indexOf(LEARNED_HEADER))
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim().toLowerCase())
  if (existing.includes(clean.toLowerCase())) return 'duplicate'
  await writeGuideText('codirector', text.trimEnd() + `\n- ${clean}\n`)
  return 'saved'
}

// drop the learned section; if that leaves the file identical to the default, un-fork it
export async function purgeLearned(): Promise<void> {
  const f = customGuideFile('codirector')
  if (!existsSync(f)) return
  const text = await readFile(f, 'utf-8')
  const at = text.indexOf(LEARNED_HEADER)
  const purged = (at >= 0 ? text.slice(0, at) : text).trimEnd() + '\n'
  if (purged.trim() === entry('codirector').def.trim()) await unlink(f)
  else await writeGuideText('codirector', purged)
}

// surgical edit from the Co-Director: replace an exact excerpt, or append a new section
export async function updateGuideText(id: GuideId, oldText: string | undefined, newText: string): Promise<string> {
  const g = entry(id)
  const cur = await readGuideText(id)
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
export async function buildSystemGuides(loadOverrides?: Record<string, boolean>): Promise<string> {
  const load = resolveLoad(loadOverrides)
  const parts: string[] = []
  for (const g of GUIDES) {
    if (!load[g.id]) continue
    parts.push(`===== GUIDE FILE: ${g.label} =====\n\n${(await readGuideText(g.id)).trim()}`)
  }
  return parts.join('\n\n\n')
}
