// MOODS (docs/MOODS-VMD-SPEC-2026-09-08.md): `.vmd` briefs the Co-Director puts on — styles.
// One file, a YAML header + two halves (## How to write, ## What to know). The library lives in
// userData/moods/ (installed once, every project sees it); the two shipped moods (the creator'
// Hardcore Anime + 80s Dark Fantasy, converted from his skills) seed it on first run. Import
// converts his two-file SKILL.md + KNOWLEDGE.md skills (or a single skill md, or a zip of one).
import { readFile, writeFile, unlink, mkdir, readdir, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, extname, resolve } from 'path'
import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import animeVmd from './moods/hardcore-anime.vmd?raw'
import darkFantasyVmd from './moods/80s-dark-fantasy.vmd?raw'

const run = promisify(execFile)

export interface MoodHeader {
  vmd: number
  name: string
  triggers: string[]
  notFor: string[]
  tags: string[]
  author: string
  version: string
  suffix: string
  description: string
}
export interface MoodInfo extends MoodHeader {
  slug: string
  file: string
  tokens: number // ≈ chars / 4 — shown on the chip; the size guard warns above 30k
  shipped: boolean
}
export interface Mood extends MoodInfo {
  howToWrite: string
  whatToKnow: string
  text: string
}

const SHIPPED: { slug: string; text: string }[] = [
  { slug: 'hardcore-anime', text: animeVmd },
  { slug: '80s-dark-fantasy', text: darkFantasyVmd }
]

export const moodsDir = (): string => join(app.getPath('userData'), 'moods')
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'mood'

// ---- header parse / build (a small YAML subset: `key: value`, `key: [a, b]`, quoted or bare) ----
const splitList = (v: string): string[] => {
  const inner = v.trim().replace(/^\[|\]$/g, '')
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}
export function parseVmd(text: string): { header: MoodHeader; howToWrite: string; whatToKnow: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const h: Record<string, string> = {}
  let body = text
  if (m) {
    body = m[2]
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
      if (kv) h[kv[1].toLowerCase()] = kv[2].trim()
    }
  }
  const unq = (v?: string): string => (v ?? '').replace(/^["']|["']$/g, '')
  const header: MoodHeader = {
    vmd: Number(h.vmd) || 1,
    name: unq(h.name) || 'untitled',
    triggers: h.triggers ? splitList(h.triggers) : [],
    notFor: h['not-for'] ? splitList(h['not-for']) : [],
    tags: h.tags ? splitList(h.tags) : [],
    author: unq(h.author) || '',
    version: unq(h.version) || '1.0',
    suffix: unq(h.suffix),
    description: unq(h.description)
  }
  // the two halves, split on the exact section titles (a lazy regex with the m flag stopped at the
  // first line end — proven wrong in the node test, 2026-09-08)
  const howAt = body.search(/^##\s+How to write\s*$/im)
  const knowAt = body.search(/^##\s+What to know\s*$/im)
  const after = (i: number): number => body.indexOf('\n', i) + 1
  let howToWrite = ''
  let whatToKnow = ''
  if (howAt >= 0 && knowAt > howAt) {
    howToWrite = body.slice(after(howAt), knowAt)
    whatToKnow = body.slice(after(knowAt))
  } else if (howAt >= 0) howToWrite = body.slice(after(howAt))
  else if (knowAt >= 0) {
    howToWrite = body.slice(0, knowAt)
    whatToKnow = body.slice(after(knowAt))
  } else howToWrite = body
  return { header, howToWrite: howToWrite.trim(), whatToKnow: whatToKnow.trim() }
}
export function buildVmd(header: Partial<MoodHeader> & { name: string }, howToWrite: string, whatToKnow: string): string {
  const list = (a?: string[]): string => `[${(a ?? []).map((s) => (/[,\[\]:#]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)).join(', ')}]`
  const q = (s?: string): string => `"${(s ?? '').replace(/"/g, '\\"')}"`
  return [
    '---',
    'vmd: 1',
    `name: ${q(header.name)}`,
    `description: ${q(header.description)}`,
    `triggers: ${list(header.triggers)}`,
    `not-for: ${list(header.notFor)}`,
    `tags: ${list(header.tags)}`,
    `author: ${q(header.author)}`,
    `version: ${q(header.version ?? '1.0')}`,
    `suffix: ${q(header.suffix)}`,
    '---',
    '',
    '## How to write',
    '',
    howToWrite.trim(),
    '',
    '## What to know',
    '',
    whatToKnow.trim(),
    ''
  ].join('\n')
}

// ---- convert the skill shape: SKILL.md (frontmatter name + description = the router, body =
// how to write) + KNOWLEDGE.md (what to know). The description's quoted phrases become triggers;
// phrases after NOT / "do not fire" become not-for. Best effort — the user can edit the header. ----
export function convertSkill(skillMd: string, knowledgeMd: string, fallbackName?: string): string {
  const fm = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  let name = fallbackName ?? ''
  let description = ''
  let body = skillMd
  if (fm) {
    body = fm[2]
    const n = fm[1].match(/^name:\s*(.+)$/m)
    const d = fm[1].match(/^description:\s*([\s\S]+?)(?=^[a-z_-]+:|\s*$)/m)
    if (n) name = n[1].trim().replace(/^["']|["']$/g, '')
    if (d) description = d[1].replace(/\s+/g, ' ').trim()
  }
  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m)
    name = h1 ? h1[1].replace(/—.*$/, '').trim() : 'imported mood'
  }
  const pretty = name.replace(/[-_]+/g, ' ').replace(/\bprompter\b/i, '').replace(/\s+/g, ' ').trim().toUpperCase() || name
  const notIdx = description.search(/\bNOT\b|do not fire|not the/i)
  const positive = notIdx >= 0 ? description.slice(0, notIdx) : description
  const negative = notIdx >= 0 ? description.slice(notIdx) : ''
  const quoted = (s: string): string[] => Array.from(s.matchAll(/"([^"]{2,60})"/g)).map((x) => x[1].trim())
  const triggers = Array.from(new Set(quoted(positive)))
  const notFor = Array.from(new Set(quoted(negative).concat(Array.from(negative.matchAll(/\b([a-z-]+)-prompter\b/gi)).map((x) => x[1].replace(/-/g, ' ')))))
  // a locked spine / closing suffix, when the skill names one verbatim
  const spine = body.match(/>\s*`([^`]{40,})`/)
  return buildVmd({ name: pretty, description, triggers, notFor, tags: [], author: '', version: '1.0', suffix: spine ? spine[1] : '' }, body, knowledgeMd)
}

// ---- library ----
async function ensureDir(): Promise<string> {
  const d = moodsDir()
  if (!existsSync(d)) await mkdir(d, { recursive: true })
  // seed the shipped moods once (a deleted shipped mood stays deleted: we mark seeding done)
  const stamp = join(d, '.seeded')
  if (!existsSync(stamp)) {
    for (const s of SHIPPED) {
      const f = join(d, `${s.slug}.vmd`)
      if (!existsSync(f)) await writeFile(f, s.text, 'utf-8')
    }
    await writeFile(stamp, new Date().toISOString(), 'utf-8')
  }
  return d
}
const tokensOf = (text: string): number => Math.round(text.length / 4)

export async function listMoods(): Promise<MoodInfo[]> {
  const d = await ensureDir()
  const out: MoodInfo[] = []
  for (const f of (await readdir(d)).filter((x) => x.toLowerCase().endsWith('.vmd')).sort()) {
    try {
      const text = await readFile(join(d, f), 'utf-8')
      const { header } = parseVmd(text)
      const slug = f.slice(0, -4)
      out.push({ ...header, slug, file: join(d, f), tokens: tokensOf(text), shipped: SHIPPED.some((s) => s.slug === slug) })
    } catch {
      /* a broken file is skipped, never fatal */
    }
  }
  return out
}
export async function readMood(slug: string): Promise<Mood | null> {
  const f = join(await ensureDir(), `${slug}.vmd`)
  if (!existsSync(f)) return null
  const text = await readFile(f, 'utf-8')
  const { header, howToWrite, whatToKnow } = parseVmd(text)
  return { ...header, slug, file: f, tokens: tokensOf(text), shipped: SHIPPED.some((s) => s.slug === slug), howToWrite, whatToKnow, text }
}
// the library changed on disk → the MOODS fold re-reads its list. The Co-Director's save_mood
// writes from main, so the fold can't know unless told (2026-09-19: a saved mood never appeared).
let moodsChanged: (() => void) | null = null
export const onMoodsChanged = (cb: () => void): void => {
  moodsChanged = cb
}
export async function saveMood(input: { name: string; description?: string; triggers?: string[]; notFor?: string[]; tags?: string[]; author?: string; suffix?: string; howToWrite: string; whatToKnow: string }): Promise<MoodInfo> {
  const d = await ensureDir()
  const slug = slugOf(input.name)
  const text = buildVmd({ ...input, version: '1.0' }, input.howToWrite, input.whatToKnow)
  await writeFile(join(d, `${slug}.vmd`), text, 'utf-8')
  moodsChanged?.()
  const { header } = parseVmd(text)
  return { ...header, slug, file: join(d, `${slug}.vmd`), tokens: tokensOf(text), shipped: false }
}
export async function deleteMood(slug: string): Promise<boolean> {
  const f = join(await ensureDir(), `${slug}.vmd`)
  if (!existsSync(f)) return false
  await unlink(f)
  return true
}
export async function exportMood(slug: string, dest: string): Promise<boolean> {
  const f = join(await ensureDir(), `${slug}.vmd`)
  if (!existsSync(f)) return false
  await copyFile(f, dest)
  return true
}
export async function revealMood(slug: string): Promise<void> {
  const f = join(await ensureDir(), `${slug}.vmd`)
  if (existsSync(f)) shell.showItemInFolder(f)
}

// import: .vmd (copied) · a skill .md alone (converted) · a folder or .zip holding SKILL.md +
// KNOWLEDGE.md (converted as a pair). Returns the installed slugs.
export async function importMoodPaths(paths: string[]): Promise<{ slugs: string[]; errors: string[] }> {
  const d = await ensureDir()
  const slugs: string[] = []
  const errors: string[] = []
  const install = async (text: string, wantSlug?: string): Promise<void> => {
    const { header } = parseVmd(text)
    const slug = wantSlug ?? slugOf(header.name)
    await writeFile(join(d, `${slug}.vmd`), text, 'utf-8')
    slugs.push(slug)
  }
  for (const p of paths) {
    try {
      const ext = extname(p).toLowerCase()
      if (ext === '.vmd') {
        await install(await readFile(p, 'utf-8'), basename(p, '.vmd'))
      } else if (ext === '.zip' || ext === '.skill') {
        const tmp = join(app.getPath('temp'), `vd-mood-${Date.now()}`)
        await mkdir(tmp, { recursive: true })
        // Windows: the system bsdtar (System32) reads zips and drive-letter paths; a GNU tar on PATH
        // (Git Bash) reads "C:" as a remote host — proven in the node test 2026-09-08
        const sysTar = 'C:\\Windows\\System32\\tar.exe'
        const tarBin = process.platform === 'win32' && existsSync(sysTar) ? sysTar : 'tar'
        await run(tarBin, ['-xf', resolve(p), '-C', resolve(tmp)])
        const found = await findSkillPair(tmp)
        if (!found) throw new Error('no SKILL.md inside the zip')
        await install(convertSkill(found.skill, found.knowledge, basename(p, ext)))
      } else if (ext === '.md') {
        const text = await readFile(p, 'utf-8')
        if (/^---\r?\n[\s\S]*?\bvmd:/m.test(text)) await install(text)
        else {
          // a lone SKILL.md / INSTRUCTIONS.md — pair it with a KNOWLEDGE.md beside it when present
          const dir = p.slice(0, -basename(p).length)
          const sib = ['KNOWLEDGE.md', 'knowledge.md', basename(p).replace(/INSTRUCTIONS/i, 'KNOWLEDGE')].map((n) => join(dir, n)).find((f) => f !== p && existsSync(f))
          await install(convertSkill(text, sib ? await readFile(sib, 'utf-8') : '', basename(p, '.md')))
        }
      } else errors.push(`${basename(p)}: not a .vmd, .md, .zip or .skill`)
    } catch (e) {
      errors.push(`${basename(p)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { slugs, errors }
}
async function findSkillPair(dir: string): Promise<{ skill: string; knowledge: string } | null> {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    const entries = await readdir(cur, { withFileTypes: true })
    const skill = entries.find((e) => e.isFile() && /^skill\.md$/i.test(e.name))
    if (skill) {
      const know = entries.find((e) => e.isFile() && /^knowledge\.md$/i.test(e.name))
      return { skill: await readFile(join(cur, skill.name), 'utf-8'), knowledge: know ? await readFile(join(cur, know.name), 'utf-8') : '' }
    }
    for (const e of entries) if (e.isDirectory()) stack.push(join(cur, e.name))
  }
  return null
}

// ---- the block the Co-Director reads: every active mood, both halves, its suffix stated ----
export async function moodBlock(slugs: string[]): Promise<string> {
  const parts: string[] = []
  for (const slug of Array.from(new Set(slugs))) {
    const m = await readMood(slug)
    if (!m) continue
    parts.push(
      [
        `===== MOOD: ${m.name} (a style brief the user switched on — write in it) =====`,
        m.description ? `What it is: ${m.description}` : '',
        m.notFor.length ? `Not for: ${m.notFor.join(' · ')} — if the user's ask is one of these, say so instead of forcing this mood.` : '',
        m.suffix ? `Close every prompt written in this mood with, verbatim: ${m.suffix}` : '',
        '',
        '## How to write',
        m.howToWrite,
        '',
        '## What to know',
        m.whatToKnow
      ]
        .filter((l) => l !== '')
        .join('\n')
    )
  }
  return parts.join('\n\n\n')
}
// the one-shot form: `#slug` in a message names a mood for that exchange only
export async function moodsMentioned(text: string): Promise<string[]> {
  const installed = await listMoods()
  const out: string[] = []
  for (const m of text.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi)) {
    const s = m[1].toLowerCase()
    if (installed.some((x) => x.slug === s)) out.push(s)
  }
  return out
}
